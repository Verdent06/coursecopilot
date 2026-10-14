import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { canvasConnectionStatus } from "../../canvas/auth.js";
import { hostedPageLink } from "../hosted-link.js";
import type { AppContext } from "../index.js";
import { fail, ok } from "../tool-result.js";

/**
 * Guide a new user through in-chat onboarding: connector check, then Canvas,
 * packs, website, YouTube, or file upload. No terminal required on the hosted path.
 */
export const getStartedInputSchema = z.object({});

export const getStartedOutputSchema = z.object({
  new_user: z.boolean(),
  courses: z.array(z.string()),
  canvas_connected: z.boolean(),
  next_steps: z.array(z.string()),
  canvas_url: z.string().nullable(),
  leccap_url: z.string().nullable(),
  upload_url: z.string().nullable(),
});

export function registerGetStarted(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_started",
    {
      title: "Get started",
      description:
        "Onboarding for a new student. Returns whether they have courses, and the next in-chat steps (connect Canvas, browse packs, add a website or YouTube, or open an upload link). Call this first when the user is new or asks how to begin.",
      inputSchema: getStartedInputSchema,
      outputSchema: getStartedOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const courses = ctx.repo.listCourses();
        const canvas = hostedPageLink(ctx.hosted, "canvas");
        const leccap = hostedPageLink(ctx.hosted, "leccap");
        const upload = hostedPageLink(ctx.hosted, "upload");
        const newUser = courses.length === 0;
        const next: string[] = [];
        if (newUser) {
          next.push(
            "Offer browse_packs (try harvard-cs50x) or add_course_website with their syllabus URL.",
          );
          next.push(
            "If they use Canvas, call connect_canvas. Guide the Calendar → Calendar Feed ICS URL first (no token). Many schools block student tokens.",
          );
          next.push(
            "If they have lecture PDFs, call upload_files and ask them to open the upload link.",
          );
          next.push("YouTube playlists: add_youtube. UMich recordings: connect_leccap.");
        } else {
          next.push(
            "They already have courses. Use list_courses, search_course, or quiz_me_on_misses.",
          );
          next.push(
            "To add more material: browse_packs, add_course_website, add_youtube, upload_files, connect_canvas.",
          );
        }
        const payload = {
          new_user: newUser,
          courses: courses.map((c) => c.course_id),
          canvas_connected: canvasConnectionStatus().connected,
          next_steps: next,
          canvas_url: canvas.url,
          leccap_url: leccap.url,
          upload_url: upload.url,
        };
        const text = newUser
          ? `Welcome to CourseCopilot. You have no courses yet.\n${next.map((s, i) => `${i + 1}. ${s}`).join("\n")}${canvas.url ? `\nCanvas: ${canvas.url}` : ""}${upload.url ? `\nUpload: ${upload.url}` : ""}`
          : `You have ${courses.length} course(s): ${payload.courses.join(", ")}.\n${next.join("\n")}`;
        return ok(payload, text);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
