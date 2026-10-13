/**
 * Spawn dist/cli.js over stdio: quiz context → record results → weak_spots change.
 * Used for the M8 PR description.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeSampleFolder } from "../test/helpers/sample-files.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-learn-demo-"));
const sampleDir = join(home, "course-files");
await writeSampleFolder(sampleDir);

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;

const client = new Client({ name: "learn-demo", version: "0.0.0" });
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
  const prompts = await client.listPrompts();
  process.stdout.write(
    `prompts: ${prompts.prompts
      .map((p) => p.name)
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

  const pumping = await call("search_course", {
    course_id: "eecs376-f26",
    query: "pumping lemma proof that a^n b^n is not regular",
    k: 3,
  });
  const office = await call("search_course", {
    course_id: "eecs376-f26",
    query: "office hours Beyster",
    k: 3,
  });
  const pumpingId = (pumping.structuredContent as { results: Array<{ chunk_id: number }> })
    .results[0]?.chunk_id;
  const officeId = (
    office.structuredContent as { results: Array<{ chunk_id: number; text: string }> }
  ).results.find((r) => /office hours/i.test(r.text))?.chunk_id;

  await call("set_topics", {
    course_id: "eecs376-f26",
    topics: [
      { name: "Pumping lemma", chunk_ids: pumpingId != null ? [pumpingId] : [] },
      { name: "Office hours", chunk_ids: officeId != null ? [officeId] : [] },
    ],
  });

  await call("generate_quiz_context", { course_id: "eecs376-f26", n: 3, focus: "all" });
  process.stdout.write("\n--- weak_spots BEFORE recording ---\n");
  await call("get_weak_spots", { course_id: "eecs376-f26", limit: 5 });

  await call("record_quiz_attempt", {
    course_id: "eecs376-f26",
    mode: "quiz",
    items: [
      {
        topic: "Pumping lemma",
        question: "State the pumping lemma.",
        user_answer: "no idea",
        correct: false,
        difficulty: 2,
        cited_chunk_ids: pumpingId != null ? [pumpingId] : [],
      },
      {
        topic: "Pumping lemma",
        question: "Prove a^n b^n is not regular.",
        user_answer: "it is regular",
        correct: false,
        difficulty: 2,
      },
      {
        topic: "Office hours",
        question: "When are office hours?",
        user_answer: "Tuesdays at 3pm",
        correct: true,
        difficulty: 1,
      },
    ],
  });

  process.stdout.write("\n--- weak_spots AFTER two misses on Pumping lemma ---\n");
  await call("get_weak_spots", { course_id: "eecs376-f26", limit: 5 });

  await call("set_exam", {
    course_id: "eecs376-f26",
    name: "Midterm",
    date: "2026-10-20",
    topics: ["Pumping lemma"],
    weight: 0.25,
  });
  await call("get_study_plan", {
    course_id: "eecs376-f26",
    exam_name: "Midterm",
    minutes_per_day: 60,
  });

  const prompt = await client.getPrompt({
    name: "quiz_me_on_misses",
    arguments: { course_id: "eecs376-f26" },
  });
  const content = prompt.messages[0]?.content;
  const text = content && typeof content === "object" && "text" in content ? content.text : "";
  process.stdout.write(`\nquiz_me_on_misses:\n${String(text).slice(0, 1200)}\n`);

  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
