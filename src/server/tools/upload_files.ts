import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { ok } from "../tool-result.js";

/**
 * Return a hosted upload page for PDF/PPTX/Markdown/TXT. Remote mode cannot
 * read the student's laptop disk.
 */
export const uploadFilesInputSchema = z.object({
  course_id: z.string().optional().describe("Optional existing course to attach files to"),
});

export const uploadFilesOutputSchema = z.object({
  url: z.string().nullable(),
  instructions: z.string(),
});

export function registerUploadFiles(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "upload_files",
    {
      title: "Upload files",
      description:
        "Return a hosted browser upload page for PDF, PPTX, Markdown, or TXT. Use this instead of local file paths when talking over Claude/ChatGPT/Gemini. After upload, poll get_ingest_status.",
      inputSchema: uploadFilesInputSchema,
      outputSchema: uploadFilesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ course_id }) => {
      const link = hostedPageLink(ctx.hosted, "upload");
      const extra = course_id ? ` You can enter course id ${course_id} on the form.` : "";
      const instructions = link.url
        ? `Open this link and drop your lecture PDFs/slides:${extra} ${link.url}`
        : link.hint;
      return ok({ url: link.url, instructions }, instructions);
    },
  );
}
