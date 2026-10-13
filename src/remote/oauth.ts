import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";
import {
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
} from "@modelcontextprotocol/server";
import { randomToken, sha256Base64Url, timingSafeEqualString } from "../util/crypto.js";
import { log } from "../util/log.js";
import { staticAuthInfo } from "./auth.js";

type RegisteredClient = {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
};

type AuthCode = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource?: string;
  expires_at: number;
};

type IssuedToken = {
  access_token: string;
  refresh_token: string;
  client_id: string;
  resource?: string;
  expires_at: number;
};

type PersistedState = {
  clients: RegisteredClient[];
  tokens: IssuedToken[];
};

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SingleUserOAuthOptions = {
  homeDir: string;
  autoApprove: boolean;
  /** Path of the MCP resource, e.g. `/mcp`. */
  resourcePath: string;
};

/**
 * Single-user OAuth 2.1 authorization server for self-hosted CourseCopilot.
 *
 * Gemini Spark custom apps require Dynamic Client Registration (RFC 7591) plus
 * PKCE. claude.ai and ChatGPT also speak this flow; they additionally accept
 * no-auth secret-path URLs (see docs/remote.md).
 */
export class SingleUserOAuth {
  private clients = new Map<string, RegisteredClient>();
  private codes = new Map<string, AuthCode>();
  private tokens = new Map<string, IssuedToken>();
  private readonly persistPath: string;
  readonly autoApprove: boolean;
  readonly resourcePath: string;

  constructor(opts: SingleUserOAuthOptions) {
    this.autoApprove = opts.autoApprove;
    this.resourcePath = opts.resourcePath.startsWith("/")
      ? opts.resourcePath
      : `/${opts.resourcePath}`;
    this.persistPath = join(opts.homeDir, "oauth.json");
    this.load();
  }

  issuerFrom(request: Request): string {
    return requestOrigin(request);
  }

  resourceUrl(issuer: string): URL {
    return new URL(this.resourcePath, `${issuer}/`);
  }

  authorizationServerMetadata(issuer: string): OAuthMetadata {
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp", "offline_access"],
      client_id_metadata_document_supported: true,
    } as OAuthMetadata;
  }

  metadataResponse(request: Request): Response | undefined {
    const issuer = this.issuerFrom(request);
    const resourceServerUrl = this.resourceUrl(issuer);
    const insecure = issuer.startsWith("http:");
    const options = {
      oauthMetadata: this.authorizationServerMetadata(issuer),
      resourceServerUrl,
      scopesSupported: ["mcp"],
      resourceName: "CourseCopilot",
      serviceDocumentationUrl: new URL("https://github.com/Verdent06/coursecopilot"),
      dangerouslyAllowInsecureIssuerUrl: insecure,
    };
    const matched = oauthMetadataResponse(request, options);
    if (matched) {
      return matched;
    }
    // Spark and others also probe the unsuffixed RFC 9728 location.
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (
      path === "/.well-known/oauth-protected-resource" ||
      path.startsWith("/.well-known/oauth-protected-resource/")
    ) {
      return oauthMetadataResponse(
        new Request(new URL("/.well-known/oauth-protected-resource/mcp", request.url), request),
        options,
      );
    }
    if (path.startsWith("/.well-known/oauth-authorization-server/")) {
      return oauthMetadataResponse(
        new Request(new URL("/.well-known/oauth-authorization-server", request.url), request),
        options,
      );
    }
    return undefined;
  }

  resourceMetadataUrl(issuer: string): string {
    return getOAuthProtectedResourceMetadataUrl(this.resourceUrl(issuer));
  }

  /** Handle AS routes. Returns undefined if the path is not an OAuth route. */
  async handle(request: Request): Promise<Response | undefined> {
    const meta = this.metadataResponse(request);
    if (meta) {
      return meta;
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/oauth/register" || path === "/register" || path === "/api/oauth/register") {
      return this.handleRegister(request);
    }
    if (path === "/oauth/authorize" || path === "/authorize") {
      return this.handleAuthorize(request);
    }
    if (path === "/oauth/token" || path === "/token" || path === "/api/oauth/token") {
      return this.handleToken(request);
    }
    return undefined;
  }

  verifyAccessToken(token: string): AuthInfo | undefined {
    const issued = this.tokens.get(token);
    if (!issued) {
      return undefined;
    }
    const now = Math.floor(Date.now() / 1000);
    if (issued.expires_at <= now) {
      this.tokens.delete(token);
      return undefined;
    }
    const resource = issued.resource ? new URL(issued.resource) : undefined;
    return staticAuthInfo(token, issued.client_id, resource);
  }

  private async handleRegister(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" });
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json(
        { error: "invalid_client_metadata", error_description: "JSON body required" },
        400,
      );
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (redirectUris.length === 0) {
      return json(
        { error: "invalid_redirect_uri", error_description: "redirect_uris is required" },
        400,
      );
    }
    for (const uri of redirectUris) {
      if (!isAllowedRedirect(uri)) {
        return json(
          { error: "invalid_redirect_uri", error_description: `Unsupported redirect_uri ${uri}` },
          400,
        );
      }
    }
    const client: RegisteredClient = {
      client_id: `cc_${randomToken(16)}`,
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      redirect_uris: redirectUris,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(client.client_id, client);
    this.save();
    return json(
      {
        client_id: client.client_id,
        client_id_issued_at: client.created_at,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  }

  private async handleAuthorize(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const params =
      request.method === "POST" ? await readForm(request) : Object.fromEntries(url.searchParams);

    const clientId = params.client_id ?? "";
    const redirectUri = params.redirect_uri ?? "";
    const state = params.state;
    const challenge = params.code_challenge ?? "";
    const method = params.code_challenge_method ?? "S256";
    const resource = params.resource;
    const responseType = params.response_type ?? "code";

    if (responseType !== "code") {
      return json({ error: "unsupported_response_type" }, 400);
    }
    if (method !== "S256" || !challenge) {
      return json(
        { error: "invalid_request", error_description: "PKCE S256 code_challenge is required" },
        400,
      );
    }
    if (!this.clientAllowsRedirect(clientId, redirectUri)) {
      return json(
        { error: "invalid_request", error_description: "Unknown client or redirect_uri" },
        400,
      );
    }

    const deny = params.approve === "deny";
    if (deny) {
      return redirectWith(redirectUri, { error: "access_denied", state });
    }

    const approved = this.autoApprove || (request.method === "POST" && params.approve === "allow");
    if (!approved) {
      return consentPage(params);
    }

    const code = randomToken(24);
    this.codes.set(code, {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      resource,
      expires_at: Date.now() + CODE_TTL_MS,
    });
    return redirectWith(redirectUri, { code, state });
  }

  private async handleToken(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    }
    const params = await readForm(request);
    const grant = params.grant_type;
    if (grant === "authorization_code") {
      return this.exchangeCode(params);
    }
    if (grant === "refresh_token") {
      return this.exchangeRefresh(params);
    }
    return json({ error: "unsupported_grant_type" }, 400);
  }

  private exchangeCode(params: Record<string, string>): Response {
    const code = this.codes.get(params.code ?? "");
    this.codes.delete(params.code ?? "");
    if (!code || code.expires_at < Date.now()) {
      return json({ error: "invalid_grant", error_description: "code is invalid or expired" }, 400);
    }
    if (
      code.client_id !== (params.client_id ?? "") ||
      code.redirect_uri !== (params.redirect_uri ?? "")
    ) {
      return json({ error: "invalid_grant" }, 400);
    }
    const verifier = params.code_verifier ?? "";
    if (!timingSafeEqualString(sha256Base64Url(verifier), code.code_challenge)) {
      return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }
    const issued = this.issueTokens(code.client_id, code.resource ?? params.resource);
    return json({
      access_token: issued.access_token,
      refresh_token: issued.refresh_token,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      scope: "mcp",
    });
  }

  private exchangeRefresh(params: Record<string, string>): Response {
    const refresh = params.refresh_token ?? "";
    const existing = [...this.tokens.values()].find((t) => t.refresh_token === refresh);
    if (!existing) {
      return json({ error: "invalid_grant" }, 400);
    }
    if (params.client_id && params.client_id !== existing.client_id) {
      return json({ error: "invalid_grant" }, 400);
    }
    this.tokens.delete(existing.access_token);
    const issued = this.issueTokens(existing.client_id, existing.resource);
    return json({
      access_token: issued.access_token,
      refresh_token: issued.refresh_token,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      scope: "mcp",
    });
  }

  private issueTokens(clientId: string, resource?: string): IssuedToken {
    const issued: IssuedToken = {
      access_token: randomToken(32),
      refresh_token: randomToken(32),
      client_id: clientId,
      resource,
      expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_S,
    };
    this.tokens.set(issued.access_token, issued);
    this.prune();
    this.save();
    return issued;
  }

  private clientAllowsRedirect(clientId: string, redirectUri: string): boolean {
    if (!clientId || !redirectUri || !isAllowedRedirect(redirectUri)) {
      return false;
    }
    const registered = this.clients.get(clientId);
    if (registered) {
      return registered.redirect_uris.includes(redirectUri);
    }
    // CIMD: client_id is an https URL (Claude / ChatGPT published identity).
    if (/^https:\/\//i.test(clientId)) {
      return true;
    }
    return false;
  }

  private prune(): void {
    const nowS = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();
    for (const [code, row] of this.codes) {
      if (row.expires_at < nowMs) {
        this.codes.delete(code);
      }
    }
    for (const [tok, row] of this.tokens) {
      if (row.expires_at * 1000 + REFRESH_TTL_MS < Date.now() && row.expires_at < nowS) {
        this.tokens.delete(tok);
      }
    }
  }

  private load(): void {
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      for (const c of parsed.clients ?? []) {
        this.clients.set(c.client_id, c);
      }
      for (const t of parsed.tokens ?? []) {
        this.tokens.set(t.access_token, t);
      }
    } catch {
      // first run or unreadable file
    }
  }

  private save(): void {
    try {
      const state: PersistedState = {
        clients: [...this.clients.values()],
        tokens: [...this.tokens.values()],
      };
      writeFileSync(this.persistPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      log.warn("could not persist OAuth state", err);
    }
  }
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || url.protocol.replace(":", "");
  const host = forwardedHost || url.host;
  return `${proto}://${host}`;
}

function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") {
      return true;
    }
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return cors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...extra },
    }),
  );
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, MCP-Protocol-Version");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS, HEAD, DELETE");
  return new Response(response.body, { status: response.status, headers });
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): Response {
  const dest = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      dest.searchParams.set(k, v);
    }
  }
  return cors(new Response(null, { status: 302, headers: { Location: dest.toString() } }));
}

function consentPage(params: Record<string, string>): Response {
  const hidden = [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
    "response_type",
  ]
    .map((name) => {
      const v = params[name];
      return v ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(v)}" />` : "";
    })
    .join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>CourseCopilot — Approve access</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; }
  button { font-size: 1rem; padding: .5rem 1rem; margin-right: .5rem; }
</style>
</head>
<body>
  <h1>Approve CourseCopilot</h1>
  <p>An AI client (<code>${escapeHtml(params.client_id ?? "")}</code>) wants to use the course index on this machine. This is a single-user, self-hosted server — only approve if you started this request.</p>
  <form method="post">
    ${hidden}
    <button type="submit" name="approve" value="allow">Approve</button>
    <button type="submit" name="approve" value="deny">Deny</button>
  </form>
</body>
</html>`;
  return cors(
    new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
