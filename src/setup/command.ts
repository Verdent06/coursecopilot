import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_NAME } from "../version.js";

export type StdioServerSpec = {
  command: string;
  args: string[];
};

/**
 * Default stdio launch used in every local client config (spec §12).
 * `COURSECOPILOT_SETUP_LOCAL=1` points at this checkout's `dist/cli.js` instead
 * of npm (useful while developing before publish).
 */
export function stdioServerSpec(): StdioServerSpec {
  if (process.env.COURSECOPILOT_SETUP_LOCAL === "1") {
    return {
      command: process.execPath,
      args: [join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js")],
    };
  }
  return { command: "npx", args: ["-y", `${SERVER_NAME}@latest`] };
}

export function claudeDesktopEntry(): StdioServerSpec {
  return stdioServerSpec();
}

/** Claude Code user-scope stdio entry (`~/.claude.json` → mcpServers). */
export function claudeCodeEntry(): JsonStdioEntry {
  const spec = stdioServerSpec();
  return { type: "stdio", command: spec.command, args: spec.args };
}

export function cursorEntry(): StdioServerSpec {
  return stdioServerSpec();
}

export function geminiCliEntry(): StdioServerSpec {
  return stdioServerSpec();
}

export type JsonStdioEntry = StdioServerSpec & { type?: "stdio" };

/** Spec §12 published stdio entry. Independent of COURSECOPILOT_SETUP_LOCAL. */
export const PUBLISHED_STDIO_SPEC: StdioServerSpec = {
  command: "npx",
  args: ["-y", `${SERVER_NAME}@latest`],
};

export const CURSOR_INSTALL_BADGE_SRC = "https://cursor.com/deeplink/mcp-install-dark.svg";

export function claudeMcpAddArgs(spec: StdioServerSpec = stdioServerSpec()): string[] {
  return ["mcp", "add", "-s", "user", SERVER_NAME, "--", spec.command, ...spec.args];
}

export function geminiMcpAddArgs(spec: StdioServerSpec = stdioServerSpec()): string[] {
  return ["mcp", "add", "-s", "user", SERVER_NAME, spec.command, ...spec.args];
}

export function claudeCodeOneLiner(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  return `claude ${claudeMcpAddArgs(spec).join(" ")}`;
}

export function geminiCliOneLiner(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  return `gemini ${geminiMcpAddArgs(spec).join(" ")}`;
}

export function cursorConfigJson(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  return JSON.stringify({ command: spec.command, args: spec.args });
}

export function cursorConfigBase64(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  return Buffer.from(cursorConfigJson(spec), "utf8").toString("base64");
}

/**
 * Cursor one-click install link.
 * https://cursor.com/docs/mcp/install-links
 */
export function cursorDeeplink(spec: StdioServerSpec = stdioServerSpec()): string {
  const config = cursorConfigBase64(spec);
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** HTTPS install page (works as a README badge href; GitHub does not open cursor://). */
export function cursorHttpsInstallUrl(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  const config = cursorConfigBase64(spec);
  return `https://cursor.com/en/install-mcp?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

export function cursorInstallBadgeMarkdown(spec: StdioServerSpec = PUBLISHED_STDIO_SPEC): string {
  return `[![Install MCP Server in Cursor](${CURSOR_INSTALL_BADGE_SRC})](${cursorHttpsInstallUrl(spec)})`;
}

export function decodeCursorDeeplink(url: string): { name: string; config: StdioServerSpec } {
  const parsed = new URL(url);
  const name = parsed.searchParams.get("name") ?? "";
  const b64 = parsed.searchParams.get("config") ?? "";
  const json = Buffer.from(b64, "base64").toString("utf8");
  const config = JSON.parse(json) as StdioServerSpec;
  return { name, config };
}

export function isCourseCopilotEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const rec = entry as Record<string, unknown>;
  if (typeof rec.command === "string") {
    const args = Array.isArray(rec.args) ? rec.args.map(String) : [];
    const blob = [rec.command, ...args].join(" ");
    return /coursecopilot/i.test(blob);
  }
  const url = rec.url ?? rec.httpUrl ?? rec.serverUrl;
  return typeof url === "string" && url.length > 0;
}

export function sameStdioEntry(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  if (String(left.command ?? "") !== String(right.command ?? "")) {
    return false;
  }
  const la = Array.isArray(left.args) ? left.args.map(String) : [];
  const ra = Array.isArray(right.args) ? right.args.map(String) : [];
  if (la.length !== ra.length) {
    return false;
  }
  return la.every((v, i) => v === ra[i]);
}
