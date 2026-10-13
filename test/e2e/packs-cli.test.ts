import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { writeFixtureSite } from "../helpers/fixture-site.js";
import { serveDirectory } from "../helpers/static-server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliJs = join(repoRoot, "dist", "cli.js");

function run(home: string, args: string[]): { stdout: string; stderr: string } {
  const env = { ...process.env, COURSECOPILOT_HOME: home, COURSECOPILOT_CRAWL_DELAY_MS: "0" };
  const stdout = execFileSync(process.execPath, [cliJs, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  return { stdout, stderr: "" };
}

describe("CLI add-pack / export-pack / list-packs / wipe", () => {
  const temps: string[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add-pack from a local website pack, export, wipe, add-pack again", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-pack-cli-"));
    temps.push(home);
    const siteDir = join(home, "site");
    await writeFixtureSite(siteDir);
    const server = await serveDirectory(siteDir);
    closers.push(() => server.close());

    mkdirSync(join(home, "in"), { recursive: true });
    const packPath = join(home, "in", "cli-mini.json");
    writeFileSync(
      packPath,
      JSON.stringify({
        schema: 1,
        id: "cli-mini",
        name: "CLI Mini Site",
        term: "F26",
        version: "1.0.0",
        sources: [{ kind: "website", url: `${server.baseUrl}/`, max_depth: 3, max_pages: 40 }],
        topics: [{ lecture: 7, title: "Pumping lemma", topics: ["Pumping lemma"] }],
      }),
    );

    const added = run(home, ["add-pack", packPath]);
    expect(added.stdout).toMatch(/cli-mini/);

    const listed = run(home, ["list-packs", "--installed"]);
    expect(listed.stdout).toMatch(/cli-mini/);

    const exportedPath = join(home, "out", "cli-mini.json");
    mkdirSync(join(home, "out"), { recursive: true });
    const exported = run(home, ["export-pack", "cli-mini", "-o", exportedPath]);
    expect(exported.stdout).toContain(exportedPath);
    const manifest = JSON.parse(readFileSync(exportedPath, "utf8")) as {
      id: string;
      sources: Array<{ kind: string; url: string }>;
    };
    expect(manifest.id).toBe("cli-mini");
    expect(manifest.sources[0]?.kind).toBe("website");
    expect(manifest.sources[0]?.url).toContain(server.baseUrl);

    run(home, ["wipe", "--yes"]);
    const empty = run(home, ["list-packs", "--installed"]);
    expect(empty.stdout).toMatch(/No packs found/i);

    const restored = run(home, ["add-pack", exportedPath]);
    expect(restored.stdout).toMatch(/cli-mini/);
    expect(restored.stdout).toMatch(/chunks/i);
  }, 180_000);
});
