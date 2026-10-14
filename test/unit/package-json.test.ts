import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runNpm } from "../helpers/run-npm.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

type PackListing = {
  name: string;
  version: string;
  filename: string;
  files: Array<{ path: string }>;
};

describe("npm package metadata", () => {
  it("is ready to publish as coursecopilot", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      name: string;
      license: string;
      bin: Record<string, string>;
      files: string[];
      engines: { node: string };
      repository: { url: string };
      keywords: string[];
      publishConfig?: { access: string; provenance: boolean };
    };
    expect(pkg.name).toBe("coursecopilot");
    expect(pkg.license).toBe("MIT");
    expect(pkg.bin.coursecopilot).toBe("./dist/cli.js");
    expect(pkg.files).toEqual([
      "dist",
      "!dist/**/*.map",
      "!dist/**/*.d.ts",
      "README.md",
      "LICENSE",
    ]);
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.repository.url).toContain("github.com/Verdent06/coursecopilot");
    expect(pkg.keywords).toEqual(expect.arrayContaining(["mcp", "claude", "cursor", "gemini"]));
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.provenance).toBe(true);
  });

  it("npm pack dry-run only ships dist, README, and LICENSE", () => {
    const raw = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: repoRoot });
    const jsonStart = raw.search(/[[{]/);
    const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw) as
      | PackListing
      | PackListing[];
    const listing = Array.isArray(parsed) ? parsed[0] : parsed;
    expect(listing?.name).toBe("coursecopilot");
    expect(listing?.filename).toMatch(/^coursecopilot-0\.1\.0\.tgz$/);
    const paths = (listing?.files ?? []).map((f) => f.path.replaceAll("\\", "/"));
    expect(paths).toContain("package.json");
    expect(paths).toContain("README.md");
    expect(paths).toContain("LICENSE");
    expect(paths.some((p) => p === "dist/cli.js" || p.endsWith("/dist/cli.js"))).toBe(true);
    expect(paths.some((p) => p === "dist/db/schema.sql" || p.endsWith("/dist/db/schema.sql"))).toBe(
      true,
    );
    for (const p of paths) {
      expect(p.startsWith("src/")).toBe(false);
      expect(p.startsWith("test/")).toBe(false);
      expect(p.startsWith("docs/")).toBe(false);
      expect(p.includes("node_modules/")).toBe(false);
      expect(p.endsWith(".map")).toBe(false);
      expect(p.endsWith(".d.ts")).toBe(false);
    }
  });
});
