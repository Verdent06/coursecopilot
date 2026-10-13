import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getSessionPath } from "../../util/paths.js";
import type { LectureCaptureSession } from "./types.js";

export const SESSION_EXPIRED_MESSAGE = `Your UMich Lecture Capture session expired or is missing. Recordings need a signed-in UMich login (Shibboleth/Okta + Duo). CourseCopilot never stores your password.

Sign in again (opens a real browser window):
  npx coursecopilot login leccap

Or import cookies you exported from a signed-in browser:
  npx coursecopilot login leccap --cookies cookies.json`;

export function sessionPath(provider: string): string {
  return getSessionPath(provider);
}

export function loadSession(provider: string): LectureCaptureSession | null {
  const path = sessionPath(provider);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const session = normalizeSession(raw);
    return session.cookies.length > 0 ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(provider: string, session: LectureCaptureSession): string {
  const path = sessionPath(provider);
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(
    {
      cookies: session.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? "/",
      })),
    },
    null,
    2,
  );
  writeFileSync(path, `${body}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore mode; the file is still local-only.
  }
  return path;
}

export function cookieHeader(session: LectureCaptureSession, host?: string): string {
  return session.cookies
    .filter((c) => !host || cookieMatchesHost(c.domain, host))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function cookieMatchesHost(domain: string | undefined, host: string): boolean {
  if (!domain) {
    return true;
  }
  const d = domain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Parse Playwright storageState, Netscape cookies.txt, or a {name:value} map. */
export function parseCookieFile(content: string, filename?: string): LectureCaptureSession {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new Error(`Cookie file ${filename ?? ""} is empty.`);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return normalizeSession(JSON.parse(trimmed) as unknown);
  }
  return { cookies: parseNetscape(trimmed) };
}

function normalizeSession(raw: unknown): LectureCaptureSession {
  if (!raw || typeof raw !== "object") {
    throw new Error("Cookie file is not a JSON object or Netscape cookies.txt.");
  }
  if (Array.isArray(raw)) {
    return {
      cookies: raw.map(cookieFromUnknown).filter(Boolean) as LectureCaptureSession["cookies"],
    };
  }
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.cookies)) {
    return {
      cookies: obj.cookies
        .map(cookieFromUnknown)
        .filter(Boolean) as LectureCaptureSession["cookies"],
    };
  }
  const cookies: LectureCaptureSession["cookies"] = [];
  for (const [name, value] of Object.entries(obj)) {
    if (typeof value === "string" && name !== "origins") {
      cookies.push({ name, value, path: "/" });
    }
  }
  if (cookies.length === 0) {
    throw new Error("Cookie file has no cookies.");
  }
  return { cookies };
}

function cookieFromUnknown(value: unknown): LectureCaptureSession["cookies"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const c = value as Record<string, unknown>;
  if (typeof c.name !== "string" || typeof c.value !== "string") {
    return null;
  }
  return {
    name: c.name,
    value: c.value,
    domain: typeof c.domain === "string" ? c.domain : undefined,
    path: typeof c.path === "string" ? c.path : "/",
  };
}

function parseNetscape(text: string): LectureCaptureSession["cookies"] {
  const cookies: LectureCaptureSession["cookies"] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
      continue;
    }
    const httpOnly = line.startsWith("#HttpOnly_");
    const body = httpOnly ? line.slice("#HttpOnly_".length) : line;
    const parts = body.split("\t");
    if (parts.length < 7) {
      continue;
    }
    const domain = parts[0];
    const path = parts[2];
    const name = parts[5];
    const value = parts[6];
    if (!name || value == null || !domain) {
      continue;
    }
    cookies.push({ name, value, domain, path: path || "/" });
  }
  if (cookies.length === 0) {
    throw new Error("Netscape cookies.txt contained no cookie rows.");
  }
  return cookies;
}
