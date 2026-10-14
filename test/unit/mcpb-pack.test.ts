import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLISHED_STDIO_SPEC } from "../../src/setup/command.js";
import {
  assertManifestLaunchConfig,
  packMcpbBundle,
  readMcpbManifest,
} from "../../src/setup/pack-mcpb.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("MCPB pack", () => {
  const leftovers: string[] = [];

  afterEach(() => {
    for (const dir of leftovers.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("manifest launch config matches published npx stdio", () => {
    const manifest = readMcpbManifest(repoRoot);
    expect(manifest.manifest_version).toBe("0.2");
    expect(manifest.user_config?.canvas_token).toMatchObject({ sensitive: true });
    assertManifestLaunchConfig(manifest);
    expect(manifest.server.mcp_config.command).toBe(PUBLISHED_STDIO_SPEC.command);
    expect(manifest.server.mcp_config.args).toEqual(PUBLISHED_STDIO_SPEC.args);
  });

  it("builds coursecopilot.mcpb with manifest.json at the zip root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mcpb-out-"));
    leftovers.push(dir);
    const outputPath = join(dir, "coursecopilot.mcpb");
    const result = await packMcpbBundle({ repoRoot, outputPath });
    expect(result.outputPath).toBe(outputPath);
    const zip = await JSZip.loadAsync(readFileSync(outputPath));
    const manifestFile = zip.file("manifest.json");
    expect(manifestFile).toBeTruthy();
    const inside = JSON.parse((await manifestFile?.async("string")) ?? "{}") as {
      name: string;
      server: { mcp_config: { command: string; args: string[] } };
    };
    expect(inside.name).toBe("coursecopilot");
    expect(inside.server.mcp_config.command).toBe("npx");
    expect(inside.server.mcp_config.args).toEqual(["-y", "coursecopilot@latest"]);
    expect(zip.file("LICENSE")).toBeTruthy();
  });
});
