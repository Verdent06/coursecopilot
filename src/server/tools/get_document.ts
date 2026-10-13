import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";
import { fail, ok } from "../tool-result.js";

/**
 * Full extracted text for a document (same payload as coursecopilot://document/{id}).
 */
export const getDocumentInputSchema = z.object({
  document_id: z.string().describe("Document id from a citation"),
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

export const getDocumentOutputSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  mime: z.string().nullable(),
  url: z.string().nullable(),
  text: z.string(),
  chunks: z.array(
    z.object({
      chunk_id: z.number(),
      text: z.string(),
      document_id: z.string(),
      ord: z.number(),
      citation: citationSchema,
    }),
  ),
});

export function registerGetDocument(server: McpServer, search: HybridSearch): void {
  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description:
        "Return the full extracted text of a document, with per-chunk citations (page or slide).",
      inputSchema: getDocumentInputSchema,
      outputSchema: getDocumentOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ document_id }) => {
      try {
        const result = search.getDocument(document_id);
        const head = result.chunks[0]?.citation.label ?? result.title;
        return ok(result, `${head}\n\n${result.text.slice(0, 4000)}`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
