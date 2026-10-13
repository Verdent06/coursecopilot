import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";

export const LOCAL_CLIENTS = ["claude-desktop", "claude-code", "cursor", "gemini"] as const;
export type LocalClientId = (typeof LOCAL_CLIENTS)[number];

export const CLIENT_NAMES: Record<LocalClientId, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini CLI",
};

export const SERVER_KEY = "coursecopilot";

export type JsonObject = Record<string, unknown>;

export type RunCommandResult = { status: number; stdout: string; stderr: string };

export type RunCommandFn = (command: string, args: string[]) => RunCommandResult;

export type SetupContext = {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
  /** Path helpers. Override with `path.win32` to assert Windows strings on POSIX. */
  path: path.PlatformPath;
  exists: (p: string) => boolean;
  which: (cmd: string) => string | undefined;
  runCommand: RunCommandFn;
  now: Date;
};

export type DetectedClient = {
  id: LocalClientId;
  name: string;
  detected: boolean;
  configPath: string;
  reasons: string[];
  bin?: string;
};

export type ClientEntry = JsonObject;

export function parseClientIds(raw: string[] | string | undefined): LocalClientId[] | undefined {
  if (raw == null) {
    return undefined;
  }
  const bits = (Array.isArray(raw) ? raw : [raw]).flatMap((s) =>
    s
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
  if (bits.length === 0) {
    return undefined;
  }
  const out: LocalClientId[] = [];
  for (const bit of bits) {
    const id = normalizeClientId(bit);
    if (!id) {
      throw new Error(
        `Unknown client "${bit}". Use claude-desktop, claude-code, cursor, or gemini.`,
      );
    }
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

export function normalizeClientId(raw: string): LocalClientId | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "claude-desktop" || s === "claude_desktop" || s === "desktop") {
    return "claude-desktop";
  }
  if (s === "claude-code" || s === "claude_code" || s === "code") {
    return "claude-code";
  }
  if (s === "cursor") {
    return "cursor";
  }
  if (s === "gemini" || s === "gemini-cli" || s === "gemini_cli") {
    return "gemini";
  }
  return undefined;
}

export function createSetupContext(overrides: Partial<SetupContext> = {}): SetupContext {
  const platform = overrides.platform ?? process.platform;
  const env = overrides.env ?? process.env;
  const homedir = overrides.homedir ?? env.HOME ?? env.USERPROFILE ?? env.HOMEPATH ?? osHomedir();
  return {
    platform,
    homedir,
    env,
    path: overrides.path ?? path,
    exists: overrides.exists ?? ((p) => existsSync(p)),
    which: overrides.which ?? ((cmd) => whichImpl(cmd, platform)),
    runCommand: overrides.runCommand ?? defaultRunCommand,
    now: overrides.now ?? new Date(),
  };
}

export function defaultRunCommand(command: string, args: string[]): RunCommandResult {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 25_000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  return {
    status: r.status ?? (r.error ? 1 : 0),
    stdout: r.stdout ?? "",
    stderr: r.stderr || r.error?.message || "",
  };
}

export function whichImpl(
  cmd: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const finder = platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, [cmd], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    return undefined;
  }
  const line = (r.stdout ?? "").trim().split(/\r?\n/)[0];
  return line && existsSync(line) ? line : line || undefined;
}
