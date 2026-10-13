import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  createMcpHandler,
  type McpHttpHandler,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import {
  isMcpEndpoint,
  pathMatchesSecret,
  staticAuthInfo,
  verifyStaticToken,
} from "../remote/auth.js";
import { requestOrigin, SingleUserOAuth } from "../remote/oauth.js";
import { log } from "../util/log.js";
import { getHomeDir } from "../util/paths.js";
import { VERSION } from "../version.js";
import { type CreateServerOptions, createAppContext, createServer } from "./index.js";

export type HttpServeOptions = CreateServerOptions & {
  port?: number;
  bind?: string;
  token: string;
  secretPath?: string;
  publicUrl?: string;
  oauth?: boolean;
  oauthAutoApprove?: boolean;
  allowedHosts?: string[];
};

export type HttpServerHandle = {
  server: Server;
  port: number;
  bind: string;
  token: string;
  secretPath?: string;
  origin: string;
  mcpUrl: string;
  close: () => Promise<void>;
};

/**
 * Streamable HTTP MCP server (spec 2026-07-28, POST to a single endpoint).
 * Auth: static bearer, secret URL path `/mcp/<token>`, and single-user OAuth 2.1 + DCR.
 */
export async function startHttpServer(opts: HttpServeOptions): Promise<HttpServerHandle> {
  const bind = opts.bind ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const allowLocalPaths = opts.allowLocalPaths ?? false;
  const ownsContext = !opts.ctx;
  const ctx = opts.ctx ?? createAppContext({ ...opts, allowLocalPaths });
  const homeDir = getHomeDir();
  const oauth =
    opts.oauth === false
      ? undefined
      : new SingleUserOAuth({
          homeDir,
          autoApprove: opts.oauthAutoApprove ?? false,
          resourcePath: "/mcp",
        });

  const mcpHandler: McpHttpHandler = createMcpHandler(() => createServer({ ctx }), {
    onerror: (err) => log.error("mcp handler", err),
  });

  const allowedHosts = hostAllowList(bind, opts.allowedHosts, opts.publicUrl);

  const node = toNodeHandler({
    fetch: (request, extra) =>
      handleHttpRequest(request, {
        mcpHandler,
        token: opts.token,
        secretPath: opts.secretPath,
        publicUrl: opts.publicUrl,
        oauth,
        extraAuth: extra?.authInfo,
      }),
  });

  const server = createHttpServer((req, res) => {
    if (!isAllowedHostHeader(req.headers.host, allowedHosts)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden", error_description: "invalid Host header" }));
      return;
    }
    void node(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const origin =
    opts.publicUrl?.replace(/\/+$/, "") ??
    `http://${bind === "0.0.0.0" ? "127.0.0.1" : bind}:${address.port}`;
  const mcpUrl = opts.secretPath ? `${origin}/mcp/${opts.secretPath}` : `${origin}/mcp`;

  const close = async () => {
    await mcpHandler.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (ownsContext) {
      try {
        ctx.opened.db.close();
      } catch {
        // already closed
      }
    }
  };

  log.info(`coursecopilot HTTP MCP server v${VERSION} listening on ${mcpUrl}`);
  return {
    server,
    port: address.port,
    bind,
    token: opts.token,
    secretPath: opts.secretPath,
    origin,
    mcpUrl,
    close,
  };
}

type RouteOpts = {
  mcpHandler: McpHttpHandler;
  token: string;
  secretPath?: string;
  publicUrl?: string;
  oauth?: SingleUserOAuth;
  extraAuth?: AuthInfo;
};

export async function handleHttpRequest(request: Request, opts: RouteOpts): Promise<Response> {
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health" || path === "/healthz") {
    return cors(
      new Response(JSON.stringify({ ok: true, name: "coursecopilot", version: VERSION }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  if (opts.oauth) {
    const oauthRes = await opts.oauth.handle(request);
    if (oauthRes) {
      return oauthRes;
    }
  }

  const mcpPath = isMcpEndpoint(path, opts.secretPath);
  const headRoot = path === "/" && (request.method === "HEAD" || request.method === "POST");
  const mcpAccept = isMcpStyle(request) && path === "/";

  if (!mcpPath && !headRoot && !mcpAccept) {
    if (path === "/" && request.method === "GET") {
      return landingPage(request, opts);
    }
    return cors(
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  const auth = await authenticate(request, opts, path);
  if (auth instanceof Response) {
    return cors(auth);
  }
  return cors(await opts.mcpHandler.fetch(request, { authInfo: auth }));
}

async function authenticate(
  request: Request,
  opts: RouteOpts,
  path: string,
): Promise<AuthInfo | Response> {
  const issuer = opts.publicUrl?.replace(/\/+$/, "") || requestOrigin(request);
  const resource = new URL("/mcp", `${issuer}/`);
  const resourceMetadataUrl = opts.oauth?.resourceMetadataUrl(issuer);

  const secretOk = Boolean(opts.secretPath && pathMatchesSecret(path, opts.secretPath));
  const header = request.headers.get("authorization");

  if (header) {
    const gate = requireBearerAuth({
      verifier: {
        verifyAccessToken: async (token) => {
          if (verifyStaticToken(token, opts.token)) {
            return staticAuthInfo(token, "static-token", resource);
          }
          const oauthInfo = opts.oauth?.verifyAccessToken(token);
          if (oauthInfo) {
            return { ...oauthInfo, resource };
          }
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
        },
      },
      resourceMetadataUrl,
    });
    return gate(request);
  }

  if (secretOk) {
    return staticAuthInfo(opts.secretPath ?? opts.token, "secret-path", resource);
  }

  if (opts.extraAuth) {
    return opts.extraAuth;
  }

  return challengeResponse(resourceMetadataUrl);
}

function challengeResponse(resourceMetadataUrl?: string): Response {
  const err = new OAuthError(OAuthErrorCode.InvalidToken, "Authentication required");
  const params = ['Bearer realm="coursecopilot"', 'error="invalid_token"'];
  if (resourceMetadataUrl) {
    params.push(`resource_metadata="${resourceMetadataUrl}"`);
  }
  return new Response(JSON.stringify(err.toResponseObject()), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": params.join(", "),
    },
  });
}

function isMcpStyle(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const ct = request.headers.get("content-type") ?? "";
  return (
    accept.includes("text/event-stream") ||
    accept.includes("application/json") ||
    ct.includes("application/json") ||
    request.headers.has("mcp-protocol-version")
  );
}

function hostAllowList(bind: string, extra: string[] | undefined, publicUrl?: string): string[] {
  if (bind === "0.0.0.0" || bind === "::") {
    return ["*"];
  }
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).hostname);
    } catch {
      // ignore
    }
  }
  for (const h of extra ?? []) {
    hosts.add(h);
  }
  return [...hosts];
}

export function isAllowedHostHeader(
  hostHeader: string | string[] | undefined,
  allowed: string[],
): boolean {
  if (allowed.includes("*")) {
    return true;
  }
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!raw) {
    return false;
  }
  const hostname = hostnameFromHostHeader(raw);
  if (allowed.includes(hostname)) {
    return true;
  }
  if (hostname.endsWith(".trycloudflare.com")) {
    return true;
  }
  return false;
}

function hostnameFromHostHeader(header: string): string {
  const lower = header.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    return end === -1 ? lower : lower.slice(0, end + 1);
  }
  return lower.split(":")[0] ?? lower;
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set(
    "access-control-allow-headers",
    "Authorization, Content-Type, MCP-Protocol-Version, mcp-session-id",
  );
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS, HEAD, DELETE");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function landingPage(request: Request, opts: RouteOpts): Response {
  const origin = opts.publicUrl?.replace(/\/+$/, "") || requestOrigin(request);
  const secretUrl = opts.secretPath ? `${origin}/mcp/${opts.secretPath}` : `${origin}/mcp`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>CourseCopilot</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
  <h1>CourseCopilot</h1>
  <p>Streamable HTTP MCP server is running.</p>
  <ul>
    <li>Health: <a href="/health"><code>/health</code></a></li>
    <li>MCP (OAuth / bearer): <code>${escapeHtml(`${origin}/mcp`)}</code></li>
    <li>MCP (secret path): <code>${escapeHtml(secretUrl)}</code></li>
  </ul>
  <p>See <a href="https://github.com/Verdent06/coursecopilot/blob/main/docs/remote.md">docs/remote.md</a> for claude.ai, ChatGPT, and Gemini setup.</p>
</body></html>`;
  return cors(
    new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Print connector URLs for web clients after serve/tunnel starts. */
export function formatConnectorHelp(
  origin: string,
  secretPath: string | undefined,
  token: string,
): string {
  const secretUrl = secretPath ? `${origin}/mcp/${secretPath}` : `${origin}/mcp`;
  const oauthUrl = `${origin}/mcp`;
  return [
    "Web clients (Anthropic's / OpenAI's / Google's cloud must reach this URL):",
    "",
    `  claude.ai:  ${secretUrl}`,
    "    Customize → Connectors → Add → Custom → Web → paste URL → Authentication: No sign in",
    "    Docs: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    `    OAuth alternative: ${oauthUrl} → Sign in now (DCR / Claude published identity)`,
    "",
    `  ChatGPT:    ${secretUrl}`,
    "    Enable developer mode → Plugins → + → Add custom MCP server → URL → No authentication",
    "    Docs: https://developers.openai.com/api/docs/guides/custom-mcp-server",
    "    Plan-gated; Pro is read/fetch only. Check OpenAI's page for current plans.",
    "",
    `  Gemini app: ${oauthUrl}`,
    "    gemini.google.com → Settings & help → Connected Apps → Custom apps for Spark → Add a custom app",
    "    Spark requires OAuth + Dynamic Client Registration. Approve the consent page on this machine.",
    "    Docs: https://support.google.com/gemini/answer/17209137",
    "    Gates: Gemini Spark, US, 18+, personal Google account (not school), English, Keep Activity on.",
    "",
    "  Cursor / Claude Code / Gemini CLI (remote):",
    `    URL ${oauthUrl}  with header  Authorization: Bearer ${token}`,
    "",
    "The secret path is weaker than OAuth (anyone with the URL can use the server). Quick-tunnel hostnames change on restart.",
  ].join("\n");
}
