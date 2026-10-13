import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLiveFiles } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * List Canvas files. Falls back to module File items when /files is 403.
 */
export const canvasListFilesInputSchema = z.object({
  canvas_course_id: z.string().describe("Canvas course id"),
  search: z.string().optional().describe("Optional filename filter"),
});

export const canvasListFilesOutputSchema = z.object({
  files: z
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

export function registerCanvasListFiles(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_list_files",
    {
      title: "Canvas: list files",
      description:
        "List files in a Canvas course. If the course files API is 403 (common for students), files are collected from module items instead.",
      inputSchema: canvasListFilesInputSchema,
      outputSchema: canvasListFilesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id, search }) => {
      try {
        const files = await listLiveFiles(runtime, canvas_course_id, search);
        const text =
          files.length === 0 ? "No files." : files.map((f) => `${f.title} (${f.id})`).join("\n");
        return ok({ files }, text);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
