import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../util/log.js";
import { getSecretsPath } from "../util/paths.js";
import { getRequestScope } from "../util/scope.js";
import { CANVAS_ERROR, CanvasApiError } from "./errors.js";
import { normalizeCanvasBaseUrl } from "./uri.js";

export type CanvasCredentials = {
  baseUrl: string;
  token: string;
};

type SecretsFile = {
  canvas?: {
    base_url?: string;
    token?: string;
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
  const path = getSecretsPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = readSecretsFile() ?? {};
  const next: SecretsFile = {
    ...existing,
    canvas: {
      base_url: normalizeCanvasBaseUrl(creds.baseUrl),
      token: creds.token,
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
