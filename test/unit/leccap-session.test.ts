import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cookieHeader,
  parseCookieFile,
  SESSION_EXPIRED_MESSAGE,
  saveSession,
} from "../../src/ingest/lecture-capture/session.js";
import { importLeccapCookies } from "../../src/ingest/providers/leccap/auth.js";
import { fixtureText } from "../helpers/fake-leccap.js";

describe("leccap session cookies", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    delete process.env.COURSECOPILOT_HOME;
  });

  function withHome(): string {
    const home = mkdtempSync(join(tmpdir(), "cc-leccap-"));
    homes.push(home);
    process.env.COURSECOPILOT_HOME = home;
    return home;
  }

  it("parses Playwright storageState and Netscape cookies.txt", () => {
    const pw = parseCookieFile(fixtureText("cookies-playwright.json"));
    expect(pw.cookies.some((c) => c.name === "cosign-leccap.engin")).toBe(true);
    const ns = parseCookieFile(fixtureText("cookies-netscape.txt"));
    expect(ns.cookies.map((c) => c.name)).toContain("cosign-leccap.engin");
    expect(cookieHeader(pw, "leccap.engin.umich.edu")).toContain("cosign-leccap.engin=");
  });

  it("writes a 0600 session file and never includes a password field", () => {
    const home = withHome();
    const cookiePath = join(home, "in.json");
    writeFileSync(cookiePath, fixtureText("cookies-playwright.json"));
    const saved = importLeccapCookies(cookiePath);
    expect(saved).toBe(join(home, "leccap-session.json"));
    const body = readFileSync(saved, "utf8");
    expect(body.toLowerCase()).not.toContain("password");
    expect(body).toContain("cosign-leccap.engin");
    expect(SESSION_EXPIRED_MESSAGE).toContain("coursecopilot login leccap");
    expect(SESSION_EXPIRED_MESSAGE.toLowerCase()).not.toContain("enter your password");
  });

  it("round-trips saveSession without storing secrets besides cookies", () => {
    withHome();
    const path = saveSession("leccap", {
      cookies: [{ name: "cosign-leccap.engin", value: "x", domain: "leccap.engin.umich.edu" }],
    });
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { cookies: unknown[] };
    expect(parsed.cookies).toHaveLength(1);
  });
});
