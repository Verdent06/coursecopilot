import {
  claudeCodeEntry,
  claudeDesktopEntry,
  cursorEntry,
  geminiCliEntry,
  isCourseCopilotEntry,
} from "./command.js";
import {
  claudeCodeConfigPath,
  claudeDesktopAppPaths,
  claudeDesktopConfigPath,
  claudeDesktopConfigPathAliases,
  clientConfigPath,
  cursorAppPaths,
  cursorConfigPath,
  geminiCliConfigPath,
} from "./paths.js";
import type { ClientEntry, DetectedClient, LocalClientId, SetupContext } from "./types.js";
import { CLIENT_NAMES, LOCAL_CLIENTS } from "./types.js";
import { readMcpServers } from "./write-config.js";

export function detectClients(ctx: SetupContext): DetectedClient[] {
  return LOCAL_CLIENTS.map((id) => detectClient(id, ctx));
}

export function detectClient(id: LocalClientId, ctx: SetupContext): DetectedClient {
  switch (id) {
    case "claude-desktop":
      return detectClaudeDesktop(ctx);
    case "claude-code":
      return detectClaudeCode(ctx);
    case "cursor":
      return detectCursor(ctx);
    case "gemini":
      return detectGeminiCli(ctx);
  }
}

export function detectClaudeDesktop(ctx: SetupContext): DetectedClient {
  const configPath = claudeDesktopConfigPath(ctx);
  const reasons: string[] = [];
  for (const file of claudeDesktopConfigPathAliases(ctx)) {
    if (ctx.exists(file)) {
      reasons.push(`config ${file}`);
    } else if (ctx.exists(ctx.path.dirname(file))) {
      reasons.push(`config dir ${ctx.path.dirname(file)}`);
    }
  }
  for (const app of claudeDesktopAppPaths(ctx)) {
    if (ctx.exists(app)) {
      reasons.push(`app ${app}`);
    }
  }
  return {
    id: "claude-desktop",
    name: CLIENT_NAMES["claude-desktop"],
    detected: reasons.length > 0,
    configPath,
    reasons,
  };
}

export function detectClaudeCode(ctx: SetupContext): DetectedClient {
  const configPath = claudeCodeConfigPath(ctx);
  const reasons: string[] = [];
  const bin = ctx.which("claude");
  if (bin) {
    reasons.push(`binary ${bin}`);
  }
  if (ctx.exists(configPath)) {
    reasons.push(`config ${configPath}`);
  }
  const claudeDir = ctx.path.join(ctx.homedir, ".claude");
  if (ctx.exists(claudeDir)) {
    reasons.push(`dir ${claudeDir}`);
  }
  return {
    id: "claude-code",
    name: CLIENT_NAMES["claude-code"],
    detected: reasons.length > 0,
    configPath,
    reasons,
    bin,
  };
}

export function detectCursor(ctx: SetupContext): DetectedClient {
  const configPath = cursorConfigPath(ctx);
  const reasons: string[] = [];
  const cursorDir = ctx.path.join(ctx.homedir, ".cursor");
  if (ctx.exists(configPath)) {
    reasons.push(`config ${configPath}`);
  } else if (ctx.exists(cursorDir)) {
    reasons.push(`dir ${cursorDir}`);
  }
  for (const app of cursorAppPaths(ctx)) {
    if (ctx.exists(app)) {
      reasons.push(`app ${app}`);
    }
  }
  return {
    id: "cursor",
    name: CLIENT_NAMES.cursor,
    detected: reasons.length > 0,
    configPath,
    reasons,
  };
}

export function detectGeminiCli(ctx: SetupContext): DetectedClient {
  const configPath = geminiCliConfigPath(ctx);
  const reasons: string[] = [];
  const bin = ctx.which("gemini");
  if (bin) {
    reasons.push(`binary ${bin}`);
  }
  if (ctx.exists(configPath)) {
    reasons.push(`config ${configPath}`);
  }
  const geminiDir = ctx.path.join(ctx.homedir, ".gemini");
  if (ctx.exists(geminiDir)) {
    reasons.push(`dir ${geminiDir}`);
  }
  return {
    id: "gemini",
    name: CLIENT_NAMES.gemini,
    detected: reasons.length > 0,
    configPath,
    reasons,
    bin,
  };
}

export function entryForClient(id: LocalClientId): ClientEntry {
  switch (id) {
    case "claude-desktop":
      return claudeDesktopEntry();
    case "claude-code":
      return claudeCodeEntry();
    case "cursor":
      return cursorEntry();
    case "gemini":
      return geminiCliEntry();
  }
}

export function readClientEntry(
  id: LocalClientId,
  ctx: SetupContext,
): { ok: true; entry: unknown | undefined } | { ok: false; message: string } {
  const path = clientConfigPath(id, ctx);
  if (!ctx.exists(path)) {
    return { ok: true, entry: undefined };
  }
  const servers = readMcpServers(path);
  if (!servers.ok) {
    return { ok: false, message: servers.message };
  }
  return { ok: true, entry: servers.servers.coursecopilot };
}

export function clientHasValidEntry(
  id: LocalClientId,
  ctx: SetupContext,
): {
  ok: boolean;
  message: string;
} {
  const path = clientConfigPath(id, ctx);
  if (!ctx.exists(path)) {
    return { ok: false, message: `${path} does not exist` };
  }
  const read = readClientEntry(id, ctx);
  if (!read.ok) {
    return { ok: false, message: `invalid JSON in ${path}: ${read.message}` };
  }
  if (!isCourseCopilotEntry(read.entry)) {
    return { ok: false, message: `${path} has no valid mcpServers.coursecopilot entry` };
  }
  return { ok: true, message: `coursecopilot is configured in ${path}` };
}
