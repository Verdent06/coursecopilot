import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveSession } from "../../src/ingest/lecture-capture/session.js";
import { doctorExitCode, formatDoctorText, runDoctor } from "../../src/setup/doctor.js";
import { createSetupContext } from "../../src/setup/types.js";
import { BLOCKED_TOKEN, createFakeCanvas, VALID_TOKEN } from "../helpers/fake-canvas.js";

function registryOk(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        packs: [
          {
            id: "harvard-cs50x",
            name: "CS50",
            url: "https://example.com/harvard-cs50x.json",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

function mcpInitializeOk(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2026-07-28",
          serverInfo: { name: "coursecopilot", version: "0.1.0" },
          capabilities: {},
        },
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("doctor", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const dir of homes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.COURSECOPILOT_HOME;
    delete process.env.CANVAS_TOKEN;
    delete process.env.CANVAS_BASE_URL;
    delete process.env.COURSECOPILOT_PUBLIC_URL;
    delete process.env.COURSECOPILOT_TOKEN;
    delete process.env.COURSECOPILOT_SECRET_PATH;
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-doctor-"));
    homes.push(dir);
    process.env.COURSECOPILOT_HOME = dir;
    return dir;
  }

  function ctxFor(dir: string) {
    return createSetupContext({
      homedir: dir,
      env: { HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: join(dir, ".config") },
      which: () => undefined,
    });
  }

  it("passes node + natives + db; skips missing optional clients/canvas/leccap/remote", async () => {
    const dir = home();
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.node?.status).toBe("pass");
    expect(byId["better-sqlite3"]?.status).toBe("pass");
    expect(byId.db?.status).toBe("pass");
    expect(byId.canvas?.status).toBe("skip");
    expect(byId.leccap?.status).toBe("skip");
    expect(byId.remote?.status).toBe("skip");
    expect(byId.registry?.status).toBe("pass");
    expect(report.ok).toBe(true);
    expect(doctorExitCode(report)).toBe(0);
  });

  it("fails Node < 20 and a detected client with no entry", async () => {
    const dir = home();
    mkdirSync(join(dir, ".cursor"), { recursive: true });
    writeFileSync(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8");
    const report = await runDoctor({
      nodeVersion: "18.20.0",
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
      native: {
        betterSqlite3: () => undefined,
        sqliteVec: () => undefined,
        onnxruntime: () => undefined,
      },
    });
    expect(report.ok).toBe(false);
    expect(doctorExitCode(report)).toBe(1);
    const node = report.checks.find((c) => c.id === "node");
    expect(node?.status).toBe("fail");
    expect(node?.fix).toMatch(/nodejs.org/i);
    const cursor = report.checks.find((c) => c.id === "client:cursor");
    expect(cursor?.status).toBe("fail");
    expect(cursor?.fix).toMatch(/setup --client cursor/);
  });

  it("warns when sqlite-vec / onnx fail instead of exiting non-zero", async () => {
    const dir = home();
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
      native: {
        betterSqlite3: () => undefined,
        sqliteVec: () => {
          throw new Error("no vec");
        },
        onnxruntime: () => {
          throw new Error("no onnx");
        },
      },
    });
    expect(report.checks.find((c) => c.id === "sqlite-vec")?.status).toBe("warn");
    expect(report.checks.find((c) => c.id === "onnxruntime")?.status).toBe("warn");
    expect(report.ok).toBe(true);
  });

  it("validates a Canvas token via /users/self and fails on blocked tokens", async () => {
    const dir = home();
    const fake = await createFakeCanvas();
    process.env.CANVAS_BASE_URL = "https://umich.instructure.com";
    process.env.CANVAS_TOKEN = VALID_TOKEN;
    const ok = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      canvasFetchFn: fake.fetch,
      registryFetchFn: registryOk(),
    });
    expect(ok.checks.find((c) => c.id === "canvas")?.status).toBe("pass");

    process.env.CANVAS_TOKEN = BLOCKED_TOKEN;
    const blocked = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      canvasFetchFn: fake.fetch,
      registryFetchFn: registryOk(),
    });
    expect(blocked.checks.find((c) => c.id === "canvas")?.status).toBe("fail");
    expect(blocked.ok).toBe(false);
  });

  it("checks a leccap session file", async () => {
    const dir = home();
    saveSession("leccap", {
      cookies: [{ name: "session", value: "abc", domain: "leccap.engin.umich.edu" }],
    });
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
    });
    expect(report.checks.find((c) => c.id === "leccap")?.status).toBe("pass");
  });

  it("probes a remote MCP initialize URL", async () => {
    const dir = home();
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
      remoteFetchFn: mcpInitializeOk(),
      url: "https://demo.trycloudflare.com",
      secretPath: "deadbeef",
    });
    const remote = report.checks.find((c) => c.id === "remote");
    expect(remote?.status).toBe("pass");
    expect(remote?.message).toContain("/mcp/deadbeef");
  });

  it("warns when the registry is unreachable", async () => {
    const dir = home();
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: async () => new Response("nope", { status: 500 }),
    });
    expect(report.checks.find((c) => c.id === "registry")?.status).toBe("warn");
    expect(report.ok).toBe(true);
  });

  it("prints JSON and emoji text", async () => {
    const dir = home();
    const report = await runDoctor({
      offline: true,
      skipModelDownload: true,
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
    });
    const json = JSON.stringify(report);
    expect(json).toContain('"ok"');
    expect(json).toContain('"checks"');
    const text = formatDoctorText(report);
    expect(text).toMatch(/✅|⚠️|⏭️/);
    expect(text).toMatch(/Node/);
  });

  it("uses a stub embedder when downloading", async () => {
    const dir = home();
    const report = await runDoctor({
      ctx: ctxFor(dir),
      registryFetchFn: registryOk(),
      embedder: {
        status: "ready",
        degraded: false,
        ready: async () => true,
        embed: async () => [],
      },
    });
    expect(report.checks.find((c) => c.id === "embeddings")?.status).toBe("pass");
  });
});
