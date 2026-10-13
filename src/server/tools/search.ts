import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";
import { fail, ok } from "../tool-result.js";

/**
 * ChatGPT / OpenAI Deep Research compatible `search` alias over `search_course`.
 * Schema: https://developers.openai.com/api/docs/mcp
 */
export const searchInputSchema = z.object({
  query: z.string().describe("Natural-language or keyword query over course materials"),
});

export const searchOutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
    }),
  ),
});

export function registerSearch(server: McpServer, search: HybridSearch): void {
  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Search indexed course materials. ChatGPT-compatible alias of search_course. Use this when… you need cited snippets from the student's courses. Returns id/title/url; call fetch with an id for full text.",
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }) => {
      try {
        const result = await search.search({ query });
        const payload = {
          results: result.results.map((r) => ({
            id: String(r.chunk_id),
            title: r.citation.title || r.citation.label,
            url: r.citation.url,
          })),
        };
        return ok(payload, JSON.stringify(payload));
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
