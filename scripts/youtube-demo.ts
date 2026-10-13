/**
 * Spawn dist/cli.js over stdio, ingest a public lecture video + playlist,
 * run search_course, and print timestamped citations. Used for the M5 PR.
 *
 * Network required. Not part of CI.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const VIDEO = process.env.CC_YT_VIDEO ?? "https://www.youtube.com/watch?v=fNk_zzaMoSs";
const PLAYLIST =
  process.env.CC_YT_PLAYLIST ??
  "https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab";
const QUERIES = (
  process.env.CC_YT_QUERIES ??
  "linear combination of vectors;basis vectors i-hat j-hat;span of two vectors"
).split(";");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-yt-demo-"));

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;
env.COURSECOPILOT_DISABLE_EMBEDDINGS = env.COURSECOPILOT_DISABLE_EMBEDDINGS ?? "1";

const client = new Client({ name: "youtube-demo", version: "0.0.0" });
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

async function waitJob(jobId: string, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await client.callTool({
      name: "get_ingest_status",
      arguments: { job_id: jobId },
    });
    const jobs = (status.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
    const job = jobs[0];
    process.stdout.write(
      `  … ${JSON.stringify({ state: job?.state, message: job?.message, docs: job?.docs, chunks: job?.chunks })}\n`,
    );
    if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${jobId}`);
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
  process.stdout.write(`video: ${VIDEO}\nplaylist: ${PLAYLIST}\nhome: ${home}\n`);

  await call("add_course", { title: "Essence of linear algebra", course_id: "3b1b-lin-alg" });

  const queuedVideo = await call("add_source", {
    course_id: "3b1b-lin-alg",
    kind: "youtube",
    uri: VIDEO,
    options: { lecture_no: 1 },
  });
  const videoJob = (queuedVideo.structuredContent as { job_id: string }).job_id;
  const videoDone = await waitJob(videoJob);
  process.stdout.write(`video job: ${JSON.stringify(videoDone, null, 2)}\n`);

  const queuedPl = await call("add_source", {
    course_id: "3b1b-lin-alg",
    kind: "youtube",
    uri: PLAYLIST,
  });
  const plJob = (queuedPl.structuredContent as { job_id: string }).job_id;
  const plDone = await waitJob(plJob, 600_000);
  process.stdout.write(`playlist job: ${JSON.stringify(plDone, null, 2)}\n`);

  await call("list_sources", { course_id: "3b1b-lin-alg" });

  for (const query of QUERIES) {
    process.stdout.write(`\n--- search_course ${JSON.stringify(query)} ---\n`);
    await call("search_course", {
      course_id: "3b1b-lin-alg",
      query,
      k: 5,
      source_kinds: ["youtube"],
    });
  }

  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
