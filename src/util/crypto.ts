import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 128-bit secret as 32 hex chars (spec §13 secret URL path). */
export function randomSecret128(): string {
  return randomBytes(16).toString("hex");
}

/** URL-safe token for OAuth codes and access/refresh tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Constant-time string compare; length mismatch still does a dummy compare. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  const n = Math.max(left.length, right.length, 1);
  const padL = Buffer.alloc(n);
  const padR = Buffer.alloc(n);
  left.copy(padL);
  right.copy(padR);
  const eq = timingSafeEqual(padL, padR);
  return eq && left.length === right.length;
}
