import { createHash } from "node:crypto";

export function sha256(buf: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
