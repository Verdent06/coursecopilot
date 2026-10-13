import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { VERSION } from "../version.js";
import { createServer } from "./index.js";

/**
 * Stdio transport adapter. HTTP lives behind a separate adapter (M8) so an SDK
 * v1 fallback stays cheap if a client rejects spec 2026-07-28.
 */
export function startStdio(): void {
  serveStdio(() => createServer());
  console.error(`coursecopilot MCP server v${VERSION} running on stdio`);
}
