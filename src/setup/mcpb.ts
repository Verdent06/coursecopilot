import { SERVER_NAME, VERSION } from "../version.js";
import { stdioServerSpec } from "./command.js";

/**
 * MCPB `server.mcp_config` shape (same fields Claude Desktop writes for a
 * Node extension). Tokens stay in MCPB `user_config` (sensitive), never in
 * `claude_desktop_config.json`. The packed `.mcpb` is a M13 release artifact;
 * `manifest.json` at the repo root is the source.
 */
export function mcpbCompatibleEntry(): {
  command: string;
  args: string[];
} {
  const spec = stdioServerSpec();
  return { command: spec.command, args: spec.args };
}

export function mcpbInstallInstructions(): string {
  return [
    "Claude Desktop .mcpb (optional, same server):",
    "  After a GitHub Release, double-click coursecopilot.mcpb",
    "  or Settings → Extensions → Advanced settings → Install Extension…",
    "  Docs: https://claude.com/docs/connectors/building/mcpb",
    "  MCPB user_config (optional, marked sensitive): canvas_base_url, canvas_token.",
    "  Prefer `coursecopilot canvas connect` so the token is not stored in a client config.",
    `  Manifest name is "${SERVER_NAME}" v${VERSION} (must match serverInfo.name).`,
  ].join("\n");
}
