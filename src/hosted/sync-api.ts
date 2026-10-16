import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCanvasSnapshot, saveCanvasSnapshot } from "../canvas/snapshot.js";
import { parseLeccapSnapshot, saveLeccapSnapshot } from "../ingest/lecture-capture/snapshot.js";
import { runWithScope } from "../util/scope.js";
import type { PairingStore } from "./pairing.js";
import { LOCAL_USER_ID } from "./runtime.js";
import type { UserStore } from "./users.js";

const MAX_SYNC_BYTES = 8 * 1024 * 1024;

export type SyncApiDeps = {
  origin: string;
  pairing: PairingStore;
  users?: UserStore;
  processHome: string;
};

export async function handleSyncApi(
  request: Request,
  deps: SyncApiDeps,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/pair" && request.method === "POST") {
    return pair(request, deps);
  }
  if (path === "/api/sync/canvas" && request.method === "POST") {
    return syncCanvas(request, deps);
  }
  if (path === "/api/sync/leccap" && request.method === "POST") {
    return syncLeccap(request, deps);
  }
  if (path === "/extension" && request.method === "GET") {
    return extensionPage(deps.origin);
  }
  if (path.startsWith("/extension/") && request.method === "GET") {
    return extensionAsset(path.slice("/extension/".length));
  }
  return undefined;
}

async function pair(request: Request, deps: SyncApiDeps): Promise<Response> {
  const body = await readJson(request);
  const code = typeof body.code === "string" ? body.code : "";
  const redeemed = deps.pairing.redeem(code);
  if (!redeemed) {
    return json(
      { error: "invalid_code", hint: "Ask chat to call connect_canvas for a fresh code." },
      400,
    );
  }
  return json({
    sync_token: redeemed.syncToken,
    host: deps.origin,
    user_id: redeemed.userId,
  });
}

async function syncCanvas(request: Request, deps: SyncApiDeps): Promise<Response> {
  const userId = userFromAuth(request, deps);
  if (userId instanceof Response) {
    return userId;
  }
  const body = await readJson(request);
  let snapshot: ReturnType<typeof parseCanvasSnapshot>;
  try {
    snapshot = parseCanvasSnapshot(body);
  } catch (err) {
    return json(
      { error: "bad_snapshot", hint: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
  snapshot.synced_at = new Date().toISOString();
  const homeDir = homeFor(userId, deps);
  const path = runWithScope({ userId, homeDir, allowEnvSecrets: false }, () =>
    saveCanvasSnapshot(snapshot),
  );
  return json({
    ok: true,
    kind: "canvas",
    path,
    courses: snapshot.courses.length,
    synced_at: snapshot.synced_at,
  });
}

async function syncLeccap(request: Request, deps: SyncApiDeps): Promise<Response> {
  const userId = userFromAuth(request, deps);
  if (userId instanceof Response) {
    return userId;
  }
  const body = await readJson(request);
  let snapshot: ReturnType<typeof parseLeccapSnapshot>;
  try {
    snapshot = parseLeccapSnapshot(body);
  } catch (err) {
    return json(
      { error: "bad_snapshot", hint: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
  snapshot.synced_at = new Date().toISOString();
  const homeDir = homeFor(userId, deps);
  const path = runWithScope({ userId, homeDir, allowEnvSecrets: false }, () =>
    saveLeccapSnapshot(snapshot),
  );
  return json({
    ok: true,
    kind: "leccap",
    path,
    recordings: snapshot.recordings.length,
    synced_at: snapshot.synced_at,
  });
}

function userFromAuth(request: Request, deps: SyncApiDeps): string | Response {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const userId = deps.pairing.userIdForSyncToken(token);
  if (!userId) {
    return json({ error: "invalid_sync_token" }, 401);
  }
  return userId;
}

function homeFor(userId: string, deps: SyncApiDeps): string {
  if (userId === LOCAL_USER_ID || !deps.users) {
    return deps.processHome;
  }
  return deps.users.userHome(userId);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const cl = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(cl) && cl > MAX_SYNC_BYTES) {
    throw new Error("payload too large");
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > MAX_SYNC_BYTES) {
    throw new Error("payload too large");
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extensionRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../extension");
}

function extensionPage(origin: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CourseCopilot Sync extension</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  code, .url { font-family: ui-monospace, monospace; }
  ol { padding-left: 1.2rem; }
  .muted { opacity: .8; font-size: .95rem; }
</style></head>
<body>
  <h1>CourseCopilot Sync</h1>
  <p>A small, <strong>read-only</strong>, user-initiated browser extension. You stay signed into Canvas (and UMich leccap) the normal way — SSO / Okta / Duo. The extension never asks for a password or a personal access token. It calls the Canvas REST API and leccap product/webvtt APIs with your existing session (same-origin fetch + CSRF) and POSTs a JSON snapshot to <em>your</em> CourseCopilot library.</p>
  <h2>Install (Chrome / Edge / Firefox, Manifest V3)</h2>
  <ol>
    <li>Download the <code>extension/</code> folder from the <a href="https://github.com/Verdent06/coursecopilot/tree/main/extension">CourseCopilot repo</a> (or copy it from a source checkout).</li>
    <li>Chrome / Edge: <code>chrome://extensions</code> → Developer mode → Load unpacked → select that folder.</li>
    <li>Firefox: <code>about:debugging#/runtime/this-firefox</code> → Load Temporary Add-on → <code>manifest.json</code>.</li>
  </ol>
  <h2>Pair</h2>
  <ol>
    <li>In chat, call <code>connect_canvas</code> (or <code>connect_leccap</code>). Copy the one-time code and this host: <code class="url">${escapeHtml(origin)}</code></li>
    <li>Open the extension, paste the host + code, click Pair.</li>
    <li>Open a signed-in Canvas tab (and a leccap tab if you want recordings), then Sync.</li>
  </ol>
  <p class="muted">The extension only runs when you click Sync. It does not run in the background, does not write to Canvas, and does not send cookies to CourseCopilot — only the JSON the APIs already return to your browser.</p>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function extensionAsset(rel: string): Response {
  const root = extensionRoot();
  if (!existsSync(root)) {
    return json({ error: "not_found" }, 404);
  }
  const safe = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (safe.includes("..") || safe.startsWith("/")) {
    return json({ error: "not_found" }, 404);
  }
  const dest = join(root, safe);
  if (!dest.startsWith(root) || !existsSync(dest) || !statSync(dest).isFile()) {
    return json({ error: "not_found" }, 404);
  }
  const type = safe.endsWith(".js")
    ? "text/javascript"
    : safe.endsWith(".json")
      ? "application/json"
      : safe.endsWith(".html")
        ? "text/html; charset=utf-8"
        : safe.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
  return new Response(readFileSync(dest), {
    headers: { "content-type": type },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Listed so tests can assert the folder is shipped. */
export function listExtensionFiles(): string[] {
  const root = extensionRoot();
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root);
}
