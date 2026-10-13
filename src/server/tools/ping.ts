import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { VERSION } from "../../version.js";
import { ok } from "../tool-result.js";

/**
 * Health-check tool from milestone M0. Not part of the v1 product tool table.
 */
export const pingInputSchema = z.object({});
export const pingOutputSchema = z.object({
  ok: z.literal(true),
  name: z.string(),
  version: z.string(),
});

export function registerPing(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check. Returns the server name and version.",
      inputSchema: pingInputSchema,
      outputSchema: pingOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ok({ ok: true as const, name: "coursecopilot", version: VERSION }),
  );
}
