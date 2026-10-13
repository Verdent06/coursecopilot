/**
 * Spawn dist/cli.js over stdio, add a course, ingest a sample folder (PDF+PPTX+MD+TXT),
 * print job status and chunk locators. Used for the M2 PR description.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Database from "better-sqlite3";
import { writeSampleFolder } from "../test/helpers/sample-files.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-ingest-demo-"));
const sampleDir = join(home, "course-files");
await writeSampleFolder(sampleDir);

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;

const client = new Client({ name: "ingest-demo", version: "0.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "cli.js")],
  cwd: root,
  env,
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  process.stdout.write(
    `tools: ${tools.tools
      .map((t) => t.name)
      .sort()
      .join(", ")}\n`,
  );

  const added = await client.callTool({
    name: "add_course",
    arguments: { title: "EECS 376", term: "F26", course_id: "eecs376-f26" },
  });
  process.stdout.write(`add_course: ${JSON.stringify(added.structuredContent)}\n`);

  const queued = await client.callTool({
    name: "add_source",
    arguments: { course_id: "eecs376-f26", kind: "folder", uri: sampleDir },
  });
  process.stdout.write(`add_source: ${JSON.stringify(queued.structuredContent)}\n`);
  const jobId = (queued.structuredContent as { job_id: string }).job_id;

  const start = Date.now();
  let job: Record<string, unknown> | undefined;
  while (Date.now() - start < 30_000) {
    const status = await client.callTool({
      name: "get_ingest_status",
      arguments: { job_id: jobId },
    });
    const jobs = (status.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
    job = jobs[0];
    if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  process.stdout.write(`get_ingest_status: ${JSON.stringify(job, null, 2)}\n`);

  const sources = await client.callTool({
    name: "list_sources",
    arguments: { course_id: "eecs376-f26" },
  });
  process.stdout.write(`list_sources: ${JSON.stringify(sources.structuredContent, null, 2)}\n`);

  const db = new Database(join(home, "cc.db"), { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        "SELECT id, heading_path, locator_json, substr(text, 1, 160) AS text FROM chunks ORDER BY id",
      )
      .all();
    process.stdout.write(`chunks: ${JSON.stringify(rows, null, 2)}\n`);
  } finally {
    db.close();
  }

  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
