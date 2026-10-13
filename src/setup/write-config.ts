import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type JsonObject, SERVER_KEY } from "./types.js";

export type MergeOk = {
  ok: true;
  action: "created" | "merged" | "unchanged";
  path: string;
  backup?: string;
  previous: JsonObject;
  next: JsonObject;
};

export type MergeFail = {
  ok: false;
  reason: "invalid_json" | "invalid_mcpServers";
  path: string;
  message: string;
  snippet: string;
};

export type MergeResult = MergeOk | MergeFail;

export type MergeMcpServerOptions = {
  path: string;
  entry: JsonObject;
  key?: string;
  dryRun?: boolean;
  now?: Date;
  /** Pretty-print indent. */
  space?: number;
};

/**
 * Backup (if the file exists), then set `mcpServers[key]` without touching
 * other top-level keys or other servers. Refuses to write if the file is not
 * valid JSON or `mcpServers` is present but not a plain object.
 */
export function mergeMcpServer(opts: MergeMcpServerOptions): MergeResult {
  const key = opts.key ?? SERVER_KEY;
  const snippet = JSON.stringify({ mcpServers: { [key]: opts.entry } }, null, 2);
  const existingRaw = readOptional(opts.path);
  if (existingRaw === null) {
    const next: JsonObject = { mcpServers: { [key]: opts.entry } };
    if (!opts.dryRun) {
      mkdirSync(dirname(opts.path), { recursive: true });
      writeJson(opts.path, next, opts.space);
    }
    return { ok: true, action: "created", path: opts.path, previous: {}, next };
  }

  const parsed = parseJsonObject(existingRaw);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "invalid_json",
      path: opts.path,
      message: `Refusing to write ${opts.path}: ${parsed.message}. Fix the JSON or add this snippet by hand:\n${snippet}`,
      snippet,
    };
  }

  const root = parsed.value;
  const serversRaw = root.mcpServers;
  if (serversRaw !== undefined && !isPlainObject(serversRaw)) {
    return {
      ok: false,
      reason: "invalid_mcpServers",
      path: opts.path,
      message: `Refusing to write ${opts.path}: mcpServers is not an object. Add this snippet by hand:\n${snippet}`,
      snippet,
    };
  }

  const servers: JsonObject = isPlainObject(serversRaw) ? { ...serversRaw } : {};
  const prevEntry = servers[key];
  if (jsonEqual(prevEntry, opts.entry)) {
    return { ok: true, action: "unchanged", path: opts.path, previous: root, next: root };
  }

  servers[key] = opts.entry;
  const next: JsonObject = { ...root, mcpServers: servers };
  let backup: string | undefined;
  if (!opts.dryRun) {
    backup = writeBackup(opts.path, opts.now ?? new Date());
    mkdirSync(dirname(opts.path), { recursive: true });
    writeJson(opts.path, next, opts.space);
  }
  return {
    ok: true,
    action: "merged",
    path: opts.path,
    backup,
    previous: root,
    next,
  };
}

export function readMcpServers(
  path: string,
): { ok: true; servers: JsonObject } | { ok: false; message: string } {
  const raw = readOptional(path);
  if (raw === null) {
    return { ok: true, servers: {} };
  }
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const servers = parsed.value.mcpServers;
  if (servers === undefined) {
    return { ok: true, servers: {} };
  }
  if (!isPlainObject(servers)) {
    return { ok: false, message: "mcpServers is not an object" };
  }
  return { ok: true, servers };
}

export function backupPath(file: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${file}.bak-${stamp}`;
}

export function writeBackup(file: string, now: Date): string {
  const dest = backupPath(file, now);
  copyFileSync(file, dest);
  return dest;
}

export function formatJsonDiff(previous: JsonObject, next: JsonObject): string {
  const before = JSON.stringify(previous, null, 2);
  const after = JSON.stringify(next, null, 2);
  if (before === after) {
    return "(no changes)";
  }
  return `--- before\n${before}\n+++ after\n${after}`;
}

function readOptional(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function parseJsonObject(
  raw: string,
): { ok: true; value: JsonObject } | { ok: false; message: string } {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(value)) {
      return { ok: false, message: "top-level JSON is not an object" };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function writeJson(file: string, value: JsonObject, space = 2): void {
  writeFileSync(file, `${JSON.stringify(value, null, space)}\n`, "utf8");
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
