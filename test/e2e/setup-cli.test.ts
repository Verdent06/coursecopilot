import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliJs = join(repoRoot, "dist", "cli.js");

function run(
  home: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; status: number }> {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    COURSECOPILOT_HOME: home,
    COURSECOPILOT_DISABLE_EMBEDDINGS: "1",
    COURSECOPILOT_PACK_REGISTRY: "http://127.0.0.1:1/missing.json",
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliJs, ...args], {
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
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timed out: coursecopilot ${args.join(" ")}\n${stderr}\n${stdout}`));
    }, 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status: code ?? 1 });
    });
  });
}

describe("CLI setup / doctor", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-setup-cli-"));
    temps.push(dir);
    return dir;
  }

  it("setup --yes --client cursor writes mcp.json and keeps --dry-run off-disk", async () => {
    const dir = home();
    mkdirSync(join(dir, ".cursor"), { recursive: true });
    const dry = await run(dir, ["setup", "--yes", "--dry-run", "--client", "cursor"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/cursor/i);
    expect(() => readFileSync(join(dir, ".cursor", "mcp.json"), "utf8")).toThrow();

    const wrote = await run(dir, ["setup", "--yes", "--client", "cursor"]);
    expect(wrote.status).toBe(0);
    const json = JSON.parse(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: { coursecopilot: { command: string; args: string[] } };
    };
    expect(json.mcpServers.coursecopilot.command).toBe("npx");
    expect(json.mcpServers.coursecopilot.args).toEqual(["-y", "coursecopilot@latest"]);
    expect(wrote.stdout).toMatch(/deeplink/i);
    expect(wrote.stdout).toMatch(/claude\.ai/i);
  });

  it("doctor --json --offline exits 0 on a clean home and lists checks", async () => {
    const dir = home();
    const result = await run(dir, ["doctor", "--json", "--offline"]);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.checks.some((c) => c.id === "node")).toBe(true);
    expect(report.checks.some((c) => c.id === "better-sqlite3")).toBe(true);
    expect(report.checks.some((c) => c.id === "db")).toBe(true);
    expect(result.status).toBe(report.ok ? 0 : 1);
    expect(report.ok).toBe(true);
  });
});
