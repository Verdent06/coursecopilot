import { basename } from "node:path";
import pLimit from "p-limit";
import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import {
  CRAWL_CONCURRENCY,
  CRAWL_DELAY_MS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PAGES,
} from "../config.js";
import { crawlFetch, decodeHtmlBytes, type FetchLike, HostThrottle } from "../crawl/fetch.js";
import { createRobotsChecker } from "../crawl/robots.js";
import { inFileScope, inPageScope, makeScope } from "../crawl/scope.js";
import {
  isSsoHost,
  looksLikeFileUrl,
  looksLikePdfUrl,
  looksLikePptxUrl,
  urlSkipReason,
} from "../crawl/skip.js";
import { crawlUserAgent } from "../crawl/ua.js";
import { canonicalizeUrl, defaultPathPrefix, normalizePrefix } from "../crawl/url.js";
import { sha256 } from "../hash.js";
import { MIME_HTML, MIME_PDF, MIME_PPTX, routeFetchedKind } from "../mime.js";
import { locatorsWithUrl, persistExtracted } from "../persist.js";
import { parseSourceConfig } from "../source-config.js";
import type { ExtractedDocument, IngestResult, SkipReason, SuggestedExam } from "../types.js";
import type { ProgressFn } from "./file.js";
import {
  extractedTextLength,
  extractHtml,
  extractLinks,
  JS_TEXT_THRESHOLD,
  looksLikeLoginHtml,
  suggestExams,
} from "./html.js";
import { extractPdf } from "./pdf.js";
import { extractPptx } from "./pptx.js";

export type WebsiteIngestContext = {
  repo: CourseRepo;
  allowPrivateNetwork?: boolean;
  delayMs?: number;
  concurrency?: number;
  fetchFn?: FetchLike;
};

type CrawlTask = {
  url: string;
  depth: number;
  isFile: boolean;
};

export async function ingestWebsiteSource(
  ctx: WebsiteIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }
  if (source.kind !== "website") {
    throw new RepoError(`ingestWebsiteSource cannot handle kind "${source.kind}"`);
  }
  const courseId = source.course_id;

  const seed = canonicalizeUrl(source.uri);
  if (!seed) {
    throw new RepoError(`Invalid website URL "${source.uri}". Use an http(s) URL.`);
  }

  const cfg = parseSourceConfig(source.config_json);
  const maxDepth = Number.isFinite(cfg.max_depth)
    ? Math.max(0, Math.floor(cfg.max_depth ?? DEFAULT_MAX_DEPTH))
    : DEFAULT_MAX_DEPTH;
  const maxPages = Number.isFinite(cfg.max_pages)
    ? Math.max(1, Math.floor(cfg.max_pages ?? DEFAULT_MAX_PAGES))
    : DEFAULT_MAX_PAGES;
  const prefix = cfg.include_prefix
    ? normalizePrefix(cfg.include_prefix, seed)
    : defaultPathPrefix(seed);
  const scope = makeScope(seed, prefix);
  const delayMs = ctx.delayMs ?? envDelay() ?? CRAWL_DELAY_MS;
  const concurrency = Math.max(1, ctx.concurrency ?? CRAWL_CONCURRENCY);
  const fetchFn = ctx.fetchFn ?? fetch;
  const allowPrivate = ctx.allowPrivateNetwork ?? true;
  const throttle = new HostThrottle(delayMs);
  const robots = createRobotsChecker(fetchFn, {
    userAgent: crawlUserAgent(),
    throttle: (u) => throttle.wait(u),
  });
  const limit = pLimit(concurrency);

  const skipped: SkipReason[] = [];
  const suggestedExams: SuggestedExam[] = [];
  const newChunkIds: number[] = [];
  let unchanged = 0;
  let errors = 0;
  let htmlSlots = 0;
  let seedTitle: string | null = null;

  const seen = new Set<string>([seed]);
  let queue: CrawlTask[] = [{ url: seed, depth: 0, isFile: looksLikeFileUrl(seed) }];

  const skip = (url: string, reason: string) => {
    skipped.push({ url, reason });
  };

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    const discovered: CrawlTask[] = [];
    await Promise.all(
      batch.map((task) =>
        limit(async () => {
          const extra = await processTask(task);
          discovered.push(...extra);
        }),
      ),
    );
    queue = discovered;
  }

  if (seedTitle) {
    ctx.repo.updateSource(sourceId, { title: seedTitle });
  }

  onProgress(1, `Indexed website ${seed}`, skipped);
  return {
    docs: ctx.repo.countDocuments(sourceId),
    chunks: ctx.repo.countChunksForSource(sourceId),
    skipped,
    errors,
    unchanged,
    newChunkIds,
    suggestedExams,
  };

  async function processTask(task: CrawlTask): Promise<CrawlTask[]> {
    const pre = urlSkipReason(task.url);
    if (pre) {
      skip(task.url, pre);
      return [];
    }
    if (task.isFile) {
      if (!inFileScope(task.url, scope, true)) {
        skip(task.url, "out of scope");
        return [];
      }
    } else {
      if (!inPageScope(task.url, scope)) {
        skip(task.url, "out of scope");
        return [];
      }
      if (task.depth > maxDepth) {
        skip(task.url, `max depth ${maxDepth}`);
        return [];
      }
      if (htmlSlots >= maxPages) {
        skip(task.url, `max pages ${maxPages}`);
        return [];
      }
      htmlSlots += 1;
    }

    const allowed = await robots.allowed(task.url);
    if (!allowed) {
      skip(task.url, "robots.txt disallow");
      return [];
    }

    const existing = ctx.repo.getDocumentBySourceUrl(sourceId, task.url);
    const meta = parseMeta(existing?.meta_json ?? null);

    onProgress(Math.min(0.8, htmlSlots / Math.max(maxPages, 1)), `Fetching ${task.url}`, skipped);
    await throttle.wait(task.url);
    const fetched = await crawlFetch(task.url, {
      fetchFn,
      allowPrivateNetwork: allowPrivate,
      etag: typeof meta.etag === "string" ? meta.etag : null,
      lastModified: typeof meta.last_modified === "string" ? meta.last_modified : null,
    });

    if (!fetched.ok) {
      if (fetched.login) {
        skip(fetched.url, "requires login");
        return [];
      }
      errors += 1;
      skip(fetched.url, fetched.error);
      return [];
    }

    const finalUrl = canonicalizeUrl(fetched.url) ?? fetched.url;
    try {
      if (isSsoHost(new URL(finalUrl).hostname)) {
        skip(finalUrl, "requires login");
        return [];
      }
    } catch {
      // ignore
    }

    if (fetched.notModified) {
      if (existing) {
        ctx.repo.touchDocument(existing.id);
        unchanged += 1;
      }
      return [];
    }

    const kind = routeFetchedKind(fetched.contentType, finalUrl, fetched.bytes);
    if (kind === "html") {
      if (!inPageScope(finalUrl, scope) && finalUrl !== seed) {
        skip(finalUrl, "out of scope (redirect)");
        return [];
      }
      return ingestHtml(
        task,
        finalUrl,
        fetched.bytes,
        fetched.contentType,
        fetched.etag,
        fetched.lastModified,
      );
    }
    if (kind === "pdf" || kind === "pptx") {
      await ingestBinary(kind, finalUrl, fetched.bytes, fetched.etag, fetched.lastModified);
      return [];
    }
    skip(finalUrl, `unsupported type (${fetched.contentType || "unknown"})`);
    return [];
  }

  async function ingestHtml(
    task: CrawlTask,
    pageUrl: string,
    bytes: Uint8Array,
    contentType: string,
    etag: string | null,
    lastModified: string | null,
  ): Promise<CrawlTask[]> {
    const html = decodeHtmlBytes(bytes, contentType);
    if (looksLikeLoginHtml(html)) {
      skip(pageUrl, "requires login");
      return [];
    }

    const hash = sha256(bytes);
    const existing = ctx.repo.getDocumentBySourceUrl(sourceId, pageUrl);
    const childLinks = extractLinks(html, pageUrl);

    if (existing?.content_hash === hash) {
      ctx.repo.touchDocument(existing.id, {
        etag,
        last_modified: lastModified,
      });
      unchanged += 1;
      if (task.depth === 0 && existing.title) {
        seedTitle = existing.title;
      }
      return enqueueLinks(childLinks, task.depth);
    }

    const extracted = locatorsWithUrl(extractHtml(html, pageUrl), pageUrl);
    const textLen = extractedTextLength(extracted.segments);
    if (textLen < JS_TEXT_THRESHOLD) {
      skip(pageUrl, "may need JS rendering");
    }
    if (extracted.segments.length === 0) {
      return enqueueLinks(childLinks, task.depth);
    }

    const exams = suggestExams(extracted.segments.map((s) => s.text).join("\n"));
    suggestedExams.push(...exams);
    if (cfg.lecture_no != null) {
      extracted.meta.lecture_no = cfg.lecture_no;
    }
    const persisted = persistExtracted(ctx.repo, {
      sourceId,
      courseId,
      url: pageUrl,
      mime: MIME_HTML,
      contentHash: hash,
      extracted,
      extraMeta: {
        etag,
        last_modified: lastModified,
        suggested_exams: exams,
      },
    });
    newChunkIds.push(...persisted.chunkIds);

    if (task.depth === 0) {
      seedTitle = extracted.title;
    }
    return enqueueLinks(childLinks, task.depth);
  }

  async function ingestBinary(
    kind: "pdf" | "pptx",
    url: string,
    bytes: Uint8Array,
    etag: string | null,
    lastModified: string | null,
  ): Promise<void> {
    const hash = sha256(bytes);
    const existing = ctx.repo.getDocumentBySourceUrl(sourceId, url);
    if (existing?.content_hash === hash) {
      ctx.repo.touchDocument(existing.id, { etag, last_modified: lastModified });
      unchanged += 1;
      return;
    }
    const fileName = basename(new URL(url).pathname) || url;
    let extracted: ExtractedDocument;
    try {
      extracted =
        kind === "pdf"
          ? locatorsWithUrl(
              await extractPdf(bytes, url, fileName, { asSlides: cfg.as_slides }),
              url,
            )
          : locatorsWithUrl(await extractPptx(bytes, url, fileName), url);
    } catch (err) {
      errors += 1;
      skip(url, err instanceof Error ? err.message : String(err));
      return;
    }
    if (cfg.lecture_no != null) {
      extracted.meta.lecture_no = cfg.lecture_no;
    }
    const persisted = persistExtracted(ctx.repo, {
      sourceId,
      courseId,
      url,
      mime: kind === "pdf" ? MIME_PDF : MIME_PPTX,
      contentHash: hash,
      extracted,
      extraMeta: { etag, last_modified: lastModified },
    });
    newChunkIds.push(...persisted.chunkIds);
  }

  function enqueueLinks(hrefs: string[], fromDepth: number): CrawlTask[] {
    const extra: CrawlTask[] = [];
    for (const href of hrefs) {
      const canonical = canonicalizeUrl(href);
      if (!canonical) {
        const reason = urlSkipReason(href);
        if (reason) {
          skip(href, reason);
        }
        continue;
      }
      if (seen.has(canonical)) {
        continue;
      }
      const pre = urlSkipReason(canonical);
      if (pre) {
        seen.add(canonical);
        skip(canonical, pre);
        continue;
      }
      const asFile =
        looksLikeFileUrl(canonical) || looksLikePdfUrl(canonical) || looksLikePptxUrl(canonical);
      if (asFile) {
        if (!inFileScope(canonical, scope, true)) {
          continue;
        }
        seen.add(canonical);
        extra.push({ url: canonical, depth: fromDepth + 1, isFile: true });
        continue;
      }
      if (!inPageScope(canonical, scope)) {
        skip(canonical, "out of scope");
        seen.add(canonical);
        continue;
      }
      if (fromDepth + 1 > maxDepth) {
        continue;
      }
      seen.add(canonical);
      extra.push({ url: canonical, depth: fromDepth + 1, isFile: false });
    }
    return extra;
  }
}

function envDelay(): number | undefined {
  const raw = process.env.COURSECOPILOT_CRAWL_DELAY_MS;
  if (raw == null || raw === "") {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
