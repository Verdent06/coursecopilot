import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { DEFAULT_K, MAX_K } from "../../retrieve/config.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";
import { fail, ok } from "../tool-result.js";

/**
 * Hybrid search (FTS5 BM25 + sqlite-vec, RRF merge) with citation objects.
 * Returns `{ results }` plus `degraded: "keyword_only"` when embeddings are unavailable.
 */
export const searchCourseInputSchema = z.object({
  query: z.string().describe("Natural-language or keyword query"),
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
  k: z
    .number()
    .int()
    .min(1)
    .max(MAX_K)
    .optional()
    .describe(`Number of results (default ${DEFAULT_K}, max ${MAX_K})`),
  source_kinds: z
    .array(z.enum(["website", "file", "folder", "youtube", "transcript", "canvas", "leccap"]))
    .optional()
    .describe("Restrict to these source kinds"),
  topic: z.string().optional().describe("Boost chunks whose heading or topic matches"),
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

export const searchCourseOutputSchema = z.object({
  results: z.array(
    z.object({
      chunk_id: z.number(),
      text: z.string(),
      score: z.number(),
      citation: citationSchema,
    }),
  ),
  degraded: z.literal("keyword_only").optional(),
});

export function registerSearchCourse(server: McpServer, search: HybridSearch): void {
  server.registerTool(
    "search_course",
    {
      title: "Search course",
      description:
        "Hybrid keyword + vector search over ingested course materials. Returns cited chunks. Render each citation.label as a Markdown link to citation.url. If results are empty, say the answer is not in the course materials.",
      inputSchema: searchCourseInputSchema,
      outputSchema: searchCourseOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, course_id, k, source_kinds, topic }) => {
      try {
        const result = await search.search({ query, course_id, k, source_kinds, topic });
        const text =
          result.results.length === 0
            ? "No matching course materials."
            : result.results
                .map(
                  (r, i) => `${i + 1}. ${r.citation.label} (${r.score})\n${r.text.slice(0, 280)}`,
                )
                .join("\n\n") +
              (result.degraded === "keyword_only" ? "\n\n(degraded: keyword_only)" : "");
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
