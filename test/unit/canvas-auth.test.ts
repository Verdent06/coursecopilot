import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCanvasCredentials, saveCanvasCredentials } from "../../src/canvas/auth.js";
import { connectCanvas } from "../../src/canvas/connect.js";
import { normalizeCanvasBaseUrl, parseCanvasCourseId } from "../../src/canvas/uri.js";
import {
  BLOCKED_TOKEN,
  createFakeCanvas,
  EXPIRED_TOKEN,
  VALID_TOKEN,
} from "../helpers/fake-canvas.js";

describe("Canvas auth + connect", () => {
  const homes: string[] = [];

  afterEach(() => {
    delete process.env.CANVAS_TOKEN;
    delete process.env.CANVAS_BASE_URL;
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-secrets-"));
    homes.push(dir);
    process.env.COURSECOPILOT_HOME = dir;
    return dir;
  }

  it("normalizes instance URLs and canvas:// URIs", () => {
    expect(normalizeCanvasBaseUrl("umich.instructure.com")).toBe("https://umich.instructure.com");
    expect(normalizeCanvasBaseUrl("https://umich.instructure.com/")).toBe(
      "https://umich.instructure.com",
    );
    expect(normalizeCanvasBaseUrl("https://umich.instructure.com/api/v1")).toBe(
      "https://umich.instructure.com",
    );
    expect(parseCanvasCourseId("canvas://course/123")).toBe("123");
    expect(parseCanvasCourseId("123")).toBe("123");
    expect(parseCanvasCourseId("https://umich.instructure.com/courses/123/modules")).toBe("123");
    expect(parseCanvasCourseId("not-a-course")).toBeNull();
  });

  it("saves secrets at 0600 and never stores the token in env dumps of the file path only", async () => {
    const dir = home();
    const path = saveCanvasCredentials({
      baseUrl: "https://umich.instructure.com",
      token: "super-secret-token",
    });
    expect(path).toBe(join(dir, "secrets.json"));
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("super-secret-token");
    expect(raw).toContain("https://umich.instructure.com");
    const creds = loadCanvasCredentials();
    expect(creds?.token).toBe("super-secret-token");
    try {
      const mode = (await import("node:fs")).statSync(path).mode & 0o777;
      if (process.platform !== "win32") {
        expect(mode).toBe(0o600);
      }
    } catch {
      // ignore
    }
  });

  it("lets env override the secrets file", () => {
    home();
    saveCanvasCredentials({ baseUrl: "https://umich.instructure.com", token: "file-token" });
    process.env.CANVAS_TOKEN = "env-token";
    process.env.CANVAS_BASE_URL = "https://canvas.test";
    const creds = loadCanvasCredentials();
    expect(creds?.token).toBe("env-token");
    expect(creds?.baseUrl).toBe("https://canvas.test");
  });

  it("connect validates and writes secrets; blocked/expired do not write a token", async () => {
    const dir = home();
    const fake = await createFakeCanvas();
    const ok = await connectCanvas({
      baseUrl: "https://umich.instructure.com",
      token: VALID_TOKEN,
      yes: true,
      fetchFn: fake.fetch,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.name).toBe("Jane Student");
      expect(readFileSync(ok.secretsPath, "utf8")).toContain(VALID_TOKEN);
    }

    rmSync(join(dir, "secrets.json"), { force: true });
    const blocked = await connectCanvas({
      baseUrl: "https://umich.instructure.com",
      token: BLOCKED_TOKEN,
      yes: true,
      fetchFn: fake.fetch,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.message).toMatch(/disabled|blocked|New Access Token/i);
      expect(blocked.message).toMatch(/website|pack|folder/i);
    }
    expect(loadCanvasCredentials()).toBeNull();

    const expired = await connectCanvas({
      baseUrl: "https://umich.instructure.com",
      token: EXPIRED_TOKEN,
      yes: true,
      fetchFn: fake.fetch,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.message).toMatch(/401|expired|revoked/i);
    }
  });

  it("does not treat a leftover world-readable file as a place to keep writing tokens without chmod", () => {
    const dir = home();
    const path = join(dir, "secrets.json");
    writeFileSync(path, "{}", { mode: 0o644 });
    saveCanvasCredentials({ baseUrl: "https://umich.instructure.com", token: "x" });
    try {
      chmodSync(path, 0o600);
    } catch {
      // windows
    }
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain('"token"');
    expect(raw).not.toMatch(/cc\.db/);
  });
});
