import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { writeSampleFolder } from "../helpers/sample-files.js";

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
      "add_source",
      "get_chunk",
      "get_document",
      "get_ingest_status",
      "list_courses",
      "list_sources",
      "ping",
      "remove_source",
      "search_course",
      "set_exam",
    ]);
    // Keep this log: captured for the PR description as protocol proof.
    console.log("tools/list", JSON.stringify(listed, null, 2));
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

    const website = await client.callTool({
      name: "add_source",
      arguments: { course_id: "eecs376-f26", kind: "website", uri: "https://example.com" },
    });
    expect(website.isError).toBe(true);

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

    const removed = await client.callTool({
      name: "remove_source",
      arguments: { source_id: queuedBody.source_id },
    });
    expect(removed.isError).toBeFalsy();
    expect(
      (removed.structuredContent as { removed_chunks: number }).removed_chunks,
    ).toBeGreaterThan(0);
  }, 180_000);
});
