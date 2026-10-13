import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { PackError } from "../../packs/schema.js";
import type { PackService } from "../../packs/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * Resolve a course pack (registry id, URL, or local path), create the course,
 * enqueue each source URL, and apply the lecture → topic map (origin pack).
 */
export const addPackInputSchema = z.object({
  pack: z.string().min(1).describe("Registry pack id, http(s) URL, or local manifest path"),
  course_id: z
    .string()
    .optional()
    .describe("Override the course slug (defaults to the pack id, dots become hyphens)"),
});

export const addPackOutputSchema = z.object({
  course_id: z.string(),
  pack_id: z.string(),
  job_ids: z.array(z.string()),
  skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
});

export function registerAddPack(server: McpServer, packs: PackService): void {
  server.registerTool(
    "add_pack",
    {
      title: "Add pack",
      description:
        "Install a course pack (links + topic map only, no copyrighted content). Resolves a registry id, URL, or path; creates the course; enqueues each source; applies the lecture→topic map. Poll get_ingest_status with the returned job_ids.",
      inputSchema: addPackInputSchema,
      outputSchema: addPackOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ pack, course_id }) => {
      try {
        const result = await packs.addPack(pack, { course_id });
        const skipNote =
          result.skipped.length > 0
            ? ` (${result.skipped.length} skipped: ${result.skipped.map((s) => s.reason).join("; ")})`
            : "";
        return ok(
          result,
          `Installed pack ${result.pack_id} as course ${result.course_id} (${result.job_ids.length} job(s))${skipNote}`,
        );
      } catch (err) {
        return fail(
          err instanceof PackError || err instanceof RepoError ? err.message : String(err),
        );
      }
    },
  );
}
