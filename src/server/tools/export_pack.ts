import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { PackError, packManifestSchema } from "../../packs/schema.js";
import type { PackService } from "../../packs/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * Write a shareable pack manifest from a local course. Drops Canvas,
 * lecture-capture (leccap), and local files. Never includes course content.
 */
export const exportPackInputSchema = z.object({
  course_id: z.string().describe("Course slug to export"),
  include_local_paths: z
    .boolean()
    .optional()
    .describe(
      "If true, mention local file paths under connect_yourself. They are still not exported as sources.",
    ),
});

export const exportPackOutputSchema = z.object({
  manifest: packManifestSchema,
  path: z.string().optional(),
  warnings: z.array(z.string()),
});

export function registerExportPack(server: McpServer, packs: PackService): void {
  server.registerTool(
    "export_pack",
    {
      title: "Export pack",
      description:
        "Create a pack manifest from a local course (links and topic map only). Drops Canvas, login-gated lecture-capture (leccap), and local files, and may include a connect_yourself placeholder so classmates attach those themselves.",
      inputSchema: exportPackInputSchema,
      outputSchema: exportPackOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, include_local_paths }) => {
      try {
        const result = packs.exportPack(course_id, { include_local_paths });
        const dropped = result.warnings.length;
        return ok(
          result,
          `Exported pack ${result.manifest.id} with ${result.manifest.sources.length} source(s)` +
            (dropped ? ` (${dropped} dropped; see connect_yourself)` : ""),
        );
      } catch (err) {
        return fail(
          err instanceof PackError || err instanceof RepoError ? err.message : String(err),
        );
      }
    },
  );
}
