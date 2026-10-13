import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function spawnEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.COURSECOPILOT_HOME = home;
  env.COURSECOPILOT_DISABLE_EMBEDDINGS = "1";
  env.npm_config_update_notifier = "false";
  env.npm_config_fund = "false";
  env.npm_config_audit = "false";
  return env;
}

/**
 * Full install of the packed tarball (what `npx --package=<tgz> coursecopilot` does).
 * Linux CI only so the matrix does not redo native installs six times.
 */
const runNpxTarball = !process.env.CI || process.platform === "linux";

describe.skipIf(!runNpxTarball)("npx from packed tarball", () => {
  const leftovers: string[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    for (const dir of leftovers.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers MCP initialize and tools/list", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "cc-npm-pack-"));
    leftovers.push(packDir);
    execFileSync(npmBin(), ["pack", "--pack-destination", packDir, "--ignore-scripts"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const tarball = join(packDir, "coursecopilot-0.1.0.tgz");
    const prefix = mkdtempSync(join(tmpdir(), "cc-npx-prefix-"));
    leftovers.push(prefix);
    execFileSync(npmBin(), ["install", "--prefix", prefix, tarball], {
      cwd: packDir,
      encoding: "utf8",
      env: spawnEnv(prefix),
    });
    const home = mkdtempSync(join(tmpdir(), "cc-npx-home-"));
    leftovers.push(home);
    const cliJs = join(prefix, "node_modules", "coursecopilot", "dist", "cli.js");
    const client = new Client({ name: "coursecopilot-npx-pack", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliJs],
      cwd: prefix,
      env: spawnEnv(home),
      stderr: "pipe",
    });
    await client.connect(transport);
    clients.push(client);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("search_course");
    expect(names).toContain("list_courses");
    expect(names).toContain("add_pack");
    const ping = await client.callTool({ name: "ping", arguments: {} });
    expect(ping.isError).toBeFalsy();
  }, 240_000);
});
