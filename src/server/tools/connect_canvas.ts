import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadCanvasCredentials } from "../../canvas/auth.js";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { ok } from "../tool-result.js";

/**
 * Return a hosted page where the student pastes their Canvas URL and personal
 * access token. Never ask them to paste the token into chat.
 */
export const connectCanvasInputSchema = z.object({});

export const connectCanvasOutputSchema = z.object({
  url: z.string().nullable(),
  connected: z.boolean(),
  instructions: z.string(),
});

export function registerConnectCanvas(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "connect_canvas",
    {
      title: "Connect Canvas",
      description:
        "Return a link to a small hosted page where the user pastes their Canvas instance URL and personal access token. Do not ask them to paste the token into this chat. After they finish, list Canvas courses.",
      inputSchema: connectCanvasInputSchema,
      outputSchema: connectCanvasOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const already = Boolean(loadCanvasCredentials());
      const link = hostedPageLink(ctx.hosted, "canvas");
      const instructions = link.url
        ? already
          ? `Canvas is already connected for this library. Open ${link.url} only if you need to replace the token.`
          : `Open this link, paste your Canvas URL and token (Account → Settings → Approved Integrations → + New Access Token), then come back: ${link.url}`
        : already
          ? "Canvas is already connected on this machine."
          : link.hint;
      return ok({ url: link.url, connected: already, instructions }, instructions);
    },
  );
}
