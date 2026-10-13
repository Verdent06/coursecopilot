import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { writeFixtureSite } from "../helpers/fixture-site.js";
import { writeSampleFolder } from "../helpers/sample-files.js";
import { serveDirectory } from "../helpers/static-server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliJs = join(repoRoot, "dist", "cli.js");

function spawnEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.COURSECOPILOT_HOME = home;
  env.COURSECOPILOT_CRAWL_DELAY_MS = "0";
  return env;
}

describe("MCP stdio e2e", () => {
  const homes: string[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  async function connect(): Promise<{ client: Client; home: string }> {
    const home = mkdtempSync(join(tmpdir(), "cc-e2e-"));
    homes.push(home);
    const client = new Client({ name: "coursecopilot-e2e", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliJs],
      cwd: repoRoot,
      env: spawnEnv(home),
      stderr: "pipe",
    });
    await client.connect(transport);
    clients.push(client);
    return { client, home };
  }

  async function waitForJob(
    client: Client,
    jobId: string,
    timeoutMs = 180_000,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await client.callTool({
        name: "get_ingest_status",
        arguments: { job_id: jobId },
      });
      expect(res.isError).toBeFalsy();
      const jobs = (res.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
      const job = jobs[0];
      if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
        return job;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for job ${jobId}`);
  }

  it("lists tools over stdio", async () => {
    const { client } = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_course",
      "add_pack",
      "add_source",
      "canvas_get_page",
      "canvas_list_announcements",
      "canvas_list_assignments",
      "canvas_list_courses",
      "canvas_list_files",
      "canvas_list_modules",
      "canvas_list_pages",
      "export_pack",
      "fetch",
      "generate_quiz_context",
      "get_chunk",
      "get_course_outline",
      "get_document",
      "get_ingest_status",
      "get_study_plan",
      "get_weak_spots",
      "list_courses",
      "list_packs",
      "list_sources",
      "ping",
      "record_quiz_attempt",
      "remove_source",
      "search",
      "search_course",
      "set_exam",
      "set_topics",
      "sync_course",
    ]);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name).sort()).toEqual([
      "add_my_course",
      "exam_prep",
      "explain_with_sources",
      "quiz_me",
      "quiz_me_on_misses",
      "study_session",
      "whats_due",
    ]);
    // Keep this log: captured for the PR description as protocol proof.
    console.log("tools/list", JSON.stringify(listed, null, 2));
    console.log(
      "prompts/list",
      JSON.stringify(
        prompts.prompts.map((p) => p.name),
        null,
        2,
      ),
    );
  });

  it("add_course → set_exam → list_courses → courses resource", async () => {
    const { client } = await connect();

    const ping = await client.callTool({ name: "ping", arguments: {} });
    expect(ping.isError).toBeFalsy();
    expect(ping.structuredContent).toMatchObject({ ok: true, name: "coursecopilot" });

    const added = await client.callTool({
      name: "add_course",
      arguments: { title: "EECS 376", term: "F26", course_id: "eecs376-f26" },
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toEqual({ course_id: "eecs376-f26" });

    const exam = await client.callTool({
      name: "set_exam",
      arguments: {
        course_id: "eecs376-f26",
        name: "Midterm",
        date: "2026-10-28",
        topics: ["Pumping lemma"],
        weight: 0.25,
      },
    });
    expect(exam.isError).toBeFalsy();
    expect(exam.structuredContent).toMatchObject({
      exams: [{ name: "Midterm", date: "2026-10-28", weight: 0.25 }],
    });

    const listed = await client.callTool({ name: "list_courses", arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(listed.structuredContent).toMatchObject({
      courses: [
        {
          course_id: "eecs376-f26",
          title: "EECS 376",
          term: "F26",
          source_count: 0,
          chunk_count: 0,
        },
      ],
    });

    const resources = await client.listResources();
    expect(resources.resources.some((r) => r.uri === "coursecopilot://courses")).toBe(true);

    const body = await client.readResource({ uri: "coursecopilot://courses" });
    const text = body.contents[0] && "text" in body.contents[0] ? body.contents[0].text : "";
    expect(text).toContain("eecs376-f26");
  });

  it("add_source(folder) indexes PDF+PPTX with page/slide locators", async () => {
    const { client, home } = await connect();
    const sampleDir = join(home, "course-files");
    await writeSampleFolder(sampleDir);

    const added = await client.callTool({
      name: "add_course",
      arguments: { title: "EECS 376", term: "F26", course_id: "eecs376-f26" },
    });
    expect(added.isError).toBeFalsy();

    const queued = await client.callTool({
      name: "add_source",
      arguments: { course_id: "eecs376-f26", kind: "folder", uri: sampleDir },
    });
    expect(queued.isError).toBeFalsy();
    const queuedBody = queued.structuredContent as {
      source_id: string;
      job_id: string;
      status: string;
    };
    expect(queuedBody.status).toBe("queued");
    expect(queuedBody.job_id).toMatch(/^job_/);

    const job = await waitForJob(client, queuedBody.job_id);
    expect(job.state).toBe("done");
    expect(job.docs).toBe(4);
    expect((job.chunks as number) >= 4).toBe(true);

    const sources = await client.callTool({
      name: "list_sources",
      arguments: { course_id: "eecs376-f26" },
    });
    expect(sources.isError).toBeFalsy();
    expect(sources.structuredContent).toMatchObject({
      sources: [{ kind: "folder", status: "done", doc_count: 4 }],
    });

    const missingCanvas = await client.callTool({
      name: "add_source",
      arguments: {
        course_id: "eecs376-f26",
        kind: "canvas",
        uri: "canvas://course/1",
      },
    });
    expect(missingCanvas.isError).toBe(true);
    const missingText =
      missingCanvas.content[0] && "text" in missingCanvas.content[0]
        ? missingCanvas.content[0].text
        : "";
    expect(missingText).toMatch(/canvas connect|not configured/i);

    const youtube = await client.callTool({
      name: "add_source",
      arguments: {
        course_id: "eecs376-f26",
        kind: "youtube",
        uri: "https://youtube.com/watch?v=x",
      },
    });
    expect(youtube.isError).toBe(true);

    const badYt = await client.callTool({
      name: "add_source",
      arguments: { course_id: "eecs376-f26", kind: "youtube", uri: "https://vimeo.com/123" },
    });
    expect(badYt.isError).toBe(true);

    const db = new Database(join(home, "cc.db"), { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare("SELECT text, locator_json, heading_path FROM chunks ORDER BY id")
        .all() as Array<{ text: string; locator_json: string; heading_path: string | null }>;
      const locators = rows.map(
        (r) => JSON.parse(r.locator_json) as { page?: number; slide?: number },
      );
      expect(locators.some((l) => l.page === 1)).toBe(true);
      expect(locators.some((l) => l.page === 2)).toBe(true);
      expect(locators.some((l) => l.slide === 1)).toBe(true);
      expect(locators.some((l) => l.slide === 2)).toBe(true);
      console.log(
        "e2e chunks",
        JSON.stringify(
          rows.map((r) => ({
            heading_path: r.heading_path,
            locator: JSON.parse(r.locator_json),
            text: r.text.slice(0, 120),
          })),
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }

    const search = await client.callTool({
      name: "search_course",
      arguments: {
        course_id: "eecs376-f26",
        query: "pumping lemma proof that a^n b^n is not regular",
        k: 5,
      },
    });
    expect(search.isError).toBeFalsy();
    const searchBody = search.structuredContent as {
      results: Array<{
        chunk_id: number;
        text: string;
        score: number;
        citation: { page: number | null; slide: number | null; label: string; url: string };
      }>;
      degraded?: string;
    };
    expect(searchBody.results.length).toBeGreaterThan(0);
    const top = searchBody.results[0];
    expect(top?.citation.page).toBe(14);
    expect(top?.citation.slide).toBe(14);
    expect(top?.citation.label).toMatch(/slide 14/i);
    console.log("e2e search_course", JSON.stringify(searchBody, null, 2));

    const gotChunk = await client.callTool({
      name: "get_chunk",
      arguments: { chunk_id: top?.chunk_id, context: 1 },
    });
    expect(gotChunk.isError).toBeFalsy();
    const structured = gotChunk.structuredContent as {
      chunk: { document_id: string };
      citation: { label: string };
    };
    expect(structured.citation.label).toMatch(/slide 14/i);

    const gotDoc = await client.callTool({
      name: "get_document",
      arguments: { document_id: structured.chunk.document_id },
    });
    expect(gotDoc.isError).toBeFalsy();
    const docBody = gotDoc.structuredContent as { text: string; chunks: unknown[] };
    expect(docBody.text).toMatch(/a\^n b\^n is not regular/i);

    const office = await client.callTool({
      name: "search_course",
      arguments: { course_id: "eecs376-f26", query: "office hours Beyster", k: 3 },
    });
    expect(office.isError).toBeFalsy();
    const officeHit = (
      office.structuredContent as { results: Array<{ chunk_id: number; text: string }> }
    ).results.find((r) => /office hours/i.test(r.text));
    expect(officeHit).toBeTruthy();

    const topics = await client.callTool({
      name: "set_topics",
      arguments: {
        course_id: "eecs376-f26",
        topics: [
          { name: "Pumping lemma", chunk_ids: [top?.chunk_id] },
          { name: "Office hours", chunk_ids: [officeHit?.chunk_id] },
        ],
      },
    });
    expect(topics.isError).toBeFalsy();

    const quizCtx = await client.callTool({
      name: "generate_quiz_context",
      arguments: { course_id: "eecs376-f26", n: 3, focus: "all" },
    });
    expect(quizCtx.isError).toBeFalsy();
    const quizBody = quizCtx.structuredContent as {
      items: Array<{
        topic: string;
        chunks: Array<{ chunk_id: number; citation: { label: string } }>;
      }>;
      instructions: string;
    };
    expect(quizBody.items.length).toBe(3);
    expect(quizBody.instructions).toMatch(/record_quiz_attempt/);
    expect(quizBody.items.some((i) => i.chunks.length > 0 && i.chunks[0]?.citation.label)).toBe(
      true,
    );
    console.log("e2e generate_quiz_context", JSON.stringify(quizBody, null, 2));

    const recorded = await client.callTool({
      name: "record_quiz_attempt",
      arguments: {
        course_id: "eecs376-f26",
        mode: "quiz",
        items: [
          {
            topic: "Pumping lemma",
            question: "State the pumping lemma.",
            user_answer: "no idea",
            correct: false,
            difficulty: 2,
            cited_chunk_ids: [top?.chunk_id],
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
      },
    });
    expect(recorded.isError).toBeFalsy();
    const recordedBody = recorded.structuredContent as {
      attempt_id: string;
      mastery_delta: Array<{ topic: string; before: number; after: number }>;
    };
    expect(recordedBody.attempt_id).toMatch(/^qa_/);
    const pumpingDelta = recordedBody.mastery_delta.find(
      (d) => d.topic.toLowerCase() === "pumping lemma",
    );
    expect(pumpingDelta).toBeTruthy();
    expect(pumpingDelta?.after).toBeLessThan(pumpingDelta?.before ?? 1);
    console.log("e2e record_quiz_attempt", JSON.stringify(recordedBody, null, 2));

    const spots = await client.callTool({
      name: "get_weak_spots",
      arguments: { course_id: "eecs376-f26", limit: 5 },
    });
    expect(spots.isError).toBeFalsy();
    const spotsBody = spots.structuredContent as {
      spots: Array<{ topic: string; n_attempts: number; mastery: number }>;
    };
    expect(spotsBody.spots[0]?.topic.toLowerCase()).toBe("pumping lemma");
    expect(spotsBody.spots[0]?.n_attempts).toBe(2);
    console.log("e2e get_weak_spots", JSON.stringify(spotsBody, null, 2));

    const exam = await client.callTool({
      name: "set_exam",
      arguments: {
        course_id: "eecs376-f26",
        name: "Midterm",
        date: "2026-10-20",
        topics: ["Pumping lemma"],
        weight: 0.25,
      },
    });
    expect(exam.isError).toBeFalsy();

    const plan = await client.callTool({
      name: "get_study_plan",
      arguments: { course_id: "eecs376-f26", exam_name: "Midterm", minutes_per_day: 60 },
    });
    expect(plan.isError).toBeFalsy();
    const planBody = plan.structuredContent as {
      days: Array<{
        date: string;
        sessions: Array<{ topic: string; activity: string; minutes: number }>;
      }>;
      rationale: string;
    };
    const minutesFor = (name: string) =>
      planBody.days
        .flatMap((d) => d.sessions)
        .filter((s) => s.topic.toLowerCase() === name.toLowerCase())
        .reduce((n, s) => n + s.minutes, 0);
    expect(minutesFor("Pumping lemma")).toBeGreaterThan(minutesFor("Office hours"));
    expect(planBody.days.at(-1)?.sessions.some((s) => s.activity === "practice")).toBe(true);
    console.log("e2e get_study_plan", JSON.stringify(planBody, null, 2));

    const prompt = await client.getPrompt({
      name: "quiz_me_on_misses",
      arguments: { course_id: "eecs376-f26" },
    });
    const promptText = prompt.messages[0]?.content;
    const promptBody =
      promptText && typeof promptText === "object" && "text" in promptText ? promptText.text : "";
    expect(promptBody).toMatch(/pumping lemma/i);
    expect(promptBody).toMatch(/record_quiz_attempt/);
    console.log("e2e quiz_me_on_misses", promptBody.slice(0, 800));

    const removed = await client.callTool({
      name: "remove_source",
      arguments: { source_id: queuedBody.source_id },
    });
    expect(removed.isError).toBeFalsy();
    expect(
      (removed.structuredContent as { removed_chunks: number }).removed_chunks,
    ).toBeGreaterThan(0);
  }, 180_000);

  it("add_source(transcript) indexes VTT timestamps; search_course cites mm:ss", async () => {
    const { client, home } = await connect();
    const vttPath = join(home, "lecture.vtt");
    copyFileSync(join(repoRoot, "test/fixtures/sample.vtt"), vttPath);

    const added = await client.callTool({
      name: "add_course",
      arguments: { title: "Automata", course_id: "auto-s11" },
    });
    expect(added.isError).toBeFalsy();

    const queued = await client.callTool({
      name: "add_source",
      arguments: { course_id: "auto-s11", kind: "transcript", uri: vttPath },
    });
    expect(queued.isError).toBeFalsy();
    const jobId = (queued.structuredContent as { job_id: string }).job_id;
    const job = await waitForJob(client, jobId);
    expect(job.state).toBe("done");
    expect(job.docs).toBe(1);

    const search = await client.callTool({
      name: "search_course",
      arguments: {
        course_id: "auto-s11",
        query: "pumping lemma a to the n b to the n is not regular",
        k: 3,
      },
    });
    expect(search.isError).toBeFalsy();
    const body = search.structuredContent as {
      results: Array<{
        text: string;
        citation: { kind: string; label: string; start_s: number | null; url: string };
      }>;
    };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]?.citation.kind).toBe("transcript");
    expect(body.results[0]?.citation.label).toMatch(/\d+:\d{2}/);
    expect(body.results[0]?.citation.start_s).not.toBeNull();
    expect(body.results[0]?.text).toMatch(/pumping lemma/i);
    console.log("e2e transcript search_course", JSON.stringify(body, null, 2));
  }, 180_000);

  it("add_source(website) crawls a fixture site, cites URL#anchor, re-syncs unchanged", async () => {
    const { client, home } = await connect();
    const siteDir = join(home, "site");
    await writeFixtureSite(siteDir);
    const server = await serveDirectory(siteDir);
    try {
      const added = await client.callTool({
        name: "add_course",
        arguments: { title: "EECS 3760", course_id: "eecs3760" },
      });
      expect(added.isError).toBeFalsy();

      const queued = await client.callTool({
        name: "add_source",
        arguments: {
          course_id: "eecs3760",
          kind: "website",
          uri: `${server.baseUrl}/`,
          options: { max_depth: 3, max_pages: 40 },
        },
      });
      expect(queued.isError).toBeFalsy();
      const queuedBody = queued.structuredContent as { job_id: string };
      const job = await waitForJob(client, queuedBody.job_id);
      expect(job.state).toBe("done");
      expect(job.docs).toBe(7);
      const skipped = job.skipped as Array<{ url: string; reason: string }>;
      expect(skipped.some((s) => s.reason.includes("robots.txt"))).toBe(true);
      expect(skipped.some((s) => s.reason.includes("requires login"))).toBe(true);

      const search = await client.callTool({
        name: "search_course",
        arguments: { course_id: "eecs3760", query: "pumping lemma web notes", k: 8 },
      });
      expect(search.isError).toBeFalsy();
      const searchBody = search.structuredContent as {
        results: Array<{
          citation: { url: string; kind: string; anchor: string | null; label: string };
        }>;
      };
      console.log("e2e website search_course", JSON.stringify(searchBody, null, 2));
      expect(searchBody.results.length).toBeGreaterThan(0);
      const web = searchBody.results.find((r) => /notes\.html#pumping-lemma/.test(r.citation.url));
      expect(web?.citation.kind).toBe("web");
      expect(web?.citation.anchor).toBe("pumping-lemma");

      const sync = await client.callTool({
        name: "sync_course",
        arguments: { course_id: "eecs3760" },
      });
      expect(sync.isError).toBeFalsy();
      const syncIds = (sync.structuredContent as { job_ids: string[] }).job_ids;
      expect(syncIds[0]).toBeTruthy();
      const syncJob = await waitForJob(client, syncIds[0] as string);
      expect(syncJob.state).toBe("done");
      expect(String(syncJob.message)).toMatch(/unchanged/);
    } finally {
      await server.close();
    }
  }, 180_000);

  it("add_source(leccap) validates URLs and errors with login instructions when unsigned", async () => {
    const { client } = await connect();
    await client.callTool({
      name: "add_course",
      arguments: { title: "EECS 376", course_id: "eecs376-f26" },
    });

    const bad = await client.callTool({
      name: "add_source",
      arguments: {
        course_id: "eecs376-f26",
        kind: "leccap",
        uri: "https://example.com/not-leccap",
      },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toMatch(/Lecture Capture|leccap/i);

    const queued = await client.callTool({
      name: "add_source",
      arguments: {
        course_id: "eecs376-f26",
        kind: "leccap",
        uri: "https://leccap.engin.umich.edu/leccap/site/testsitexxx",
      },
    });
    expect(queued.isError).toBeFalsy();
    const jobId = (queued.structuredContent as { job_id: string }).job_id;
    const job = await waitForJob(client, jobId);
    expect(job.state).toBe("error");
    expect(String(job.message)).toMatch(/login leccap/i);
  }, 180_000);
});
