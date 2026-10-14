import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectCanvas } from "../canvas/connect.js";
import { parseCookieFile, saveSession } from "../ingest/lecture-capture/session.js";
import { newId } from "../util/ids.js";
import { runWithScope } from "../util/scope.js";
import { type FlowPayload, type FlowPurpose, verifyFlowToken } from "./flow.js";
import type { UserStore } from "./users.js";

export type PageDeps = {
  origin: string;
  sessionSecret: string;
  users: UserStore;
  /** Resolve or create the AppContext for a hosted user. */
  contextFor: (userId: string) => {
    repo: { addCourse: (input: { title: string; course_id?: string }) => { course_id: string } };
    queue: { submit: (sourceId: string) => string };
    insertSource: (input: {
      id: string;
      course_id: string;
      kind: "file";
      uri: string;
      config_json: string | null;
      status: "queued";
    }) => void;
  };
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD = new Set([".pdf", ".pptx", ".ppt", ".md", ".txt", ".markdown"]);

export function landingHtml(origin: string, hosted: boolean): string {
  const mcp = `${origin}/mcp`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>CourseCopilot — add to Claude, ChatGPT, Gemini</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.5; }
    h1 { font-size: 1.8rem; margin-bottom: .4rem; }
    .url { font-family: ui-monospace, monospace; font-size: 1.05rem; background: #f4f4f5; color: inherit; padding: .6rem .8rem; border-radius: 8px; word-break: break-all; }
    @media (prefers-color-scheme: dark) { .url { background: #27272a; } }
    ol { padding-left: 1.2rem; }
    section { margin: 2rem 0; }
    a { color: inherit; }
    .muted { opacity: .8; font-size: .95rem; }
  </style>
</head>
<body>
  <h1>CourseCopilot</h1>
  <p>Your classes inside the AI you already use. No terminal. No API key.</p>
  <p>Paste this connector URL into Claude, ChatGPT, or Gemini:</p>
  <p class="url" id="mcp-url">${escapeHtml(mcp)}</p>
  <p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('mcp-url').textContent)">Copy URL</button></p>

  <section>
    <h2>Add to Claude</h2>
    <ol>
      <li>Open <a href="https://claude.ai">claude.ai</a> (web or the Claude desktop/mobile app).</li>
      <li>Customize → Connectors → Add → Custom → Web.</li>
      <li>Paste <code>${escapeHtml(mcp)}</code>.</li>
      <li>Authentication: <strong>Sign in now</strong> (OAuth). Approve the CourseCopilot consent page.</li>
    </ol>
    <p class="muted">Free plan: 1 custom connector. Docs: <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">Custom connectors</a>.</p>
  </section>

  <section>
    <h2>Add to ChatGPT</h2>
    <ol>
      <li>Enable <strong>developer mode</strong> (plan-gated — check <a href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt">OpenAI’s page</a>).</li>
      <li>Plugins → + → Add custom MCP server.</li>
      <li>Server URL: <code>${escapeHtml(mcp)}</code> with OAuth.</li>
    </ol>
    <p class="muted">Pro is often read/fetch only; recording a quiz may need Claude or a Business/Edu plan.</p>
  </section>

  <section>
    <h2>Add to Gemini</h2>
    <ol>
      <li>On the web: Settings &amp; help → Connected Apps → Custom apps for Spark.</li>
      <li>Paste <code>${escapeHtml(mcp)}</code>. Spark uses OAuth + Dynamic Client Registration.</li>
    </ol>
    <p class="muted">Personal Google account only (not school). US / 18+ / English / Keep Activity on. School logins: self-host + Gemini CLI.</p>
  </section>

  <section>
    <h2>Then, in chat</h2>
    <p>Ask: <strong>get started</strong>. CourseCopilot will offer <code>connect_canvas</code>, course packs, a website, YouTube, or a file-upload link — all without a terminal.</p>
  </section>

  ${
    hosted
      ? `<section>
    <h2>This is a multi-user host</h2>
    <p>Each person who signs in with OAuth gets an isolated SQLite library under this server’s data volume. Do not paste someone else’s Canvas token. See <a href="https://github.com/Verdent06/coursecopilot">the README</a> to deploy your own.</p>
  </section>`
      : `<section>
    <h2>Self-hosted single user</h2>
    <p>This instance shares one library. Bearer token and secret-path URLs still work for local clients. Prefer OAuth for Claude / ChatGPT / Gemini.</p>
  </section>`
  }

  <p class="muted"><a href="/health">Health</a> · <a href="https://github.com/Verdent06/coursecopilot">GitHub</a></p>
</body>
</html>`;
}

export async function handleHostedPage(
  request: Request,
  deps: PageDeps,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/connect/canvas") {
    return canvasPage(request, url, deps);
  }
  if (path === "/connect/leccap") {
    return leccapPage(request, url, deps);
  }
  if (path === "/upload") {
    return uploadPage(request, url, deps);
  }
  return undefined;
}

function requireFlow(url: URL, secret: string, purpose: FlowPurpose): FlowPayload | Response {
  const token = url.searchParams.get("t") ?? "";
  const payload = verifyFlowToken(secret, token);
  if (!payload || payload.purpose !== purpose) {
    return htmlPage(
      "Link expired",
      "<h1>This link expired</h1><p>Ask your AI to call the tool again for a fresh link.</p>",
      403,
    );
  }
  return payload;
}

async function canvasPage(request: Request, url: URL, deps: PageDeps): Promise<Response> {
  const flow = requireFlow(url, deps.sessionSecret, "canvas");
  if (flow instanceof Response) {
    return flow;
  }
  if (request.method === "GET") {
    return htmlPage(
      "Connect Canvas",
      `<h1>Connect Canvas</h1>
      <p>Create a token at Canvas → Account → Settings → Approved Integrations → <strong>+ New Access Token</strong>. It is stored only in <em>your</em> library on this server (mode 0600), never in packs or logs.</p>
      <form method="post">
        <label>Canvas URL<br/><input name="base_url" required placeholder="https://umich.instructure.com" style="width:100%"/></label>
        <label>Personal access token<br/><input name="token" required type="password" autocomplete="off" style="width:100%"/></label>
        <p><button type="submit">Save and verify</button></p>
      </form>
      <p class="muted">If your school blocks student tokens, use a public course website, a pack, or the upload page instead.</p>`,
    );
  }
  if (request.method !== "POST") {
    return htmlPage("Method not allowed", "<p>POST required.</p>", 405);
  }
  const form = await readForm(request);
  const homeDir = deps.users.userHome(flow.userId);
  const result = await runWithScope({ userId: flow.userId, homeDir, allowEnvSecrets: false }, () =>
    connectCanvas({ baseUrl: form.base_url, token: form.token, yes: true }),
  );
  if (!result.ok) {
    return htmlPage(
      "Canvas connect failed",
      `<h1>Could not connect</h1><p>${escapeHtml(result.message)}</p>`,
    );
  }
  return htmlPage(
    "Canvas connected",
    `<h1>Canvas connected</h1><p>Signed in as ${escapeHtml(result.name)} on ${escapeHtml(result.baseUrl)}.</p><p>Return to chat and ask to list your Canvas courses or add one.</p>`,
  );
}

async function leccapPage(request: Request, url: URL, deps: PageDeps): Promise<Response> {
  const flow = requireFlow(url, deps.sessionSecret, "leccap");
  if (flow instanceof Response) {
    return flow;
  }
  const callback = `${deps.origin}/connect/leccap?t=${encodeURIComponent(url.searchParams.get("t") ?? "")}`;
  const bookmarklet = `javascript:void((()=>{const c=document.cookie;fetch(${JSON.stringify(callback)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cookies:c,href:location.href}),mode:'cors'}).then(()=>alert('CourseCopilot: sent visible cookies. HttpOnly SSO cookies are not included — if ingest still fails, export cookies with an extension and paste them here.')).catch((e)=>alert(String(e)));})())`;
  if (request.method === "GET") {
    return htmlPage(
      "Connect lecture capture",
      `<h1>Connect UMich Lecture Capture</h1>
      <p>UMich Weblogin + Duo cannot run on this server. The practical path is a <strong>cookie handoff</strong> from a browser where you already signed in.</p>
      <h2>Option A — paste an export (recommended)</h2>
      <p>In a signed-in tab on <code>leccap.engin.umich.edu</code>, use a cookie-export extension (Cookie-Editor, etc.) and paste Playwright <code>storageState</code> JSON or Netscape <code>cookies.txt</code>. Include <code>umich.edu</code> / Shibboleth cookies; many of those are HttpOnly so a bookmarklet cannot see them.</p>
      <form method="post">
        <textarea name="cookies" rows="10" style="width:100%" placeholder='{"cookies":[{"name":"...","value":"...","domain":".umich.edu"}]}'></textarea>
        <p><button type="submit">Save session</button></p>
      </form>
      <h2>Option B — bookmarklet</h2>
      <p>Drag this to your bookmarks, sign in to leccap, then click it. It only sends <em>non-HttpOnly</em> cookies and often is not enough for Duo/Shibboleth.</p>
      <p><a href="${escapeHtml(bookmarklet)}">Send leccap cookies to CourseCopilot</a></p>
      <p class="muted">Self-host on your laptop if you want a headed Playwright window: that path lives under Advanced in the README. Passwords are never stored.</p>`,
    );
  }
  if (request.method !== "POST") {
    return htmlPage("Method not allowed", "<p>POST required.</p>", 405);
  }
  let raw = "";
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const body = (await request.json()) as { cookies?: unknown };
      raw = typeof body.cookies === "string" ? body.cookies : JSON.stringify(body);
    } catch {
      raw = "";
    }
  } else {
    const form = await readForm(request);
    raw = form.cookies ?? "";
  }
  if (!raw.trim()) {
    return htmlPage(
      "No cookies",
      "<h1>No cookies pasted</h1><p>Export from a signed-in browser and try again.</p>",
    );
  }
  try {
    const session = parseCookieFile(raw);
    if (session.cookies.length === 0) {
      throw new Error("No cookies found.");
    }
    const homeDir = deps.users.userHome(flow.userId);
    runWithScope({ userId: flow.userId, homeDir, allowEnvSecrets: false }, () => {
      saveSession("leccap", session);
    });
    return htmlPage(
      "Lecture capture saved",
      "<h1>Session saved</h1><p>Return to chat and add a leccap site or player URL. If ingest returns 401, the export missed HttpOnly SSO cookies — re-export including <code>.umich.edu</code>.</p>",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return htmlPage(
      "Could not save session",
      `<h1>Could not save session</h1><p>${escapeHtml(message)}</p>`,
    );
  }
}

async function uploadPage(request: Request, url: URL, deps: PageDeps): Promise<Response> {
  const flow = requireFlow(url, deps.sessionSecret, "upload");
  if (flow instanceof Response) {
    return flow;
  }
  if (request.method === "GET") {
    return htmlPage(
      "Upload course files",
      `<h1>Upload course files</h1>
      <p>PDF, PPTX, Markdown, or TXT. Files stay in <em>your</em> library on this server.</p>
      <form method="post" enctype="multipart/form-data">
        <label>Course title (used if you do not pass an existing course id)<br/>
          <input name="title" placeholder="EECS 376" style="width:100%"/>
        </label>
        <label>Existing course id (optional)<br/>
          <input name="course_id" placeholder="eecs-376-f26" style="width:100%"/>
        </label>
        <label>Files<br/><input type="file" name="files" multiple /></label>
        <p><button type="submit">Upload and index</button></p>
      </form>`,
    );
  }
  if (request.method !== "POST") {
    return htmlPage("Method not allowed", "<p>POST required.</p>", 405);
  }
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim() || "Uploaded course";
  const courseIdArg = String(form.get("course_id") ?? "").trim();
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null);
  if (files.length === 0) {
    return htmlPage("No files", "<h1>No files selected</h1>");
  }
  const uploadDir = deps.users.uploadDir(flow.userId);
  mkdirSync(uploadDir, { recursive: true });
  const ctx = deps.contextFor(flow.userId);
  const course = courseIdArg ? { course_id: courseIdArg } : ctx.repo.addCourse({ title });
  const jobs: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const name = file.name || "upload.bin";
    const ext = extOf(name);
    if (!ALLOWED_UPLOAD.has(ext)) {
      skipped.push(`${name}: unsupported type`);
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      skipped.push(`${name}: larger than 25 MB`);
      continue;
    }
    const dest = join(uploadDir, `${Date.now()}-${safeName(name)}`);
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(dest, buf, { mode: 0o600 });
    const sourceId = newId();
    ctx.insertSource({
      id: sourceId,
      course_id: course.course_id,
      kind: "file",
      uri: dest,
      config_json: null,
      status: "queued",
    });
    jobs.push(ctx.queue.submit(sourceId));
  }
  return htmlPage(
    "Upload queued",
    `<h1>Upload queued</h1>
     <p>Course <code>${escapeHtml(course.course_id)}</code>. Jobs: ${jobs.map((j) => escapeHtml(j)).join(", ") || "(none)"}.</p>
     ${skipped.length ? `<p>Skipped: ${escapeHtml(skipped.join("; "))}</p>` : ""}
     <p>Return to chat and poll ingest status, then ask questions with citations.</p>`,
  );
}

async function readForm(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string") {
          out[k] = v;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.45; }
  input, textarea { margin: .35rem 0 1rem; padding: .4rem; }
  .muted { opacity: .8; font-size: .95rem; }
  code { word-break: break-all; }
</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}
