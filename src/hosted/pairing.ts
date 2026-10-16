import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomToken, sha256Base64Url, timingSafeEqualString } from "../util/crypto.js";
import { log } from "../util/log.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_TTL_S = 15 * 60;

export type PairingCode = {
  code: string;
  userId: string;
  expiresAt: number;
};

export type PairingIssue = {
  code: string;
  expiresAt: number;
};

type Persisted = {
  codes: Array<{ code: string; userId: string; exp: number }>;
  syncs: Array<{ token_hash: string; userId: string; created_at: number }>;
};

/**
 * One-time chat/page codes exchanged by the browser extension for a sync token.
 * Host-level (not per-user) so POST /api/pair can resolve the account.
 */
export class PairingStore {
  private codes = new Map<string, { userId: string; exp: number }>();
  private syncs = new Map<string, { userId: string; created_at: number }>();
  private readonly persistPath: string;

  constructor(homeDir: string) {
    this.persistPath = join(homeDir, "pairing.json");
    this.load();
  }

  issue(userId: string, ttlS = DEFAULT_TTL_S): PairingIssue {
    this.purgeExpired();
    for (const [code, row] of this.codes) {
      if (row.userId === userId) {
        this.codes.delete(code);
      }
    }
    const code = formatCode(randomCode(8));
    const expiresAt = Math.floor(Date.now() / 1000) + ttlS;
    this.codes.set(code, { userId, exp: expiresAt });
    this.save();
    return { code, expiresAt };
  }

  peek(userId: string): PairingIssue | undefined {
    this.purgeExpired();
    for (const [code, row] of this.codes) {
      if (row.userId === userId) {
        return { code, expiresAt: row.exp };
      }
    }
    return undefined;
  }

  issueOrReuse(userId: string, ttlS = DEFAULT_TTL_S): PairingIssue {
    const existing = this.peek(userId);
    if (existing && existing.expiresAt - Math.floor(Date.now() / 1000) > 60) {
      return existing;
    }
    return this.issue(userId, ttlS);
  }

  redeem(code: string): { syncToken: string; userId: string } | undefined {
    this.purgeExpired();
    const normalized = normalizeCode(code);
    if (!normalized) {
      return undefined;
    }
    let found: { userId: string; exp: number; key: string } | undefined;
    for (const [key, row] of this.codes) {
      if (timingSafeEqualString(key, normalized)) {
        found = { ...row, key };
        break;
      }
    }
    if (!found || found.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    this.codes.delete(found.key);
    const syncToken = `cc_sync_${randomToken(24)}`;
    this.syncs.set(sha256Base64Url(syncToken), {
      userId: found.userId,
      created_at: Math.floor(Date.now() / 1000),
    });
    this.save();
    return { syncToken, userId: found.userId };
  }

  userIdForSyncToken(token: string): string | undefined {
    const trimmed = token.trim();
    if (!trimmed) {
      return undefined;
    }
    const hash = sha256Base64Url(trimmed);
    return this.syncs.get(hash)?.userId;
  }

  private purgeExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [code, row] of this.codes) {
      if (row.exp < now) {
        this.codes.delete(code);
      }
    }
  }

  private load(): void {
    if (!existsSync(this.persistPath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.persistPath, "utf8")) as Persisted;
      for (const row of parsed.codes ?? []) {
        if (row?.code && row.userId && typeof row.exp === "number") {
          this.codes.set(normalizeCode(row.code) ?? row.code, {
            userId: row.userId,
            exp: row.exp,
          });
        }
      }
      for (const row of parsed.syncs ?? []) {
        if (row?.token_hash && row.userId) {
          this.syncs.set(row.token_hash, {
            userId: row.userId,
            created_at: row.created_at ?? 0,
          });
        }
      }
    } catch (err) {
      log.warn("could not read pairing.json", err);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const state: Persisted = {
        codes: [...this.codes.entries()].map(([code, row]) => ({
          code,
          userId: row.userId,
          exp: row.exp,
        })),
        syncs: [...this.syncs.entries()].map(([token_hash, row]) => ({
          token_hash,
          userId: row.userId,
          created_at: row.created_at,
        })),
      };
      writeFileSync(this.persistPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      log.warn("could not persist pairing.json", err);
    }
  }
}

export function normalizeCode(raw: string): string | undefined {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (chars.length !== 8) {
    return undefined;
  }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function formatCode(chars: string): string {
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}
