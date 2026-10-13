import { mkdirSync, readFileSync } from "node:fs";
import { getBrowserProfileDir } from "../../../util/paths.js";
import { loadPlaywright } from "../../lecture-capture/playwright.js";
import { sleep } from "../../lecture-capture/rate-limit.js";
import {
  loadSession,
  parseCookieFile,
  SESSION_EXPIRED_MESSAGE,
  saveSession,
} from "../../lecture-capture/session.js";
import type { LectureCaptureSession } from "../../lecture-capture/types.js";
import { SessionExpiredError } from "../../lecture-capture/types.js";
import { LECCAP_HOST, leccapOrigin } from "./parse.js";

export const LECCAP_PROVIDER = "leccap";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export function requireLeccapSession(): LectureCaptureSession {
  const session = loadSession(LECCAP_PROVIDER);
  if (!session) {
    throw new SessionExpiredError(SESSION_EXPIRED_MESSAGE);
  }
  return session;
}

export function importLeccapCookies(filePath: string): string {
  const content = readFileSync(filePath, "utf8");
  const session = parseCookieFile(content, filePath);
  if (session.cookies.length === 0) {
    throw new Error(`No cookies found in ${filePath}.`);
  }
  return saveSession(LECCAP_PROVIDER, session);
}

export type BrowserLoginOptions = {
  headed?: boolean;
  installPlaywright?: boolean;
  timeoutMs?: number;
  log?: (msg: string) => void;
};

/**
 * Open a headed Chromium window with a persistent profile. The user signs in
 * with UMich Weblogin / Okta + Duo. We never see or store the password.
 */
export async function loginLeccapBrowser(opts: BrowserLoginOptions = {}): Promise<string> {
  const log = opts.log ?? ((msg: string) => console.error(msg));
  const pw = await loadPlaywright({ installIfMissing: opts.installPlaywright !== false });
  const profile = getBrowserProfileDir(LECCAP_PROVIDER);
  mkdirSync(profile, { recursive: true });
  log(
    `Opening a browser. Sign in with your UMich account (Okta + Duo). Passwords are never stored.`,
  );
  log(`Profile: ${profile}`);

  const context = await pw.chromium.launchPersistentContext(profile, {
    headless: opts.headed === false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });

  try {
    const page = await context.newPage();
    const origin = leccapOrigin();
    await page.goto(`${origin}/leccap/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const url = page.url();
      if (isSignedInUrl(url)) {
        const cookies = await context.cookies();
        const session: LectureCaptureSession = {
          cookies: cookies
            .filter((c) => c.name && c.value)
            .map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path ?? "/",
            })),
        };
        if (sessionLooksValid(session)) {
          const path = saveSession(LECCAP_PROVIDER, session);
          log(`Saved session to ${path} (mode 0600). You can close the browser.`);
          return path;
        }
      }
      await sleep(1000);
    }
    throw new Error(
      `Timed out waiting for a UMich Lecture Capture login. ${SESSION_EXPIRED_MESSAGE}`,
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

function isSignedInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/(weblogin|okta|duo|shibboleth|login\.umich)/i.test(u.hostname + u.pathname)) {
      return false;
    }
    return u.hostname === LECCAP_HOST || u.hostname.endsWith(".engin.umich.edu");
  } catch {
    return false;
  }
}

function sessionLooksValid(session: LectureCaptureSession): boolean {
  if (session.cookies.length === 0) {
    return false;
  }
  return session.cookies.some((c) =>
    /leccap|umich|cosign|shibsession|_shibsession|okta|duo/i.test(`${c.domain ?? ""} ${c.name}`),
  );
}
