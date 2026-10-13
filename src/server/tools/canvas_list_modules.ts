import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLiveModules } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * List Canvas modules and items for a course (live API). Read-only.
 */
export const canvasListModulesInputSchema = z.object({
  canvas_course_id: z.string().describe("Canvas course id (from canvas_list_courses)"),
});

export const canvasListModulesOutputSchema = z.object({
  modules: z
    .array(
      z.object({
        module: z.string(),
        items: z.array(
          z.object({
            type: z.string(),
            title: z.string(),
            html_url: z.string(),
            locked: z.boolean(),
          }),
        ),
      }),
    )
    .optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasListModules(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_list_modules",
    {
      title: "Canvas: list modules",
      description: "List modules and items for a Canvas course. Read-only live API.",
      inputSchema: canvasListModulesInputSchema,
      outputSchema: canvasListModulesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id }) => {
      try {
        const modules = await listLiveModules(runtime, canvas_course_id);
        const text = modules
          .map((m) => `${m.module}: ${m.items.map((i) => i.title).join(", ") || "(empty)"}`)
          .join("\n");
        return ok({ modules }, text || "No modules.");
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
