import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";
import { fail, ok } from "../tool-result.js";

/**
 * ChatGPT / OpenAI Deep Research compatible `fetch` alias over `get_chunk` /
 * `get_document`. Schema: https://developers.openai.com/api/docs/mcp
 */
export const fetchInputSchema = z.object({
  id: z.string().describe("Chunk id from search, or a document_id"),
});

export const fetchOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function registerFetch(server: McpServer, search: HybridSearch): void {
  server.registerTool(
    "fetch",
    {
      title: "Fetch",
      description:
        "Fetch the full text of a search result. ChatGPT-compatible alias of get_chunk. Pass the id returned by search (a chunk id) or a document_id.",
      inputSchema: fetchInputSchema,
      outputSchema: fetchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const payload = load(search, id);
        return ok(payload, JSON.stringify(payload));
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}

function load(
  search: HybridSearch,
  id: string,
): {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, unknown>;
} {
  const trimmed = id.trim();
  const chunkMatch = trimmed.match(/^(?:chunk:)?(\d+)$/);
  if (chunkMatch?.[1]) {
    const chunkId = Number(chunkMatch[1]);
    const got = search.getChunk(chunkId, 1);
    return {
      id: String(got.chunk.chunk_id),
      title: got.citation.title || got.citation.label,
      text: [got.chunk.text, ...got.neighbors.map((n) => n.text)].join("\n\n"),
      url: got.citation.url,
      metadata: {
        chunk_id: got.chunk.chunk_id,
        document_id: got.chunk.document_id,
        label: got.citation.label,
      },
    };
  }
  const docId = trimmed.replace(/^doc:/, "");
  const doc = search.getDocument(docId);
  return {
    id: doc.document_id,
    title: doc.title,
    text: doc.text,
    url: doc.url ?? doc.chunks[0]?.citation.url ?? "",
    metadata: { document_id: doc.document_id, chunk_count: doc.chunks.length },
  };
}
