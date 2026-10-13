import { assertSafeUrl, SsrfError } from "../../util/ssrf.js";
import { MAX_FILE_BYTES } from "../config.js";
import { crawlUserAgent } from "./ua.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CrawlFetchOptions = {
  fetchFn?: FetchLike;
  allowPrivateNetwork?: boolean;
  etag?: string | null;
  lastModified?: string | null;
  maxBytes?: number;
  userAgent?: string;
  timeoutMs?: number;
};

export type CrawlFetchResult =
  | { ok: true; notModified: true; url: string; status: number }
  | {
      ok: true;
      notModified: false;
      url: string;
      status: number;
      contentType: string;
      bytes: Uint8Array;
      etag: string | null;
      lastModified: string | null;
    }
  | { ok: false; url: string; error: string; status?: number; login?: boolean };

const MAX_RETRIES = 3;

export class HostThrottle {
  private readonly last = new Map<string, number>();

  constructor(private readonly delayMs: number) {}

  async wait(url: string): Promise<void> {
    if (this.delayMs <= 0) {
      return;
    }
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const now = Date.now();
    const prev = this.last.get(host) ?? 0;
    const wait = prev + this.delayMs - now;
    if (wait > 0) {
      await sleep(wait);
    }
    this.last.set(host, Date.now());
  }
}

export async function crawlFetch(
  url: string,
  opts: CrawlFetchOptions = {},
): Promise<CrawlFetchResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;
  const ua = opts.userAgent ?? crawlUserAgent();
  const timeoutMs = opts.timeoutMs ?? 30_000;

  try {
    await assertSafeUrl(url, { allowPrivateNetwork: opts.allowPrivateNetwork ?? true });
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof SsrfError ? err.message : String(err),
    };
  }

  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept:
      "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,*/*",
  };
  if (opts.etag) {
    headers["If-None-Match"] = opts.etag;
  }
  if (opts.lastModified) {
    headers["If-Modified-Since"] = opts.lastModified;
  }

  let lastError = "fetch failed";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const finalUrl = res.url || url;
      if (res.status === 429 || res.status === 503) {
        lastError = `HTTP ${res.status}`;
        if (attempt >= MAX_RETRIES) {
          return { ok: false, url: finalUrl, error: lastError, status: res.status };
        }
        await sleep(retryDelay(res, attempt));
        continue;
      }
      if (res.status === 304) {
        return { ok: true, notModified: true, url: finalUrl, status: 304 };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          url: finalUrl,
          error: "requires login",
          status: res.status,
          login: true,
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          url: finalUrl,
          error: `HTTP ${res.status}`,
          status: res.status,
        };
      }
      const length = Number(res.headers.get("content-length"));
      if (Number.isFinite(length) && length > maxBytes) {
        return { ok: false, url: finalUrl, error: `file larger than ${maxBytes} bytes` };
      }
      const bytes = await readLimited(res, maxBytes);
      return {
        ok: true,
        notModified: false,
        url: finalUrl,
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        bytes,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_RETRIES || !isRetryable(err)) {
        return { ok: false, url, error: lastError };
      }
      await sleep(500 * 2 ** attempt);
    }
  }
  return { ok: false, url, error: lastError };
}

export function decodeHtmlBytes(bytes: Uint8Array, contentType: string): string {
  const charset = charsetFromContentType(contentType) ?? sniffCharset(bytes) ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function charsetFromContentType(contentType: string): string | undefined {
  const match = /charset\s*=\s*("?)([^";]+)\1/i.exec(contentType);
  const raw = match?.[2]?.trim();
  return raw || undefined;
}

function sniffCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024));
  const match = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return match?.[1];
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`file larger than ${maxBytes} bytes`);
  }
  return buf;
}

function retryDelay(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
    const when = Date.parse(raw);
    if (!Number.isNaN(when)) {
      return Math.max(0, Math.min(when - Date.now(), 30_000));
    }
  }
  return 500 * 2 ** attempt;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|network|ECONNRESET|EAI_AGAIN|UND_ERR/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
