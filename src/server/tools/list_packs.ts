import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PackError } from "../../packs/schema.js";
import type { PackService } from "../../packs/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * List packs from the cached registry index (24 h) and/or locally installed packs.
 */
export const listPacksInputSchema = z.object({
  query: z.string().optional().describe("Optional substring filter on id, name, term, institution"),
  installed_only: z.boolean().optional().describe("If true, only packs already installed locally"),
});

export const listPacksOutputSchema = z.object({
  packs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      term: z.string().nullable(),
      institution: z.string().nullable(),
      source_count: z.number(),
      installed: z.boolean(),
      verified: z.boolean(),
    }),
  ),
});

export function registerListPacks(server: McpServer, packs: PackService): void {
  server.registerTool(
    "list_packs",
    {
      title: "List packs",
      description:
        "List course packs from the public registry index (cached 24h) and mark which are installed. Use installed_only to skip the network.",
      inputSchema: listPacksInputSchema,
      outputSchema: listPacksOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, installed_only }) => {
      try {
        const result = await packs.listPacks({ query, installed_only });
        const text =
          result.packs.length === 0
            ? "No packs found."
            : result.packs
                .map(
                  (p) =>
                    `${p.id}: ${p.name}${p.term ? ` (${p.term})` : ""}${p.institution ? ` — ${p.institution}` : ""} — ${p.source_count} sources${p.installed ? " [installed]" : ""}${p.verified ? " [verified]" : ""}`,
                )
                .join("\n");
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof PackError ? err.message : String(err));
      }
    },
  );
}
