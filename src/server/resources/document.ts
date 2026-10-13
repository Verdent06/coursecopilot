import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CourseRepo } from "../../db/repo.js";
import type { HybridSearch } from "../../retrieve/hybrid.js";

export const DOCUMENT_URI_TEMPLATE = "coursecopilot://document/{id}";

export function registerDocumentResource(
  server: McpServer,
  repo: CourseRepo,
  search: HybridSearch,
): void {
  server.registerResource(
    "document",
    new ResourceTemplate(DOCUMENT_URI_TEMPLATE, {
      list: async () => {
        const courses = repo.listCourses();
        const resources = [];
        for (const course of courses) {
          const chunks = repo.listChunksForCourse(course.course_id);
          const seen = new Set<string>();
          for (const chunk of chunks) {
            if (seen.has(chunk.document_id)) {
              continue;
            }
            seen.add(chunk.document_id);
            const doc = repo.getDocument(chunk.document_id);
            resources.push({
              uri: `coursecopilot://document/${chunk.document_id}`,
              name: doc?.title ?? chunk.document_id,
              mimeType: "text/markdown",
            });
          }
        }
        return { resources };
      },
    }),
    {
      title: "Document",
      description: "Full extracted Markdown for an ingested document.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = String(variables.id ?? "");
      const doc = search.getDocument(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# ${doc.title}\n\n${doc.text}`,
          },
        ],
      };
    },
  );
}
