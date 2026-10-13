import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

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

  async function connect(): Promise<Client> {
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
    return client;
  }

  it("lists tools over stdio", async () => {
    const client = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_course", "list_courses", "ping", "set_exam"]);
    // Keep this log: captured for the PR description as protocol proof.
    console.log("tools/list", JSON.stringify(listed, null, 2));
  });

  it("add_course → set_exam → list_courses → courses resource", async () => {
    const client = await connect();

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
});
