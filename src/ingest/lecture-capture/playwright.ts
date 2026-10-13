import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { log } from "../../util/log.js";
import { getToolsDir } from "../../util/paths.js";

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
};

export type PersistentContext = {
  cookies: (urls?: string | string[]) => Promise<PlaywrightCookie[]>;
  newPage: () => Promise<{
    goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
    url: () => string;
  }>;
  request: {
    get: (url: string) => Promise<{ status: () => number }>;
  };
  close: () => Promise<void>;
};

export type PlaywrightChromium = {
  launchPersistentContext: (
    userDataDir: string,
    options: Record<string, unknown>,
  ) => Promise<PersistentContext>;
};

export type PlaywrightModule = {
  chromium: PlaywrightChromium;
};

const PLAYWRIGHT_INSTALL_HINT = `Playwright is an optional dependency (kept out of the base npx install).

Install it once, then retry:
  npm install playwright
  npx playwright install chromium

Or skip the browser and import cookies from a signed-in session:
  npx coursecopilot login leccap --cookies cookies.json`;

/**
 * Resolve playwright from the process, then from ~/.coursecopilot/tools.
 * Optionally run a one-time `npm install playwright` into the tools dir.
 */
export async function loadPlaywright(
  opts: { installIfMissing?: boolean } = {},
): Promise<PlaywrightModule> {
  const existing =
    tryLoadPlaywright() ?? tryLoadPlaywright(process.cwd()) ?? tryLoadPlaywright(getToolsDir());
  if (existing) {
    return existing;
  }
  if (!opts.installIfMissing) {
    throw new Error(PLAYWRIGHT_INSTALL_HINT);
  }
  installPlaywrightLocally();
  const installed = tryLoadPlaywright(getToolsDir());
  if (!installed) {
    throw new Error(PLAYWRIGHT_INSTALL_HINT);
  }
  return installed;
}

function tryLoadPlaywright(fromDir?: string): PlaywrightModule | null {
  const candidates = [
    fromDir ? join(fromDir, "package.json") : undefined,
    join(fromDir ?? process.cwd(), "index.js"),
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    try {
      const req = createRequire(file);
      return req("playwright") as PlaywrightModule;
    } catch {
      // try next
    }
  }
  try {
    return createRequire(import.meta.url)("playwright") as PlaywrightModule;
  } catch {
    return null;
  }
}

function installPlaywrightLocally(): void {
  const tools = getToolsDir();
  mkdirSync(tools, { recursive: true });
  const pkg = join(tools, "package.json");
  if (!existsSync(pkg)) {
    writeFileSync(
      pkg,
      `${JSON.stringify({ name: "coursecopilot-tools", private: true }, null, 2)}\n`,
      "utf8",
    );
  }
  log.info("Installing Playwright into", tools, "(one-time, optional)");
  const npm = spawnSync("npm", ["install", "playwright@1"], {
    cwd: tools,
    stdio: "inherit",
    env: process.env,
  });
  if (npm.status !== 0) {
    throw new Error(
      `npm install playwright failed (exit ${npm.status}). ${PLAYWRIGHT_INSTALL_HINT}`,
    );
  }
  const browsers = spawnSync("npx", ["playwright", "install", "chromium"], {
    cwd: tools,
    stdio: "inherit",
    env: process.env,
  });
  if (browsers.status !== 0) {
    throw new Error(
      `playwright install chromium failed (exit ${browsers.status}). ${PLAYWRIGHT_INSTALL_HINT}`,
    );
  }
}
