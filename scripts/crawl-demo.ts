/**
 * Spawn dist/cli.js over stdio, crawl a public course site, run search_course.
 * Used for the M4 PR description. Network required.
 *
 * Usage: npx tsx scripts/crawl-demo.ts [url]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-crawl-demo-"));
const seed =
  process.argv[2] ??
  "https://ocw.mit.edu/courses/6-045j-automata-computability-and-complexity-spring-2011/";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;
env.COURSECOPILOT_CRAWL_DELAY_MS = env.COURSECOPILOT_CRAWL_DELAY_MS ?? "400";

const client = new Client({ name: "crawl-demo", version: "0.0.0" });
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
  process.stdout.write(`seed: ${seed}\n`);

  await call("add_course", {
    title: "Automata, Computability, and Complexity",
    term: "Spring 2011",
    course_id: "mit-6045-s11",
  });
  const queued = await call("add_source", {
    course_id: "mit-6045-s11",
    kind: "website",
    uri: seed,
    options: { max_depth: 2, max_pages: 20 },
  });
  const jobId = (queued.structuredContent as { job_id: string } | undefined)?.job_id;
  if (!jobId) {
    throw new Error("add_source did not return a job_id");
  }

  const start = Date.now();
  let job: Record<string, unknown> | undefined;
  while (Date.now() - start < 300_000) {
    const status = await client.callTool({
      name: "get_ingest_status",
      arguments: { job_id: jobId },
    });
    const jobs = (status.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
    job = jobs[0];
    process.stdout.write(`status: ${job?.state} ${job?.message}\n`);
    if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write(`get_ingest_status: ${JSON.stringify(job, null, 2)}\n`);

  const queries = [
    "pumping lemma",
    "Turing machine decidable language",
    "nonregular languages",
    "context-free grammar",
  ];
  for (const query of queries) {
    process.stdout.write(`\n--- search_course ${JSON.stringify(query)} ---\n`);
    await call("search_course", { course_id: "mit-6045-s11", query, k: 5 });
  }

  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
