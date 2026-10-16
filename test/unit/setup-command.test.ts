import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSourceCheckout,
  localStdioSpec,
  PUBLISHED_STDIO_SPEC,
  packageRootFromHere,
  stdioServerSpec,
} from "../../src/setup/command.js";

describe("stdioServerSpec source vs published", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats this repo as a source checkout", () => {
    const root = packageRootFromHere();
    expect(isSourceCheckout(root)).toBe(true);
    const spec = stdioServerSpec({ env: {} });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0]).toBe(localStdioSpec(root).args[0]);
    expect(spec.args[0]).toMatch(/cli\.(js|ts)$/);
  });

  it("COURSECOPILOT_SETUP_NPX=1 forces the unpublished-safe published entry", () => {
    expect(stdioServerSpec({ env: { COURSECOPILOT_SETUP_NPX: "1" } })).toEqual(
      PUBLISHED_STDIO_SPEC,
    );
  });

  it("does not treat a node_modules install as a checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-nm-"));
    temps.push(dir);
    const root = join(dir, "node_modules", "coursecopilot");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"coursecopilot"}\n');
    writeFileSync(join(root, "src", "cli.ts"), "");
    expect(isSourceCheckout(root)).toBe(false);
    expect(stdioServerSpec({ env: {}, packageRoot: root })).toEqual(PUBLISHED_STDIO_SPEC);
  });

  it("published:false falls back to the local absolute path", () => {
    const spec = stdioServerSpec({
      env: { COURSECOPILOT_SETUP_NPX: "0" },
      packageRoot: join(tmpdir(), "node_modules", "coursecopilot-not-real"),
      published: false,
    });
    expect(spec.command).toBe(process.execPath);
  });
});
