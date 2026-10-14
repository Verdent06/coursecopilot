import { AsyncLocalStorage } from "node:async_hooks";

export type RequestScope = {
  userId: string;
  homeDir: string;
  /** When false, ignore process-wide CANVAS_* env so users cannot share a deploy token. */
  allowEnvSecrets?: boolean;
};

const storage = new AsyncLocalStorage<RequestScope>();

export function getRequestScope(): RequestScope | undefined {
  return storage.getStore();
}

export function runWithScope<T>(scope: RequestScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function isHostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COURSECOPILOT_HOSTED === "0") {
    return false;
  }
  if (env.COURSECOPILOT_HOSTED === "1") {
    return true;
  }
  return Boolean(env.PORT);
}
