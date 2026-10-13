import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLivePages } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * List Canvas wiki pages for a course (live API). Read-only.
 */
export const canvasListPagesInputSchema = z.object({
  canvas_course_id: z.string().describe("Canvas course id"),
  search: z.string().optional().describe("Optional title/url filter"),
});

export const canvasListPagesOutputSchema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        updated_at: z.string().nullable(),
      }),
    )
    .optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasListPages(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_list_pages",
    {
      title: "Canvas: list pages",
      description: "List wiki pages in a Canvas course. Use canvas_get_page for the body.",
      inputSchema: canvasListPagesInputSchema,
      outputSchema: canvasListPagesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id, search }) => {
      try {
        const pages = await listLivePages(runtime, canvas_course_id, search);
        const text =
          pages.length === 0 ? "No pages." : pages.map((p) => `${p.title} (${p.id})`).join("\n");
        return ok({ pages }, text);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
