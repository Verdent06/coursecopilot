import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, getLivePage } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * Fetch one Canvas page body as Markdown (live API). Read-only.
 */
export const canvasGetPageInputSchema = z.object({
  canvas_course_id: z.string().describe("Canvas course id"),
  page_url: z.string().describe("Page url slug from canvas_list_pages (not the full https URL)"),
});

export const canvasGetPageOutputSchema = z.object({
  title: z.string().optional(),
  body_markdown: z.string().optional(),
  html_url: z.string().optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasGetPage(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_get_page",
    {
      title: "Canvas: get page",
      description: "Fetch a Canvas wiki page and return its body as Markdown. Read-only.",
      inputSchema: canvasGetPageInputSchema,
      outputSchema: canvasGetPageOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id, page_url }) => {
      try {
        const page = await getLivePage(runtime, canvas_course_id, page_url);
        return ok(page, `${page.title}\n\n${page.body_markdown}`);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
