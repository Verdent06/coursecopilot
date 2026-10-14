import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureClaudeCode } from "../../src/setup/clients/claude-code.js";
import { configureClaudeDesktop } from "../../src/setup/clients/claude-desktop.js";
import { configureCursor } from "../../src/setup/clients/cursor.js";
import { configureGeminiCli } from "../../src/setup/clients/gemini-cli.js";
import { decodeCursorDeeplink, stdioServerSpec } from "../../src/setup/command.js";
import { detectClients } from "../../src/setup/detect.js";
import { runSetup } from "../../src/setup/run-setup.js";
import { createSetupContext, type LocalClientId } from "../../src/setup/types.js";
import { undoLastSetup } from "../../src/setup/undo.js";
import { mergeMcpServer, readMcpServers } from "../../src/setup/write-config.js";

const OSES = ["darwin", "win32", "linux"] as const;
const CLIENTS: LocalClientId[] = ["claude-desktop", "claude-code", "cursor", "gemini"];

const OTHER = {
  filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
};

function layout(platform: (typeof OSES)[number], tmp: string) {
  const env: NodeJS.ProcessEnv = {
    HOME: tmp,
    USERPROFILE: tmp,
    APPDATA: join(tmp, "AppData", "Roaming"),
    LOCALAPPDATA: join(tmp, "AppData", "Local"),
    XDG_CONFIG_HOME: join(tmp, ".config"),
  };
  return createSetupContext({
    platform,
    homedir: tmp,
    env,
    which: () => undefined,
    runCommand: () => ({ status: 1, stdout: "", stderr: "cli missing" }),
    now: new Date("2026-10-13T23:19:00.000Z"),
  });
}

function configure(id: LocalClientId, ctx: ReturnType<typeof layout>, dryRun = false) {
  switch (id) {
    case "claude-desktop":
      return configureClaudeDesktop(ctx, { dryRun });
    case "claude-code":
      return configureClaudeCode(ctx, { dryRun });
    case "cursor":
      return configureCursor(ctx, { dryRun });
    case "gemini":
      return configureGeminiCli(ctx, { dryRun });
  }
}

function seedOtherServers(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ theme: "dark", mcpServers: { ...OTHER } }, null, 2), "utf8");
}

describe("setup config merge per client and OS", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.COURSECOPILOT_HOME;
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-setup-"));
    temps.push(dir);
    process.env.COURSECOPILOT_HOME = dir;
    return dir;
  }

  for (const os of OSES) {
    for (const client of CLIENTS) {
      it(`${os} / ${client}: writes an entry, keeps other servers, backs up, is idempotent`, () => {
        const home = tmp();
        const ctx = layout(os, home);
        const planned = configure(client, ctx, true);
        seedOtherServers(planned.path);
        const first = configure(client, ctx);
        expect(first.result.ok).toBe(true);
        if (!first.result.ok) {
          return;
        }
        expect(first.result.action).toBe("merged");
        expect(first.result.backup).toMatch(/\.bak-2026-10-13T23-19-00-000Z$/);
        const servers = readMcpServers(planned.path);
        expect(servers.ok).toBe(true);
        if (!servers.ok) {
          return;
        }
        expect(servers.servers.filesystem).toEqual(OTHER.filesystem);
        expect(servers.servers.coursecopilot).toBeTruthy();
        const raw = readFileSync(planned.path, "utf8");
        expect(raw).toContain("coursecopilot");
        expect(raw).not.toMatch(/CANVAS_TOKEN|canvas_token/);
        expect(JSON.parse(raw).theme).toBe("dark");

        const second = configure(client, ctx);
        expect(second.result.ok && second.result.action).toBe("unchanged");
      });
    }
  }

  it("refuses to clobber malformed JSON and prints a snippet", () => {
    const home = tmp();
    const ctx = layout("linux", home);
    const path = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");
    const out = configureCursor(ctx);
    expect(out.result.ok).toBe(false);
    if (out.result.ok) {
      return;
    }
    expect(out.result.reason).toBe("invalid_json");
    expect(out.result.snippet).toContain("coursecopilot");
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  it("dry-run does not write or backup", () => {
    const home = tmp();
    const ctx = layout("darwin", home);
    const out = configureClaudeDesktop(ctx, { dryRun: true });
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) {
      return;
    }
    expect(out.result.action).toBe("created");
    expect(out.diff).toContain("coursecopilot");
    expect(() => readFileSync(out.path, "utf8")).toThrow();
  });

  it("setup --undo restores the most recent backup", async () => {
    const home = tmp();
    const ctx = layout("linux", home);
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { keepme: { command: "echo" } } }, null, 2),
    );
    const report = await runSetup(
      { yes: true, client: "cursor" },
      { ctx, homeDir: home, interactive: false, out: () => undefined },
    );
    expect(report.ok).toBe(true);
    const after = readMcpServers(join(home, ".cursor", "mcp.json"));
    expect(after.ok && after.servers.coursecopilot).toBeTruthy();
    expect(after.ok && after.servers.keepme).toBeTruthy();

    const undone = undoLastSetup(home);
    expect(undone.ok).toBe(true);
    const restored = readMcpServers(join(home, ".cursor", "mcp.json"));
    expect(restored.ok && restored.servers.coursecopilot).toBeUndefined();
    expect(restored.ok && restored.servers.keepme).toEqual({ command: "echo" });
  });

  it("detects clients from config dirs and binaries", () => {
    const home = tmp();
    mkdirSync(join(home, "Library", "Application Support", "Claude"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".claude.json"), "{}", "utf8");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    const ctx = layout("darwin", home);
    ctx.which = (cmd) => (cmd === "gemini" ? "/usr/bin/gemini" : undefined);
    const found = detectClients(ctx);
    expect(
      found
        .filter((c) => c.detected)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["claude-code", "claude-desktop", "cursor", "gemini"]);
  });

  it("prefers claude/gemini CLI when present, still merges the file", () => {
    const home = tmp();
    const calls: string[][] = [];
    const ctx = layout("linux", home);
    ctx.which = (cmd) => (cmd === "claude" || cmd === "gemini" ? `/bin/${cmd}` : undefined);
    ctx.runCommand = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "Added coursecopilot\n", stderr: "" };
    };
    const code = configureClaudeCode(ctx);
    const gem = configureGeminiCli(ctx);
    expect(code.result.ok).toBe(true);
    expect(gem.result.ok).toBe(true);
    expect(calls.some((c) => c[0] === "/bin/claude" && c.includes("mcp"))).toBe(true);
    expect(calls.some((c) => c[0] === "/bin/gemini" && c.includes("mcp"))).toBe(true);
    expect(readMcpServers(code.path).ok).toBe(true);
  });

  it("mergeMcpServer creates a file when missing and does not invent extra keys", () => {
    const home = tmp();
    const path = join(home, "mcp.json");
    const result = mergeMcpServer({
      path,
      entry: { command: "npx", args: ["-y", "coursecopilot@latest"] },
      now: new Date("2026-10-13T00:00:00.000Z"),
    });
    expect(result.ok && result.action).toBe("created");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: { coursecopilot: { command: "npx", args: ["-y", "coursecopilot@latest"] } },
    });
  });
});

describe("Cursor deeplink", () => {
  it("encodes and decodes the npx stdio config", () => {
    const out = configureCursor(
      createSetupContext({
        homedir: "/tmp/unused",
        exists: () => false,
        which: () => undefined,
      }),
      { dryRun: true },
    );
    const decoded = decodeCursorDeeplink(out.deeplink);
    expect(decoded.name).toBe("coursecopilot");
    expect(decoded.config).toEqual(stdioServerSpec());
  });
});
