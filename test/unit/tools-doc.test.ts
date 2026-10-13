import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseToolDocs, renderToolsMarkdown } from "../../src/setup/tools-doc.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("tools doc generator", () => {
  it("parses every registered tool and matches docs/tools.md", () => {
    const docs = parseToolDocs(join(repoRoot, "src", "server", "tools"));
    const names = docs.map((d) => d.name);
    expect(names).toContain("search_course");
    expect(names).toContain("add_pack");
    expect(names).toContain("canvas_list_assignments");
    expect(names).toContain("generate_quiz_context");
    expect(docs.some((d) => d.openWorld)).toBe(true);
    expect(docs.find((d) => d.name === "search_course")?.readOnly).toBe(true);
    expect(docs.find((d) => d.name === "remove_source")?.destructive).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    const markdown = renderToolsMarkdown(docs);
    expect(readFileSync(join(repoRoot, "docs", "tools.md"), "utf8")).toBe(markdown);
  });
});
