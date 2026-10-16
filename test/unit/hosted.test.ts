import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { signCookie, signFlowToken, verifyCookie, verifyFlowToken } from "../../src/hosted/flow.js";
import { RateLimiter } from "../../src/hosted/rate-limit.js";
import { generateRemoteSecrets } from "../../src/remote/auth.js";
import { type HttpServerHandle, startHttpServer } from "../../src/server/transport-http.js";

describe("hosted flow tokens and rate limit", () => {
  it("signs and verifies a connect-canvas token", () => {
    const token = signFlowToken("secret", { userId: "usr_1", purpose: "canvas" });
    const payload = verifyFlowToken("secret", token);
    expect(payload?.userId).toBe("usr_1");
    expect(payload?.purpose).toBe("canvas");
    expect(verifyFlowToken("other", token)).toBeUndefined();
  });

  it("rejects a tampered cookie", () => {
    const cookie = signCookie("s", "usr_1");
    expect(verifyCookie("s", cookie)).toBe("usr_1");
    expect(verifyCookie("s", cookie.replace("usr_1", "usr_2"))).toBeUndefined();
  });

  it("rate-limits after the burst is spent", () => {
    const limiter = new RateLimiter(2);
    expect(limiter.check("ip").ok).toBe(true);
    expect(limiter.check("ip").ok).toBe(true);
    const third = limiter.check("ip");
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.retryAfterSec).toBeGreaterThan(0);
    }
  });
});

describe("hosted OAuth user isolation", () => {
  const homes: string[] = [];
  const handles: HttpServerHandle[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close().catch(() => undefined);
    }
    for (const handle of handles.splice(0)) {
      await handle.close().catch(() => undefined);
    }
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("creates a user per auto-approved authorize and isolates add_course", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-hosted-"));
    homes.push(home);
    process.env.COURSECOPILOT_HOME = home;
    const { token, secretPath } = generateRemoteSecrets();
    const handle = await startHttpServer({
      port: 0,
      bind: "127.0.0.1",
      token,
      secretPath,
      hosted: true,
      oauth: true,
      oauthAutoApprove: true,
      sessionSecret: "test-session-secret",
      allowLocalPaths: false,
      homeDir: home,
    });
    handles.push(handle);
    const origin = `http://127.0.0.1:${handle.port}`;

    const landing = await fetch(`${origin}/`);
    expect(landing.ok).toBe(true);
    const landingHtml = await landing.text();
    expect(landingHtml).toMatch(/Add to Claude/);
    expect(landingHtml).toContain(`${origin}/mcp`);

    const tokenA = await oauthAccessToken(origin);
    const tokenB = await oauthAccessToken(origin);
    expect(tokenA).not.toBe(tokenB);

    const clientA = await connect(origin, tokenA);
    const clientB = await connect(origin, tokenB);
    clients.push(clientA, clientB);

    const added = await clientA.callTool({
      name: "add_course",
      arguments: { title: "Only A", course_id: "only-a" },
    });
    expect(added.isError).toBeFalsy();

    const listA = await clientA.callTool({ name: "list_courses", arguments: {} });
    const listB = await clientB.callTool({ name: "list_courses", arguments: {} });
    const coursesA = (listA.structuredContent as { courses: Array<{ course_id: string }> }).courses;
    const coursesB = (listB.structuredContent as { courses: Array<{ course_id: string }> }).courses;
    expect(coursesA.map((c) => c.course_id)).toContain("only-a");
    expect(coursesB).toEqual([]);

    const started = await clientB.callTool({ name: "get_started", arguments: {} });
    expect(started.isError).toBeFalsy();
    const body = started.structuredContent as {
      new_user: boolean;
      canvas_url: string | null;
    };
    expect(body.new_user).toBe(true);
    expect(body.canvas_url).toMatch(/\/connect\/canvas\?t=/);

    const page = await fetch(body.canvas_url ?? "");
    expect(page.ok).toBe(true);
    const pageHtml = await page.text();
    expect(pageHtml).toMatch(/Connect Canvas/);
    expect(pageHtml).toMatch(/Calendar Feed/);
    expect(pageHtml).toMatch(/browser extension/i);

    const ext = await fetch(`${origin}/extension`);
    expect(ext.ok).toBe(true);
    expect(await ext.text()).toMatch(/user-initiated/);

    const startedCanvas = await clientB.callTool({ name: "connect_canvas", arguments: {} });
    expect(startedCanvas.isError).toBeFalsy();
    const canvasBody = startedCanvas.structuredContent as {
      pairing_code: string | null;
      instructions: string;
    };
    expect(canvasBody.pairing_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(canvasBody.instructions).toMatch(/Calendar/i);

    const pair = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: canvasBody.pairing_code }),
    });
    expect(pair.ok).toBe(true);
    const paired = (await pair.json()) as { sync_token: string };
    expect(paired.sync_token).toMatch(/^cc_sync_/);

    const sync = await fetch(`${origin}/api/sync/canvas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${paired.sync_token}`,
      },
      body: JSON.stringify({
        version: 1,
        courses: [{ id: 42, name: "EECS 376", course_code: "EECS376" }],
        modules: {},
        pages: {},
        files: {},
        assignments: {
          "42": [
            {
              id: 1,
              name: "Homework 3",
              due_at: "2026-10-20T23:59:00Z",
              html_url: "https://umich.instructure.com/courses/42/assignments/1",
            },
          ],
        },
        announcements: [],
      }),
    });
    expect(sync.ok).toBe(true);

    const due = await clientB.callTool({
      name: "canvas_list_assignments",
      arguments: { upcoming_only: false },
    });
    expect(due.isError).toBeFalsy();
    const dueBody = due.structuredContent as { assignments: Array<{ name: string }> };
    expect(dueBody.assignments.some((a) => a.name === "Homework 3")).toBe(true);

    expect(readdirSync(join(home, "users")).length).toBeGreaterThanOrEqual(2);
  });
});

async function oauthAccessToken(origin: string): Promise<string> {
  const { createHash, randomBytes } = await import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const reg = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test", redirect_uris: [redirect] }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const auth = await fetch(
    `${origin}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`,
    { redirect: "manual" },
  );
  expect(auth.status).toBe(302);
  const loc = new URL(auth.headers.get("location") ?? "");
  const code = loc.searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenRes = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      redirect_uri: redirect,
      client_id: client.client_id,
      code_verifier: verifier,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as { access_token: string };
  expect(tokens.access_token).toBeTruthy();
  return tokens.access_token;
}

async function connect(origin: string, access: string): Promise<Client> {
  const client = new Client({ name: "hosted-e2e", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${access}` } },
  });
  await client.connect(transport);
  return client;
}
