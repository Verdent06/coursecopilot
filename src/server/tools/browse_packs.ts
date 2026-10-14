import type { McpServer } from "@modelcontextprotocol/server";
import { PackError } from "../../packs/schema.js";
import type { PackService } from "../../packs/service.js";
import { fail, ok } from "../tool-result.js";
import { listPacksInputSchema, listPacksOutputSchema } from "./list_packs.js";

/**
 * Chat-friendly alias of list_packs. Browse the public registry.
 */
export function registerBrowsePacks(server: McpServer, packs: PackService): void {
  server.registerTool(
    "browse_packs",
    {
      title: "Browse packs",
      description:
        "List public course packs (CS50, MIT OCW, Stanford notes, …) and which are already installed. Same as list_packs. Then call add_course_pack with an id.",
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
                    `${p.id}: ${p.name}${p.term ? ` (${p.term})` : ""}${p.institution ? ` — ${p.institution}` : ""} — ${p.source_count} sources${p.installed ? " [installed]" : ""}`,
                )
                .join("\n");
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof PackError ? err.message : String(err));
      }
    },
  );
}
