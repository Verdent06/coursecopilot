import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import { fail, ok } from "../tool-result.js";

/**
 * Delete a source and its documents/chunks.
 */
export const removeSourceInputSchema = z.object({
  source_id: z.string().describe("Source id returned by add_source"),
});

export const removeSourceOutputSchema = z.object({
  removed_chunks: z.number(),
});

export function registerRemoveSource(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "remove_source",
    {
      title: "Remove source",
      description: "Delete a source and all of its documents and chunks.",
      inputSchema: removeSourceInputSchema,
      outputSchema: removeSourceOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ source_id }) => {
      try {
        const result = repo.removeSource(source_id);
        return ok(result, `Removed source ${source_id} (${result.removed_chunks} chunks)`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
