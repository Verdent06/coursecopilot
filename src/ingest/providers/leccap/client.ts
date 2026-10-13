import { VERSION } from "../../../version.js";
import { parseCaptionTime, webvttToCaptions } from "../../lecture-capture/captions.js";
import {
  createRateLimiter,
  HttpStatusError,
  type RateLimiter,
  sleep,
  withRetries,
} from "../../lecture-capture/rate-limit.js";
import { cookieHeader, SESSION_EXPIRED_MESSAGE } from "../../lecture-capture/session.js";
import type {
  AuxSourceMeta,
  LectureCaption,
  LectureCaptureProvider,
  LectureCaptureSession,
  LectureProduct,
  LectureRecordingRef,
  SlideChange,
} from "../../lecture-capture/types.js";
import { SessionExpiredError } from "../../lecture-capture/types.js";
import { parseCaptionFile } from "../../sources/vtt.js";
import {
  leccapOrigin,
  leccapPlayerDeepLink,
  mediaUrl,
  parseLeccapUrl,
  playerUrl,
} from "./parse.js";

export type LeccapClientOptions = {
  session?: LectureCaptureSession | null;
  fetch?: typeof fetch;
  origin?: string;
  sleep?: (ms: number) => Promise<void>;
  rateLimiter?: RateLimiter;
};

export type LeccapClient = LectureCaptureProvider & {
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
};

const UA = `CourseCopilot/${VERSION} (+https://github.com/Verdent06/coursecopilot)`;

export function createLeccapClient(opts: LeccapClientOptions = {}): LeccapClient {
  const origin = (opts.origin ?? leccapOrigin()).replace(/\/$/, "");
  const fetchFn = opts.fetch ?? fetch;
  const sleeper = opts.sleep ?? sleep;
  const throttle = opts.rateLimiter ?? createRateLimiter(undefined, sleeper);
  const session = opts.session ?? null;

  async function authed(
    pathOrUrl: string,
    init: RequestInit = {},
  ): Promise<{ status: number; text: string; headers: Headers }> {
    await throttle();
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${origin}${pathOrUrl}`;
    const headers = new Headers(init.headers);
    headers.set("User-Agent", UA);
    headers.set("Accept", "*/*");
    if (session) {
      const host = new URL(url).hostname;
      const cookie = cookieHeader(session, host);
      if (cookie) {
        headers.set("Cookie", cookie);
      }
    }
    const res = await withRetries(
      async () => {
        const r = await fetchFn(url, { ...init, headers, redirect: "follow" });
        if (r.status === 429 || r.status >= 500) {
          throw new HttpStatusError(r.status, url);
        }
        return r;
      },
      { sleeper },
    );
    const text = await res.text();
    if (isAuthFailure(res.status, text, res.headers.get("location") ?? res.url)) {
      throw new SessionExpiredError(SESSION_EXPIRED_MESSAGE);
    }
    return { status: res.status, text, headers: res.headers };
  }

  const client: LeccapClient = {
    id: "leccap",
    parseUrl: parseLeccapUrl,
    playerDeepLink: leccapPlayerDeepLink,

    async listRecordings(siteId: string): Promise<LectureRecordingRef[]> {
      const api = await authed(`/leccap/viewer/api/recordings/?sk=${encodeURIComponent(siteId)}`);
      if (api.status >= 200 && api.status < 300) {
        const parsed = parseRecordingsList(api.text, siteId);
        if (parsed.length > 0) {
          return parsed;
        }
      }
      const html = await authed(`/leccap/site/${encodeURIComponent(siteId)}`);
      if (html.status >= 200 && html.status < 300) {
        return parseSiteHtml(html.text, siteId);
      }
      throw new Error(
        `Could not list recordings for site ${siteId} (HTTP ${api.status}/${html.status}).`,
      );
    },

    async fetchProduct(recordingId: string): Promise<LectureProduct> {
      const res = await authed(`/leccap/player/api/product/?rk=${encodeURIComponent(recordingId)}`);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`product API HTTP ${res.status} for rk=${recordingId}`);
      }
      let json: unknown;
      try {
        json = JSON.parse(res.text) as unknown;
      } catch {
        throw new Error(`product API returned non-JSON for rk=${recordingId}`);
      }
      const product = productFromJson(json, recordingId);
      if (product.captions.length === 0) {
        try {
          const vtt = await authed(
            `/leccap/player/api/webvtt/?rk=${encodeURIComponent(recordingId)}`,
          );
          if (vtt.status >= 200 && vtt.status < 300 && /WEBVTT/i.test(vtt.text)) {
            product.captions = webvttToCaptions(vtt.text);
            if (product.captions.length === 0) {
              product.captions = parseCaptionFile(vtt.text).map((c) => ({
                text: c.text,
                start_s: c.start_s,
                end_s: c.end_s,
              }));
            }
          }
        } catch (err) {
          if (err instanceof SessionExpiredError) {
            throw err;
          }
        }
      }
      product.hashMaterial = hashMaterial(product);
      return product;
    },

    async fetchBytes(url: string): Promise<Uint8Array | null> {
      await throttle();
      const headers = new Headers();
      headers.set("User-Agent", UA);
      if (session) {
        const cookie = cookieHeader(session, new URL(url).hostname);
        if (cookie) {
          headers.set("Cookie", cookie);
        }
      }
      const res = await fetchFn(url, { headers, redirect: "follow" });
      if (res.status === 401 || res.status === 403) {
        return null;
      }
      if (!res.ok) {
        return null;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.byteLength > 0 ? buf : null;
    },
  };

  return client;
}

function isAuthFailure(status: number, body: string, location: string): boolean {
  if (status === 401) {
    return true;
  }
  const loc = location.toLowerCase();
  if (/weblogin|okta|shibboleth|duo|sso\./i.test(loc)) {
    return true;
  }
  if (status === 403) {
    // Cloudflare challenge pages are 403 too; treat product JSON 403 as session.
    if (/shibboleth|weblogin|okta|duo|sign\s*in|login/i.test(body)) {
      return true;
    }
    if (body.trimStart().startsWith("{")) {
      return false;
    }
    return true;
  }
  return false;
}

export function parseRecordingsList(text: string, siteId: string): LectureRecordingRef[] {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  const rows = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { recordings?: unknown }).recordings)
      ? ((data as { recordings: unknown[] }).recordings ?? [])
      : [];
  const out: LectureRecordingRef[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as Record<string, unknown>;
    const recordingId = stringish(r.recordingkey ?? r.rk ?? r.id);
    if (!recordingId) {
      continue;
    }
    out.push({
      recordingId,
      title: stringish(r.title) ?? recordingId,
      date: stringish(r.date),
      url: playerUrl(recordingId),
      siteId: stringish(r.sitekey) ?? siteId,
      siteName: stringish(r.sitename),
    });
  }
  return out;
}

export function parseSiteHtml(html: string, siteId: string): LectureRecordingRef[] {
  const out: LectureRecordingRef[] = [];
  const seen = new Set<string>();
  const re = /href="(\/leccap\/(?:player|viewer)\/r\/([^"?#]+))"/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m) {
    const recordingId = m[2];
    if (recordingId && !seen.has(recordingId)) {
      seen.add(recordingId);
      out.push({
        recordingId,
        title: recordingId,
        url: playerUrl(recordingId),
        siteId,
      });
    }
    m = re.exec(html);
  }
  return out;
}

export function productFromJson(raw: unknown, fallbackRk: string): LectureProduct {
  if (!raw || typeof raw !== "object") {
    throw new Error("product JSON is not an object");
  }
  const p = raw as Record<string, unknown>;
  const info = (p.info && typeof p.info === "object" ? p.info : {}) as Record<string, unknown>;
  const recordingId = stringish(p.recordingkey ?? p.rk) ?? fallbackRk;
  const siteId = stringish(p.sitekey);
  const mediaPrefix =
    stringish(p.mediaPrefix) ?? "//s3.amazonaws.com/leccap.engin.umich.edu/media/";
  const products = Array.isArray(info.products) ? info.products : [];
  const firstProduct =
    products[0] && typeof products[0] === "object" ? (products[0] as Record<string, unknown>) : {};
  const slidesFolder = stringish(firstProduct.slides_folder ?? info.slides_folder);
  const thumbnailsFolder = stringish(info.thumbnails_folder ?? firstProduct.thumbnails_folder);
  const slides = parseThumbnails(info.thumbnails);
  const captions = parseProductCaptions(info.captions);
  const slideImageUrls: Record<number, string> = {};
  if (siteId) {
    const folder = slidesFolder || thumbnailsFolder;
    if (folder) {
      const indexes = slides.length > 0 ? slides.map((s) => s.slideIndex) : [1];
      for (const idx of indexes) {
        slideImageUrls[idx] = mediaUrl(mediaPrefix, siteId, `${folder}/${idx}.jpg`);
      }
    }
  }
  const duration =
    num(firstProduct.duration) ??
    num(info.duration) ??
    (captions.length > 0 ? captions[captions.length - 1]?.end_s : undefined) ??
    (slides.length > 0 ? slides[slides.length - 1]?.start_s : undefined);

  const product: LectureProduct = {
    recordingId,
    siteId,
    siteName: stringish(p.sitename),
    title: stringish(p.title) ?? recordingId,
    date: stringish(p.date),
    duration_s: duration,
    playerUrl: playerUrl(recordingId),
    captions,
    slides,
    slideImageUrls,
    auxSources: parseAux(info.aux_sources),
    hashMaterial: "",
  };
  product.hashMaterial = hashMaterial(product);
  return product;
}

function parseThumbnails(raw: unknown): SlideChange[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const pairs: Array<{ index: number; start_s: number }> = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      const index = Number(item[0]);
      const start = Number(item[1]);
      if (Number.isFinite(index) && Number.isFinite(start)) {
        pairs.push({ index, start_s: start });
      }
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const index = Number(o.slideIndex ?? o.index ?? o[0]);
      const start = Number(o.seconds ?? o.start_s ?? o[1]);
      if (Number.isFinite(index) && Number.isFinite(start)) {
        pairs.push({ index, start_s: start });
      }
    }
  }
  if (pairs.length === 0) {
    return [];
  }
  const min = Math.min(...pairs.map((p) => p.index));
  const oneBased = min >= 1;
  return pairs
    .map((p) => ({
      slideIndex: oneBased ? p.index : p.index + 1,
      start_s: p.start_s,
    }))
    .sort((a, b) => a.start_s - b.start_s || a.slideIndex - b.slideIndex);
}

function parseProductCaptions(raw: unknown): LectureCaption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: LectureCaption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const c = item as Record<string, unknown>;
    const text = stringish(c.text);
    const start = parseCaptionTime(c.intime ?? c.start ?? c.start_s);
    const end = parseCaptionTime(c.outtime ?? c.end ?? c.end_s);
    if (!text || start == null || end == null) {
      continue;
    }
    out.push({ text, start_s: start, end_s: Math.max(end, start) });
  }
  return out;
}

function parseAux(raw: unknown): AuxSourceMeta[] {
  if (!raw) {
    return [];
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const out: AuxSourceMeta[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push({ kind: "whiteboard", prefix: item });
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    out.push({
      kind: stringish(o.kind ?? o.type) ?? "whiteboard",
      prefix: stringish(o.prefix ?? o.name),
      count: num(o.count),
      interval_s: num(o.interval_s ?? o.interval),
    });
  }
  return out;
}

function hashMaterial(product: LectureProduct): string {
  return JSON.stringify({
    rk: product.recordingId,
    title: product.title,
    date: product.date,
    captions: product.captions,
    slides: product.slides,
  });
}

function stringish(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
