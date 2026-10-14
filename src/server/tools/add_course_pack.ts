import type { McpServer } from "@modelcontextprotocol/server";
import { RepoError } from "../../db/repo.js";
import { PackError } from "../../packs/schema.js";
import type { PackService } from "../../packs/service.js";
import { fail, ok } from "../tool-result.js";
import { addPackInputSchema, addPackOutputSchema } from "./add_pack.js";

/**
 * Chat-friendly alias of add_pack. Install a registry pack (links + topic map only).
 */
export function registerAddCoursePack(server: McpServer, packs: PackService): void {
  server.registerTool(
    "add_course_pack",
    {
      title: "Add course pack",
      description:
        "Install a shareable course pack by registry id (for example harvard-cs50x), URL, or path. Same as add_pack: links and a topic map only, no copyrighted files. Poll get_ingest_status with the job_ids.",
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
