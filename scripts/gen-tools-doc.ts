#!/usr/bin/env npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseToolDocs, renderToolsMarkdown } from "../src/setup/tools-doc.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = join(root, "src", "server", "tools");
const dest = join(root, "docs", "tools.md");
const markdown = renderToolsMarkdown(parseToolDocs(toolsDir));
const check = process.argv.includes("--check");

if (check) {
  const current = readFileSync(dest, "utf8");
  if (current !== markdown) {
    process.stderr.write("docs/tools.md is stale. Run: npx tsx scripts/gen-tools-doc.ts\n");
    process.exit(1);
  }
  process.stdout.write("docs/tools.md up to date\n");
  process.exit(0);
}

writeFileSync(dest, markdown);
process.stdout.write(`Wrote ${dest}\n`);
