export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

type Bucket = {
  tokens: number;
  updatedAt: number;
};

/**
 * In-memory token bucket. Fine for a single Fly/Render instance.
 * `rpm` is the sustained refill rate; burst equals the same count.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly rpm: number) {}

  check(key: string, now = Date.now()): RateLimitResult {
    if (this.rpm <= 0) {
      return { ok: true };
    }
    const capacity = this.rpm;
    const refillPerMs = this.rpm / 60_000;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, updatedAt: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      return { ok: false, retryAfterSec };
    }
    bucket.tokens -= 1;
    return { ok: true };
  }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}
