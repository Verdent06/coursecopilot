import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../util/log.js";
import { getSecretsPath } from "../util/paths.js";
import { getRequestScope } from "../util/scope.js";
import { CANVAS_ERROR, CanvasApiError } from "./errors.js";
import { loadCanvasSnapshot } from "./snapshot.js";
import { normalizeCanvasBaseUrl } from "./uri.js";

export type CanvasCredentials = {
  baseUrl: string;
  token: string;
};

export type CanvasVia = "pat" | "ics" | "extension";

export type CanvasConnectionStatus = {
  connected: boolean;
  via: CanvasVia[];
};

type SecretsFile = {
  canvas?: {
    base_url?: string;
    token?: string;
    ics_url?: string;
  };
};

/**
 * Resolve Canvas credentials. Env (`CANVAS_BASE_URL`, `CANVAS_TOKEN`) wins so a
 * self-hosted remote instance can set them without writing a secrets file.
 * Otherwise `~/.coursecopilot/secrets.json` (0600). Never the DB.
 */
export function loadCanvasCredentials(): CanvasCredentials | null {
  const scope = getRequestScope();
  const allowEnv = scope?.allowEnvSecrets !== false;
  const envToken = allowEnv ? process.env.CANVAS_TOKEN?.trim() : undefined;
  const envBase = allowEnv ? process.env.CANVAS_BASE_URL?.trim() : undefined;
  const file = readSecretsFile();
  const fileToken = file?.canvas?.token?.trim();
  const fileBase = file?.canvas?.base_url?.trim();
  const token = envToken || fileToken;
  const baseRaw = envBase || fileBase;
  if (!token || !baseRaw) {
    return null;
  }
  try {
    return { token, baseUrl: normalizeCanvasBaseUrl(baseRaw) };
  } catch (err) {
    log.warn("invalid CANVAS_BASE_URL / secrets.canvas.base_url", err);
    return null;
  }
}

export function requireCanvasCredentials(): CanvasCredentials {
  const creds = loadCanvasCredentials();
  if (!creds) {
    throw new CanvasApiError({ code: CANVAS_ERROR.notConfigured });
  }
  return creds;
}

export function saveCanvasCredentials(creds: CanvasCredentials): string {
  return writeSecrets({
    base_url: normalizeCanvasBaseUrl(creds.baseUrl),
    token: creds.token,
  });
}

export function loadCanvasIcsUrl(): string | null {
  const scope = getRequestScope();
  const allowEnv = scope?.allowEnvSecrets !== false;
  const envUrl = allowEnv ? process.env.CANVAS_ICS_URL?.trim() : undefined;
  const fileUrl = readSecretsFile()?.canvas?.ics_url?.trim();
  const raw = envUrl || fileUrl;
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    log.warn("invalid CANVAS_ICS_URL / secrets.canvas.ics_url");
    return null;
  }
}

export function saveCanvasIcsUrl(icsUrl: string): string {
  let href: string;
  try {
    const url = new URL(icsUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("not http(s)");
    }
    href = url.href;
  } catch {
    throw new Error("Invalid calendar feed URL. Copy it from Canvas → Calendar → Calendar Feed.");
  }
  return writeSecrets({ ics_url: href });
}

export function canvasConnectionStatus(): CanvasConnectionStatus {
  const via: CanvasVia[] = [];
  if (loadCanvasCredentials()) {
    via.push("pat");
  }
  if (loadCanvasIcsUrl()) {
    via.push("ics");
  }
  if (loadCanvasSnapshot()) {
    via.push("extension");
  }
  return { connected: via.length > 0, via };
}

function writeSecrets(patch: NonNullable<SecretsFile["canvas"]>): string {
  const path = getSecretsPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = readSecretsFile() ?? {};
  const next: SecretsFile = {
    ...existing,
    canvas: {
      ...existing.canvas,
      ...patch,
    },
  };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore mode bits.
  }
  return path;
}

function readSecretsFile(): SecretsFile | null {
  const path = getSecretsPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as SecretsFile;
  } catch (err) {
    log.warn("could not read secrets.json", err);
    return null;
  }
}
