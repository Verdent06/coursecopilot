import { LECTURE_CAPTURE_MAX_RETRIES, LECTURE_CAPTURE_MIN_INTERVAL_MS } from "../config.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type RateLimiter = () => Promise<void>;

export function createRateLimiter(
  minIntervalMs: number = LECTURE_CAPTURE_MIN_INTERVAL_MS,
  sleeper: (ms: number) => Promise<void> = sleep,
): RateLimiter {
  let last = 0;
  return async () => {
    const now = Date.now();
    const wait = last + minIntervalMs - now;
    if (wait > 0) {
      await sleeper(wait);
    }
    last = Date.now();
  };
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    sleeper?: (ms: number) => Promise<void>;
    isRetryable?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? LECTURE_CAPTURE_MAX_RETRIES;
  const sleeper = opts.sleeper ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts.isRetryable ? opts.isRetryable(err) : isRetryableStatus(err);
      if (!retryable || attempt === retries) {
        throw err;
      }
      const retryAfter = retryAfterMs(err);
      await sleeper(retryAfter ?? 500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
  }
}

function isRetryableStatus(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

function retryAfterMs(err: unknown): number | undefined {
  if (err instanceof HttpStatusError && err.status === 429) {
    return 2000;
  }
  return undefined;
}
