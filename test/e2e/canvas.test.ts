import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { COURSE_101, serveFakeCanvas, VALID_TOKEN } from "../helpers/fake-canvas.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliJs = join(repoRoot, "dist", "cli.js");

describe("Canvas e2e (mock server)", () => {
  const homes: string[] = [];
  const clients: Client[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    for (const close of closers.splice(0)) {
      await close();
    }
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  function spawnCli(
    args: string[],
    env: Record<string, string>,
  ): Promise<{ status: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ status: code ?? 1, stdout, stderr });
      });
    });
  }

  function spawnEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env.COURSECOPILOT_HOME = home;
    env.COURSECOPILOT_CRAWL_DELAY_MS = "0";
    Object.assign(env, extra);
    return env;
  }

  async function waitForJob(client: Client, jobId: string, timeoutMs = 180_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await client.callTool({
        name: "get_ingest_status",
        arguments: { job_id: jobId },
      });
      const jobs = (res.structuredContent as { jobs: Array<Record<string, unknown>> }).jobs;
      const job = jobs[0];
      if (job && (job.state === "done" || job.state === "error" || job.state === "partial")) {
        return job;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for job ${jobId}`);
  }

  it("canvas connect writes 0600 secrets and never prints the token", async () => {
    const server = await serveFakeCanvas();
    closers.push(server.close);
    const home = mkdtempSync(join(tmpdir(), "cc-canvas-cli-"));
    homes.push(home);
    const result = await spawnCli(
      [cliJs, "canvas", "connect", "--base-url", server.baseUrl, "--token", VALID_TOKEN, "--yes"],
      spawnEnv(home),
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(0);
    expect(combined).toMatch(/Jane Student/);
    expect(combined).not.toContain(VALID_TOKEN);
    const secrets = readFileSync(join(home, "secrets.json"), "utf8");
    expect(secrets).toContain(VALID_TOKEN);
    expect(secrets).toContain(server.baseUrl);
  });

  it("stdio: live tools + ingest + search + whats_due against the mock Canvas", async () => {
    const server = await serveFakeCanvas();
    closers.push(server.close);
    const home = mkdtempSync(join(tmpdir(), "cc-canvas-e2e-"));
    homes.push(home);

    const client = new Client({ name: "coursecopilot-canvas-e2e", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliJs],
      cwd: repoRoot,
      env: spawnEnv(home, {
        CANVAS_BASE_URL: server.baseUrl,
        CANVAS_TOKEN: VALID_TOKEN,
      }),
      stderr: "pipe",
    });
    await client.connect(transport);
    clients.push(client);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("canvas_list_courses");
    expect(names).toContain("canvas_list_assignments");
    expect(names).toContain("canvas_list_announcements");

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("whats_due");

    const courses = await client.callTool({
      name: "canvas_list_courses",
      arguments: {},
    });
    expect(courses.isError).toBeFalsy();
    const courseBody = courses.structuredContent as {
      courses: Array<{ canvas_course_id: string; name: string }>;
    };
    expect(courseBody.courses.some((c) => c.canvas_course_id === String(COURSE_101))).toBe(true);
    console.log("e2e canvas_list_courses", JSON.stringify(courseBody, null, 2));

    const due = await client.callTool({
      name: "canvas_list_assignments",
      arguments: { days: 14, upcoming_only: true },
    });
    expect(due.isError).toBeFalsy();
    const dueBody = due.structuredContent as {
      assignments: Array<{ name: string; due_at: string | null; course: string }>;
    };
    expect(dueBody.assignments.some((a) => a.name === "Homework 1")).toBe(true);
    console.log("e2e canvas_list_assignments", JSON.stringify(dueBody, null, 2));

    await client.callTool({
      name: "add_course",
      arguments: { title: "EECS 376", term: "F26", course_id: "eecs376-f26" },
    });
    const queued = await client.callTool({
      name: "add_source",
      arguments: {
        course_id: "eecs376-f26",
        kind: "canvas",
        uri: `canvas://course/${COURSE_101}`,
      },
    });
    expect(queued.isError).toBeFalsy();
    const jobId = (queued.structuredContent as { job_id: string }).job_id;
    const job = await waitForJob(client, jobId);
    expect(job.state === "done" || job.state === "partial").toBe(true);
    expect((job.docs as number) >= 4).toBe(true);
    console.log("e2e canvas ingest", JSON.stringify(job, null, 2));

    const search = await client.callTool({
      name: "search_course",
      arguments: { course_id: "eecs376-f26", query: "pumping lemma web notes", k: 5 },
    });
    expect(search.isError).toBeFalsy();
    const searchBody = search.structuredContent as {
      results: Array<{ text: string; citation: { kind: string; label: string; url: string } }>;
    };
    expect(searchBody.results.length).toBeGreaterThan(0);
    expect(searchBody.results.some((r) => /Canvas/.test(r.citation.label))).toBe(true);
    console.log("e2e canvas search_course", JSON.stringify(searchBody, null, 2));

    const whats = await client.getPrompt({ name: "whats_due", arguments: { days: "7" } });
    const text = whats.messages[0]?.content;
    const body = text && typeof text === "object" && "text" in text ? text.text : "";
    expect(body).toMatch(/canvas_list_assignments/);
    expect(body).toMatch(/tokens_blocked|fallback/i);
    console.log("e2e whats_due", body.slice(0, 500));
  }, 180_000);

  it("returns tokens_blocked with fallback when the school disables tokens", async () => {
    const server = await serveFakeCanvas();
    closers.push(server.close);
    const home = mkdtempSync(join(tmpdir(), "cc-canvas-blocked-"));
    homes.push(home);
    const client = new Client({ name: "coursecopilot-canvas-blocked", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliJs],
      cwd: repoRoot,
      env: spawnEnv(home, {
        CANVAS_BASE_URL: server.baseUrl,
        CANVAS_TOKEN: "blocked-token",
      }),
      stderr: "pipe",
    });
    await client.connect(transport);
    clients.push(client);
    const res = await client.callTool({ name: "canvas_list_courses", arguments: {} });
    expect(res.isError).toBe(true);
    const payload = res.structuredContent as { error?: string; fallback?: string };
    expect(payload.error === "tokens_blocked" || payload.error === "token_rejected").toBe(true);
    const text = res.content[0] && "text" in res.content[0] ? res.content[0].text : "";
    expect(`${payload.fallback ?? ""}\n${text}`).toMatch(/website|pack|folder/i);
  });
});
