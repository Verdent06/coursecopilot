import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import { fail, ok } from "../tool-result.js";

/**
 * List sources on a course. Structured output is `{ sources }` because MCP
 * structuredContent is an object; the spec table's array is the `sources` field.
 */
export const listSourcesInputSchema = z.object({
  course_id: z.string().describe("Course slug"),
});

export const listSourcesOutputSchema = z.object({
  sources: z.array(
    z.object({
      source_id: z.string(),
      kind: z.string(),
      uri: z.string(),
      status: z.string(),
      last_synced_at: z.string().nullable(),
      doc_count: z.number(),
    }),
  ),
});

export function registerListSources(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "list_sources",
    {
      title: "List sources",
      description: "List ingested sources for a course, with document counts.",
      inputSchema: listSourcesInputSchema,
      outputSchema: listSourcesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id }) => {
      try {
        const sources = repo.listSources(course_id);
        const text =
          sources.length === 0
            ? `No sources on ${course_id}. Call add_source to ingest files.`
            : sources
                .map((s) => `${s.source_id}: ${s.kind} ${s.uri} — ${s.status}, ${s.doc_count} docs`)
                .join("\n");
        return ok({ sources }, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
