import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadSession } from "../../ingest/lecture-capture/session.js";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { ok } from "../tool-result.js";

/**
 * Return a hosted lecture-capture handoff page (cookie paste or bookmarklet).
 * UMich SSO + Duo cannot run on the server.
 */
export const connectLeccapInputSchema = z.object({});

export const connectLeccapOutputSchema = z.object({
  url: z.string().nullable(),
  connected: z.boolean(),
  instructions: z.string(),
  limitation: z.string(),
});

export function registerConnectLeccap(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "connect_leccap",
    {
      title: "Connect lecture capture",
      description:
        "Return a hosted page to attach a UMich CAEN Lecture Capture session. Duo/SSO cannot run on the server: the user pastes exported cookies or uses a bookmarklet. After that, add_source kind leccap with the site URL.",
      inputSchema: connectLeccapInputSchema,
      outputSchema: connectLeccapOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const already = Boolean(loadSession("leccap"));
      const link = hostedPageLink(ctx.hosted, "leccap");
      const limitation =
        "UMich Weblogin + Duo requires the student's own browser. HttpOnly SSO cookies are invisible to a bookmarklet; a cookie-export extension (storageState / cookies.txt) is the reliable hosted path. Self-host Advanced: headed Playwright via `login leccap`.";
      const instructions = link.url
        ? `${already ? "A leccap session is already saved. " : ""}Open ${link.url} and paste cookies from a signed-in leccap.engin.umich.edu tab, then add the site URL with add_source kind leccap.`
        : link.hint;
      return ok({ url: link.url, connected: already, instructions, limitation }, instructions);
    },
  );
}
