import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";
import { fail, ok } from "../tool-result.js";

/**
 * Fetch one chunk plus neighbors for extra context.
 */
export const getChunkInputSchema = z.object({
  chunk_id: z.number().int().describe("Chunk id from search_course"),
  context: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("Neighbor chunks on each side (default 1)"),
});

const citationSchema = z.object({
  label: z.string(),
  kind: z.string(),
  url: z.string(),
  title: z.string(),
  page: z.number().nullable(),
  slide: z.number().nullable(),
  anchor: z.string().nullable(),
  start_s: z.number().nullable(),
  end_s: z.number().nullable(),
  source_id: z.string(),
  document_id: z.string(),
  chunk_id: z.number(),
});

const chunkViewSchema = z.object({
  chunk_id: z.number(),
  text: z.string(),
  document_id: z.string(),
  ord: z.number(),
  citation: citationSchema,
});

export const getChunkOutputSchema = z.object({
  chunk: chunkViewSchema,
  neighbors: z.array(chunkViewSchema),
  citation: citationSchema,
});

export function registerGetChunk(server: McpServer, search: HybridSearch): void {
  server.registerTool(
    "get_chunk",
    {
      title: "Get chunk",
      description:
        "Return a chunk and its neighbors. Cite the result with citation.label as a Markdown link to citation.url.",
      inputSchema: getChunkInputSchema,
      outputSchema: getChunkOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ chunk_id, context }) => {
      try {
        const result = search.getChunk(chunk_id, context ?? 1);
        return ok(result, `${result.citation.label}\n\n${result.chunk.text}`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
