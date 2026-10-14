import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeCode, PairingStore } from "../../src/hosted/pairing.js";

describe("pairing codes", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("issues a typed code, redeems once, and binds a sync token", () => {
    const home = mkdtempSync(join(tmpdir(), "cc-pair-"));
    homes.push(home);
    const store = new PairingStore(home);
    const issued = store.issue("usr_1");
    expect(issued.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(normalizeCode(issued.code.toLowerCase())).toBe(issued.code);
    const redeemed = store.redeem(issued.code.toLowerCase());
    expect(redeemed?.userId).toBe("usr_1");
    expect(redeemed?.syncToken.startsWith("cc_sync_")).toBe(true);
    expect(store.redeem(issued.code)).toBeUndefined();
    expect(store.userIdForSyncToken(redeemed?.syncToken ?? "")).toBe("usr_1");
    expect(store.userIdForSyncToken("nope")).toBeUndefined();
  });

  it("reuses a fresh code and rejects garbage", () => {
    const home = mkdtempSync(join(tmpdir(), "cc-pair-"));
    homes.push(home);
    const store = new PairingStore(home);
    const a = store.issueOrReuse("usr_2");
    const b = store.issueOrReuse("usr_2");
    expect(a.code).toBe(b.code);
    expect(store.redeem("????")).toBeUndefined();
    expect(normalizeCode("ab")).toBeUndefined();
  });
});
