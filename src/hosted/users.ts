import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomToken, sha256Base64Url, timingSafeEqualString } from "../util/crypto.js";
import { log } from "../util/log.js";

export type HostedUser = {
  id: string;
  created_at: number;
  recovery_hash: string;
};

type PersistedUsers = {
  users: HostedUser[];
};

const RECOVERY_PREFIX = "cc_lib_";

export class UserStore {
  private users = new Map<string, HostedUser>();
  private readonly persistPath: string;
  readonly rootDir: string;

  constructor(homeDir: string) {
    this.rootDir = homeDir;
    this.persistPath = join(homeDir, "users.json");
    this.load();
  }

  create(): { user: HostedUser; recoveryKey: string } {
    const recoveryKey = `${RECOVERY_PREFIX}${randomToken(16)}`;
    const user: HostedUser = {
      id: `usr_${randomToken(12)}`,
      created_at: Math.floor(Date.now() / 1000),
      recovery_hash: sha256Base64Url(recoveryKey),
    };
    this.users.set(user.id, user);
    this.save();
    return { user, recoveryKey };
  }

  get(id: string): HostedUser | undefined {
    return this.users.get(id);
  }

  findByRecovery(key: string): HostedUser | undefined {
    const trimmed = key.trim();
    if (!trimmed) {
      return undefined;
    }
    const hash = sha256Base64Url(trimmed);
    for (const user of this.users.values()) {
      if (timingSafeEqualString(user.recovery_hash, hash)) {
        return user;
      }
    }
    return undefined;
  }

  userHome(userId: string): string {
    return join(this.rootDir, "users", userId);
  }

  uploadDir(userId: string): string {
    return join(this.userHome(userId), "uploads");
  }

  private load(): void {
    if (!existsSync(this.persistPath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.persistPath, "utf8")) as PersistedUsers;
      for (const user of parsed.users ?? []) {
        if (user?.id && user.recovery_hash) {
          this.users.set(user.id, user);
        }
      }
    } catch (err) {
      log.warn("could not read users.json", err);
    }
  }

  private save(): void {
    try {
      mkdirSync(this.rootDir, { recursive: true });
      const state: PersistedUsers = { users: [...this.users.values()] };
      writeFileSync(this.persistPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      log.warn("could not persist users.json", err);
    }
  }
}
