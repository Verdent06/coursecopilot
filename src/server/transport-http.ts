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
import { handleHostedPage, landingHtml } from "../hosted/pages.js";
import { clientKey, RateLimiter } from "../hosted/rate-limit.js";
import { LOCAL_USER_ID, UserContextCache } from "../hosted/runtime.js";
import { UserStore } from "../hosted/users.js";
import {
  isMcpEndpoint,
  pathMatchesSecret,
  staticAuthInfo,
  verifyStaticToken,
} from "../remote/auth.js";
import { requestOrigin, SingleUserOAuth } from "../remote/oauth.js";
import { randomToken } from "../util/crypto.js";
import { log } from "../util/log.js";
import { getHomeDir } from "../util/paths.js";
import { getRequestScope, isHostedMode, runWithScope } from "../util/scope.js";
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
  /** Multi-user OAuth + per-user SQLite. Defaults from COURSECOPILOT_HOSTED / PORT. */
  hosted?: boolean;
  sessionSecret?: string;
  rateLimitRpm?: number;
};

export type HttpServerHandle = {
  server: Server;
  port: number;
  bind: string;
  token: string;
  secretPath?: string;
  origin: string;
  mcpUrl: string;
  hosted: boolean;
  close: () => Promise<void>;
};

/**
 * Streamable HTTP MCP server (spec 2026-07-28, POST to a single endpoint).
 * Auth: static bearer, secret URL path `/mcp/<token>`, and OAuth 2.1 + DCR + PKCE.
 * Hosted mode isolates each OAuth user in `$COURSECOPILOT_HOME/users/<id>/`.
 */
export async function startHttpServer(opts: HttpServeOptions): Promise<HttpServerHandle> {
  const bind = opts.bind ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const allowLocalPaths = opts.allowLocalPaths ?? false;
  const allowPrivateNetwork = opts.allowPrivateNetwork ?? false;
  const hosted = opts.hosted ?? isHostedMode();
  const ownsContext = !opts.ctx;
  const processHome = opts.homeDir ?? getHomeDir();
  const sessionSecret =
    opts.sessionSecret || process.env.COURSECOPILOT_SESSION_SECRET || opts.token || randomToken(24);
  const users = hosted ? new UserStore(processHome) : undefined;
  const rateLimitRpm = opts.rateLimitRpm ?? Number(process.env.COURSECOPILOT_RATE_LIMIT_RPM || 120);
  const limiter = new RateLimiter(Number.isFinite(rateLimitRpm) ? rateLimitRpm : 120);

  const sharedCtx =
    opts.ctx ??
    createAppContext({
      ...opts,
      homeDir: processHome,
      allowLocalPaths,
      allowPrivateNetwork,
      hostedTools: { enabled: false },
    });

  const oauth =
    opts.oauth === false
      ? undefined
      : new SingleUserOAuth({
          homeDir: processHome,
          autoApprove: opts.oauthAutoApprove ?? false,
          resourcePath: "/mcp",
          hosted,
          userStore: users,
          sessionSecret,
        });

  let userCache: UserContextCache | undefined;

  const mcpHandler: McpHttpHandler = createMcpHandler(
    () => {
      const scope = getRequestScope();
      if (hosted && scope && userCache) {
        return createServer({ ctx: userCache.get(scope.userId) });
      }
      return createServer({ ctx: sharedCtx });
    },
    { onerror: (err) => log.error("mcp handler", err) },
  );

  const allowedHosts = hostAllowList(bind, opts.allowedHosts, opts.publicUrl);
  const route: RouteOpts = {
    mcpHandler,
    token: opts.token,
    secretPath: opts.secretPath,
    publicUrl: opts.publicUrl,
    oauth,
    hosted,
    users,
    sessionSecret,
    limiter,
    processHome,
  };

  const node = toNodeHandler({
    fetch: (request, extra) =>
      handleHttpRequest(request, {
        ...route,
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
  route.publicUrl = origin;
  if (hosted && users) {
    userCache = new UserContextCache({
      users,
      processHome,
      publicUrl: origin,
      sessionSecret,
      base: { ...opts, allowLocalPaths, allowPrivateNetwork, ctx: undefined },
    });
    route.userCache = userCache;
  }
  const mcpUrl = `${origin}/mcp`;

  const close = async () => {
    await mcpHandler.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    userCache?.closeAll();
    if (ownsContext) {
      try {
        sharedCtx.opened.db.close();
      } catch {
        // already closed
      }
    }
  };

  log.info(
    `coursecopilot HTTP MCP server v${VERSION} listening on ${mcpUrl}${hosted ? " (hosted multi-user)" : ""}`,
  );
  return {
    server,
    port: address.port,
    bind,
    token: opts.token,
    secretPath: opts.secretPath,
    origin,
    mcpUrl,
    hosted,
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
  hosted?: boolean;
  users?: UserStore;
  userCache?: UserContextCache;
  sessionSecret?: string;
  limiter?: RateLimiter;
  processHome?: string;
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

  if (opts.limiter && shouldRateLimit(path, request.method)) {
    const limited = opts.limiter.check(clientKey(request));
    if (!limited.ok) {
      return cors(
        new Response(
          JSON.stringify({ error: "rate_limited", retry_after: limited.retryAfterSec }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(limited.retryAfterSec),
            },
          },
        ),
      );
    }
  }

  if (opts.oauth) {
    const oauthRes = await opts.oauth.handle(request);
    if (oauthRes) {
      return oauthRes;
    }
  }

  if (opts.hosted && opts.users && opts.userCache && opts.sessionSecret) {
    const origin = opts.publicUrl?.replace(/\/+$/, "") || requestOrigin(request);
    const page = await handleHostedPage(request, {
      origin,
      sessionSecret: opts.sessionSecret,
      users: opts.users,
      contextFor: (userId) => {
        const ctx = opts.userCache?.get(userId);
        if (!ctx) {
          throw new Error("hosted context missing");
        }
        return {
          repo: ctx.repo,
          queue: ctx.queue,
          insertSource: (input) => {
            ctx.repo.insertSource(input);
          },
        };
      },
    });
    if (page) {
      return cors(page);
    }
  }

  if (path === "/" && request.method === "GET" && !isMcpStyle(request)) {
    return landingPage(request, opts);
  }

  const mcpPath = isMcpEndpoint(path, opts.secretPath);
  const headRoot = path === "/" && (request.method === "HEAD" || request.method === "POST");
  const mcpAccept = isMcpStyle(request) && path === "/";

  if (!mcpPath && !headRoot && !mcpAccept) {
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

  const userId =
    (opts.hosted && opts.oauth?.userIdForToken(auth.token)) ||
    (opts.hosted ? LOCAL_USER_ID : undefined);
  if (userId && opts.hosted) {
    const homeDir =
      userId === LOCAL_USER_ID
        ? (opts.processHome ?? getHomeDir())
        : (opts.users?.userHome(userId) ?? getHomeDir());
    return runWithScope({ userId, homeDir, allowEnvSecrets: false }, async () =>
      cors(await opts.mcpHandler.fetch(request, { authInfo: auth })),
    );
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
  return cors(
    new Response(landingHtml(origin, Boolean(opts.hosted)), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

function shouldRateLimit(path: string, method: string): boolean {
  if (path === "/health" || path === "/healthz") {
    return false;
  }
  if (path.startsWith("/.well-known/")) {
    return false;
  }
  if (path === "/" && method === "GET") {
    return false;
  }
  return (
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/oauth/") ||
    path.startsWith("/connect/") ||
    path === "/upload" ||
    path === "/register" ||
    path === "/token"
  );
}

/** Print connector URLs for web clients after serve/tunnel starts. */
export function formatConnectorHelp(
  origin: string,
  secretPath: string | undefined,
  token: string,
): string {
  const oauthUrl = `${origin}/mcp`;
  const secretUrl = secretPath ? `${origin}/mcp/${secretPath}` : oauthUrl;
  return [
    "Paste this connector URL into Claude / ChatGPT / Gemini (OAuth):",
    "",
    `  ${oauthUrl}`,
    "",
    "  Claude:  Customize → Connectors → Add → Custom → Web → paste URL → Sign in now",
    "  ChatGPT: developer mode → Add custom MCP server → URL (OAuth). Plan-gated.",
    "  Gemini:  Spark → Custom apps → paste URL (DCR required).",
    "",
    "  Then in chat: ask to get started. No terminal.",
    "",
    "  Cursor / Claude Code / Gemini CLI (remote bearer):",
    `    URL ${oauthUrl}  with header  Authorization: Bearer ${token}`,
    `  Secret-path (weaker, no sign-in): ${secretUrl}`,
    "",
    "Hosted deploys isolate each OAuth user. Quick-tunnel hostnames change on restart.",
  ].join("\n");
}
