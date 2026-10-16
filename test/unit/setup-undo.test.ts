import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordUndoSession, undoLastSetup, undoLogPath } from "../../src/setup/undo.js";

describe("setup undo log creates the home directory", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes setup-undo.json when ~/.coursecopilot does not exist yet", () => {
    const parent = mkdtempSync(join(tmpdir(), "cc-undo-parent-"));
    temps.push(parent);
    const home = join(parent, "missing-home");
    expect(existsSync(home)).toBe(false);
    recordUndoSession(
      { at: "2026-10-14T00:00:00.000Z", files: [{ path: "/tmp/x", backup: null }] },
      home,
    );
    expect(existsSync(undoLogPath(home))).toBe(true);
    const raw = JSON.parse(readFileSync(undoLogPath(home), "utf8")) as {
      sessions: Array<{ files: unknown[] }>;
    };
    expect(raw.sessions).toHaveLength(1);
    const undone = undoLastSetup(home);
    expect(undone.ok).toBe(true);
  });
});
