import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_NAME } from "../version.js";

export type StdioServerSpec = {
  command: string;
  args: string[];
};

/** Published stdio entry for README badges and post-npm-publish installs. */
export const PUBLISHED_STDIO_SPEC: StdioServerSpec = {
  command: "npx",
  args: ["-y", `${SERVER_NAME}@latest`],
};

export type ResolveStdioOptions = {
  env?: NodeJS.ProcessEnv;
  /** Package root (directory that contains package.json). */
  packageRoot?: string;
  /** Override published-on-npm detection. */
  published?: boolean | null;
};

/**
 * Directory that contains this package's `package.json`.
 * `src/setup/command.ts` and `dist/setup/command.js` are both two levels down.
 */
export function packageRootFromHere(from = import.meta.url): string {
  return join(dirname(fileURLToPath(from)), "..", "..");
}

/**
 * True when this process is a git/source checkout (has `src/cli.ts`) and is not
 * an `npm install` / `npx` copy under `node_modules`.
 */
export function isSourceCheckout(root = packageRootFromHere()): boolean {
  if (root.includes(`${sep}node_modules${sep}`) || root.endsWith(`${sep}node_modules`)) {
    return false;
  }
  return existsSync(join(root, "src", "cli.ts")) && existsSync(join(root, "package.json"));
}

/** Absolute `node` + `dist/cli.js` (or `src/cli.ts` before the first build). */
export function localStdioSpec(root = packageRootFromHere()): StdioServerSpec {
  const distCli = join(root, "dist", "cli.js");
  const srcCli = join(root, "src", "cli.ts");
  return { command: process.execPath, args: [existsSync(distCli) ? distCli : srcCli] };
}

/**
 * Default stdio launch used in every local client config.
 *
 * - `COURSECOPILOT_SETUP_NPX=1` → always `npx -y coursecopilot@latest`
 * - `COURSECOPILOT_SETUP_LOCAL=1` or a source checkout → this repo's
 *   absolute `node` + `dist/cli.js` (the npm package is unpublished)
 * - otherwise the published npx entry
 */
export function stdioServerSpec(opts: ResolveStdioOptions = {}): StdioServerSpec {
  const env = opts.env ?? process.env;
  const root = opts.packageRoot ?? packageRootFromHere();
  if (env.COURSECOPILOT_SETUP_NPX === "1") {
    return { ...PUBLISHED_STDIO_SPEC };
  }
  if (env.COURSECOPILOT_SETUP_LOCAL === "1" || isSourceCheckout(root)) {
    return localStdioSpec(root);
  }
  if (opts.published === false) {
    return localStdioSpec(root);
  }
  return { ...PUBLISHED_STDIO_SPEC };
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
