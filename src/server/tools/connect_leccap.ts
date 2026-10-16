import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadSession } from "../../ingest/lecture-capture/session.js";
import { loadLeccapSnapshot } from "../../ingest/lecture-capture/snapshot.js";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { ok } from "../tool-result.js";

/**
 * Leccap: browser extension (session fetch) first; cookie paste is fallback.
 */
export const connectLeccapInputSchema = z.object({});

export const connectLeccapOutputSchema = z.object({
  url: z.string().nullable(),
  connected: z.boolean(),
  pairing_code: z.string().nullable(),
  pairing_expires_at: z.string().nullable(),
  extension_url: z.string().nullable(),
  instructions: z.string(),
  limitation: z.string(),
});

export function registerConnectLeccap(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "connect_leccap",
    {
      title: "Connect lecture capture",
      description:
        "Attach UMich CAEN Lecture Capture without copying cookies. Prefer the CourseCopilot Sync browser extension (same pairing code as Canvas) while signed into leccap via SSO/Duo; it reads captions and the slide timeline from the product/webvtt APIs. Cookie paste remains a fallback. After sync, add_source kind leccap with the site URL.",
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
      const already = Boolean(loadSession("leccap") || loadLeccapSnapshot());
      const link = hostedPageLink(ctx.hosted, "leccap");
      const pairing = ctx.hosted?.createPairingCode?.();
      const extensionUrl = ctx.hosted?.publicUrl ? `${ctx.hosted.publicUrl}/extension` : null;
      const pairingLine = pairing
        ? `Pairing code: ${pairing.code} (expires ${new Date(pairing.expiresAt * 1000).toISOString()}). Host: ${ctx.hosted?.publicUrl ?? ""}.`
        : "";
      const limitation =
        "UMich Weblogin + Duo must happen in the student’s browser. The extension uses that session in-place (no cookie export). Cookie paste still works if they prefer. Self-host Advanced: headed Playwright via `login leccap`.";
      const instructions = link.url
        ? `${already ? "A leccap session or extension snapshot is already saved. " : ""}Preferred: install CourseCopilot Sync${extensionUrl ? ` (${extensionUrl})` : ""}, pair it, open a signed-in leccap.engin.umich.edu tab, Sync. ${pairingLine} Fallback page (cookie paste): ${link.url}`
        : `${link.hint} ${pairingLine}`.trim();
      return ok(
        {
          url: link.url,
          connected: already,
          pairing_code: pairing?.code ?? null,
          pairing_expires_at: pairing ? new Date(pairing.expiresAt * 1000).toISOString() : null,
          extension_url: extensionUrl,
          instructions,
          limitation,
        },
        `${instructions}\n${limitation}`,
      );
    },
  );
}
