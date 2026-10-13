/**
 * Spawn dist/cli.js over stdio, ingest sample fixtures, run search_course queries.
 * Used for the M3 PR description.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeSampleFolder } from "../test/helpers/sample-files.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-search-demo-"));
const sampleDir = join(home, "course-files");
await writeSampleFolder(sampleDir);

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;

const client = new Client({ name: "search-demo", version: "0.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "cli.js")],
  cwd: root,
  env,
  stderr: "pipe",
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  process.stdout.write(`${name}: ${JSON.stringify(res.structuredContent, null, 2)}\n`);
  if (res.isError) {
    process.stdout.write(`${name} ERROR text: ${JSON.stringify(res.content)}\n`);
  }
  return res;
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  process.stdout.write(
    `tools: ${tools.tools
      .map((t) => t.name)
      .sort()
      .join(", ")}\n`,
  );

  await call("add_course", { title: "EECS 376", term: "F26", course_id: "eecs376-f26" });
  const queued = await call("add_source", {
    course_id: "eecs376-f26",
    kind: "folder",
    uri: sampleDir,
  });
  const jobId = (queued.structuredContent as { job_id: string }).job_id;

  const start = Date.now();
  let job: Record<string, unknown> | undefined;
  while (Date.now() - start < 180_000) {
    const status = await client.callTool({
      name: "get_ingest_status",
      arguments: { job_id: jobId },
    });
    const jobs = (status.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
    job = jobs[0];
    if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.stdout.write(`get_ingest_status: ${JSON.stringify(job, null, 2)}\n`);

  const queries = [
    "pumping lemma proof that a^n b^n is not regular",
    "office hours Beyster",
    "speaker notes pumping lemma hypotheses",
    "regular languages DFA review",
  ];
  for (const query of queries) {
    process.stdout.write(`\n--- search_course ${JSON.stringify(query)} ---\n`);
    await call("search_course", { course_id: "eecs376-f26", query, k: 3 });
  }

  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
