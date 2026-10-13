import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { generateRemoteSecrets } from "../../src/remote/auth.js";
import { type HttpServerHandle, startHttpServer } from "../../src/server/transport-http.js";
import { writeSampleFolder } from "../helpers/sample-files.js";

describe("MCP HTTP e2e", () => {
  const homes: string[] = [];
  const handles: HttpServerHandle[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    for (const handle of handles.splice(0)) {
      await handle.close().catch(() => undefined);
    }
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  async function serve(
    opts: { allowLocalPaths?: boolean; oauth?: boolean } = {},
  ): Promise<{ handle: HttpServerHandle; home: string; token: string; secret: string }> {
    const home = mkdtempSync(join(tmpdir(), "cc-http-"));
    homes.push(home);
    process.env.COURSECOPILOT_HOME = home;
    const { token, secretPath } = generateRemoteSecrets();
    const handle = await startHttpServer({
      port: 0,
      bind: "127.0.0.1",
      token,
      secretPath,
      allowLocalPaths: opts.allowLocalPaths ?? true,
      oauth: opts.oauth ?? true,
      oauthAutoApprove: true,
      dbPath: join(home, "cc.db"),
    });
    handles.push(handle);
    return { handle, home, token, secret: secretPath };
  }

  async function connect(url: string, token?: string): Promise<Client> {
    const client = new Client({ name: "coursecopilot-http-e2e", version: "0.0.0" });
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
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

  it("rejects unauthenticated /mcp and accepts secret path + bearer", async () => {
    const { handle, token, secret } = await serve();
    const origin = `http://127.0.0.1:${handle.port}`;

    const denied = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate") ?? "").toMatch(/resource_metadata/);

    const health = await fetch(`${origin}/health`);
    expect(health.ok).toBe(true);
    expect(await health.json()).toMatchObject({ ok: true, name: "coursecopilot" });

    const client = await connect(`${origin}/mcp/${secret}`);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toContain("search");
    expect(names).toContain("fetch");
    expect(names).toContain("search_course");
    expect(names).toContain("generate_quiz_context");
    expect(names).toContain("record_quiz_attempt");
    expect(names).toContain("get_weak_spots");
    expect(names).toContain("get_study_plan");
    expect(names).toContain("set_topics");
    expect(names).toContain("get_course_outline");
    expect(names).toContain("add_pack");
    expect(names).toContain("export_pack");
    expect(names).toContain("list_packs");
    console.log("http tools/list", names.join(", "));

    const ping = await client.callTool({ name: "ping", arguments: {} });
    expect(ping.isError).toBeFalsy();

    const bearer = await connect(`${origin}/mcp`, token);
    const ping2 = await bearer.callTool({ name: "ping", arguments: {} });
    expect(ping2.isError).toBeFalsy();
  });

  it("lists tools and searches over HTTP (secret-path client)", async () => {
    const { handle, home, secret } = await serve({ allowLocalPaths: true });
    const origin = `http://127.0.0.1:${handle.port}`;
    const client = await connect(`${origin}/mcp/${secret}`);

    const listed = await client.listTools();
    console.log("http e2e tools/list", JSON.stringify(listed.tools.map((t) => t.name)));

    const added = await client.callTool({
      name: "add_course",
      arguments: { title: "EECS 376", term: "F26", course_id: "eecs376-f26" },
    });
    expect(added.isError).toBeFalsy();

    const sampleDir = join(home, "course-files");
    await writeSampleFolder(sampleDir);
    const queued = await client.callTool({
      name: "add_source",
      arguments: { course_id: "eecs376-f26", kind: "folder", uri: sampleDir },
    });
    expect(queued.isError).toBeFalsy();
    const jobId = (queued.structuredContent as { job_id: string }).job_id;
    const job = await waitForJob(client, jobId);
    expect(job.state).toBe("done");

    const search = await client.callTool({
      name: "search_course",
      arguments: {
        course_id: "eecs376-f26",
        query: "pumping lemma proof that a^n b^n is not regular",
        k: 5,
      },
    });
    expect(search.isError).toBeFalsy();
    const body = search.structuredContent as {
      results: Array<{ chunk_id: number; citation: { page: number | null; label: string } }>;
    };
    expect(body.results.length).toBeGreaterThan(0);
    console.log("http e2e search_course", JSON.stringify(body, null, 2));
    expect(body.results[0]?.citation.page).toBe(14);

    const alias = await client.callTool({
      name: "search",
      arguments: { query: "pumping lemma proof that a^n b^n is not regular" },
    });
    expect(alias.isError).toBeFalsy();
    const aliasBody = alias.structuredContent as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    expect(aliasBody.results.length).toBeGreaterThan(0);
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { id: aliasBody.results[0]?.id },
    });
    expect(fetched.isError).toBeFalsy();
    expect((fetched.structuredContent as { text: string }).text).toMatch(
      /a\^n b\^n is not regular/i,
    );
    console.log("http e2e search+fetch", JSON.stringify(aliasBody, null, 2));

    const quiz = await client.callTool({
      name: "generate_quiz_context",
      arguments: { course_id: "eecs376-f26", n: 2 },
    });
    expect(quiz.isError).toBeFalsy();
    const quizBody = quiz.structuredContent as { items: unknown[]; instructions: string };
    expect(quizBody.items.length).toBeGreaterThan(0);
    expect(quizBody.instructions).toMatch(/record_quiz_attempt/i);
    console.log("http e2e generate_quiz_context items", quizBody.items.length);
  }, 180_000);

  it("disables local file paths unless --allow-path", async () => {
    const { handle, secret } = await serve({ allowLocalPaths: false });
    const origin = `http://127.0.0.1:${handle.port}`;
    const client = await connect(`${origin}/mcp/${secret}`);
    await client.callTool({
      name: "add_course",
      arguments: { title: "X", course_id: "x" },
    });
    const denied = await client.callTool({
      name: "add_source",
      arguments: { course_id: "x", kind: "file", uri: "/tmp/nope.md" },
    });
    expect(denied.isError).toBe(true);
    const text = denied.content[0] && "text" in denied.content[0] ? denied.content[0].text : "";
    expect(text).toMatch(/--allow-path/);
    const deniedTranscript = await client.callTool({
      name: "add_source",
      arguments: { course_id: "x", kind: "transcript", uri: "/tmp/nope.vtt" },
    });
    expect(deniedTranscript.isError).toBe(true);
  });
});
