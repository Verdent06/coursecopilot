import { SERVER_NAME } from "../version.js";
import {
  claudeCodeEntry,
  claudeDesktopEntry,
  claudeMcpAddArgs,
  cursorDeeplink,
  cursorEntry,
  geminiCliEntry,
  geminiMcpAddArgs,
  stdioServerSpec,
} from "./command.js";
import type { LocalClientId } from "./types.js";

export function manualJsonSnippet(id: LocalClientId): string {
  const entry =
    id === "claude-code"
      ? claudeCodeEntry()
      : id === "cursor"
        ? cursorEntry()
        : id === "gemini"
          ? geminiCliEntry()
          : claudeDesktopEntry();
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2);
}

export function manualClientHelp(): string {
  const spec = stdioServerSpec();
  const npx = `${spec.command} ${spec.args.join(" ")}`;
  return [
    "Manual fallbacks (if setup could not write a file):",
    "",
    "Claude Desktop — claude_desktop_config.json",
    manualJsonSnippet("claude-desktop"),
    "",
    `Claude Code: claude ${claudeMcpAddArgs().join(" ")}`,
    `Gemini CLI:  gemini ${geminiMcpAddArgs().join(" ")}`,
    "",
    `Cursor deeplink: ${cursorDeeplink()}`,
    `Cursor JSON (~/.cursor/mcp.json): command ${npx}`,
  ].join("\n");
}
