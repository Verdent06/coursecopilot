import { join } from "node:path";
import { type AppContext, type CreateServerOptions, createAppContext } from "../server/index.js";
import { DB_FILENAME } from "../util/paths.js";
import type { RequestScope } from "../util/scope.js";
import { signFlowToken } from "./flow.js";
import type { PairingStore } from "./pairing.js";
import type { UserStore } from "./users.js";

export const LOCAL_USER_ID = "local";

export type HostedRuntimeOptions = {
  users: UserStore;
  processHome: string;
  publicUrl: string;
  sessionSecret: string;
  pairing?: PairingStore;
  base: CreateServerOptions;
};

export class UserContextCache {
  private readonly map = new Map<string, AppContext>();

  constructor(private readonly opts: HostedRuntimeOptions) {}

  get(userId: string): AppContext {
    const existing = this.map.get(userId);
    if (existing) {
      return existing;
    }
    const homeDir =
      userId === LOCAL_USER_ID ? this.opts.processHome : this.opts.users.userHome(userId);
    const pairing = this.opts.pairing;
    const scope: RequestScope = {
      userId,
      homeDir,
      allowEnvSecrets: false,
    };
    const ctx = createAppContext({
      ...this.opts.base,
      homeDir,
      dbPath:
        this.opts.base.dbPath && userId === LOCAL_USER_ID
          ? this.opts.base.dbPath
          : join(homeDir, DB_FILENAME),
      allowLocalPaths: this.opts.base.allowLocalPaths ?? false,
      allowPrivateNetwork: this.opts.base.allowPrivateNetwork ?? false,
      trustedPathPrefix: this.opts.users.uploadDir(userId),
      scope,
      hostedTools: {
        enabled: true,
        publicUrl: this.opts.publicUrl,
        userId,
        signFlow: (purpose) => signFlowToken(this.opts.sessionSecret, { userId, purpose }),
        createPairingCode: pairing ? () => pairing.issueOrReuse(userId) : undefined,
      },
    });
    this.map.set(userId, ctx);
    return ctx;
  }

  closeAll(): void {
    for (const ctx of this.map.values()) {
      try {
        ctx.opened.db.close();
      } catch {
        // already closed
      }
    }
    this.map.clear();
  }
}
