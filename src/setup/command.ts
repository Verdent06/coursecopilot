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

export function claudeMcpAddArgs(): string[] {
  const spec = stdioServerSpec();
  return ["mcp", "add", "-s", "user", SERVER_NAME, "--", spec.command, ...spec.args];
}

export function geminiMcpAddArgs(): string[] {
  const spec = stdioServerSpec();
  return ["mcp", "add", "-s", "user", SERVER_NAME, spec.command, ...spec.args];
}

/**
 * Cursor one-click install link.
 * https://cursor.com/docs/mcp/install-links
 */
export function cursorDeeplink(spec: StdioServerSpec = stdioServerSpec()): string {
  const config = Buffer.from(
    JSON.stringify({ command: spec.command, args: spec.args }),
    "utf8",
  ).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
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
