import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { canvasConnectionStatus } from "../../canvas/auth.js";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { ok } from "../tool-result.js";

/**
 * Guide Canvas connect: calendar ICS first, then the session extension, then PAT.
 * Never ask them to paste a token or ICS URL into chat (both are secrets).
 */
export const connectCanvasInputSchema = z.object({});

export const connectCanvasOutputSchema = z.object({
  url: z.string().nullable(),
  connected: z.boolean(),
  connected_via: z.array(z.enum(["pat", "ics", "extension"])),
  pairing_code: z.string().nullable(),
  pairing_expires_at: z.string().nullable(),
  extension_url: z.string().nullable(),
  instructions: z.string(),
});

export function registerConnectCanvas(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "connect_canvas",
    {
      title: "Connect Canvas",
      description:
        "Connect Canvas without a personal token when the school blocks them (UMich and many others). Guide the calendar ICS feed first (due dates), then the browser extension (full read via the signed-in session), then a personal token only if the school still allows it. Do not ask them to paste a token or ICS URL into this chat. After they finish, list assignments or courses.",
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
      const status = canvasConnectionStatus();
      const link = hostedPageLink(ctx.hosted, "canvas");
      const pairing = ctx.hosted?.createPairingCode?.();
      const extensionUrl = ctx.hosted?.publicUrl ? `${ctx.hosted.publicUrl}/extension` : null;
      const pairingLine = pairing
        ? `Pairing code for the extension: ${pairing.code} (expires ${new Date(pairing.expiresAt * 1000).toISOString()}). Host: ${ctx.hosted?.publicUrl ?? ""}.`
        : "";
      const tiers = [
        "Tier 1 (no install): Canvas → Calendar → Calendar Feed (bottom of the calendar). Copy the ICS URL and paste it on the hosted page — never in this chat. That gives every due date across courses.",
        `Tier 2 (full read): install the CourseCopilot Sync browser extension (Chrome/Edge/Firefox, Manifest V3)${extensionUrl ? ` — ${extensionUrl}` : " (see the repo’s extension/ folder)"}. Stay signed into Canvas via SSO. Pair with the one-time code, then Sync. Read-only; you click Sync.`,
        "Tier 3 (optional): personal access token only if Account → Settings still shows + New Access Token. Paste it on the hosted page, never in chat.",
      ];
      const instructions = status.connected
        ? `Canvas is already connected via ${status.via.join(", ")}.${link.url ? ` Open ${link.url} only to replace a feed or token.` : ""} ${pairingLine}`.trim()
        : link.url
          ? `${tiers.join("\n")}\nOpen this page (ICS form, pairing code, optional token): ${link.url}\n${pairingLine}`.trim()
          : `${tiers.join("\n")}\n${link.hint}\nAdvanced: \`npx coursecopilot canvas connect --ics-url <feed>\`.`;
      return ok(
        {
          url: link.url,
          connected: status.connected,
          connected_via: status.via,
          pairing_code: pairing?.code ?? null,
          pairing_expires_at: pairing ? new Date(pairing.expiresAt * 1000).toISOString() : null,
          extension_url: extensionUrl,
          instructions,
        },
        instructions,
      );
    },
  );
}
