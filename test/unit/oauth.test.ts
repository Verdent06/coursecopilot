import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SingleUserOAuth } from "../../src/remote/oauth.js";

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("single-user OAuth", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function make(): SingleUserOAuth {
    const home = mkdtempSync(join(tmpdir(), "cc-oauth-"));
    dirs.push(home);
    return new SingleUserOAuth({ homeDir: home, autoApprove: true, resourcePath: "/mcp" });
  }

  it("serves PRM and AS metadata, DCR, PKCE code, and access token", async () => {
    const oauth = make();
    const origin = "http://127.0.0.1:8787";

    const prm = await oauth.handle(new Request(`${origin}/.well-known/oauth-protected-resource`));
    expect(prm?.status).toBe(200);
    const prmBody = (await prm?.json()) as { resource: string; authorization_servers: string[] };
    expect(prmBody.resource).toContain("/mcp");
    expect(prmBody.authorization_servers[0]).toBe(origin);

    const as = await oauth.handle(new Request(`${origin}/.well-known/oauth-authorization-server`));
    expect(as?.status).toBe(200);
    const asBody = (await as?.json()) as {
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(asBody.registration_endpoint).toBe(`${origin}/oauth/register`);
    expect(asBody.code_challenge_methods_supported).toContain("S256");

    const { verifier, challenge } = pkce();
    const redirect = "https://oauth-redirect.googleusercontent.com/r/test";
    const reg = await oauth.handle(
      new Request(`${origin}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Google",
          redirect_uris: [
            redirect,
            `${redirect}2`,
            `${redirect}3`,
            `${redirect}4`,
            `${redirect}5`,
            `${redirect}6`,
          ],
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    expect(reg?.status).toBe(201);
    const client = (await reg?.json()) as { client_id: string; client_secret?: string };
    expect(client.client_id).toMatch(/^cc_/);
    expect(client.client_secret).toBeUndefined();

    const auth = await oauth.handle(
      new Request(
        `${origin}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&resource=${encodeURIComponent(`${origin}/mcp`)}`,
      ),
    );
    expect(auth?.status).toBe(302);
    const loc = new URL(auth?.headers.get("location") ?? "");
    const code = loc.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("xyz");

    const tokenRes = await oauth.handle(
      new Request(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code ?? "",
          redirect_uri: redirect,
          client_id: client.client_id,
          code_verifier: verifier,
        }).toString(),
      }),
    );
    expect(tokenRes?.status).toBe(200);
    const tokens = (await tokenRes?.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
    };
    expect(tokens.token_type).toBe("Bearer");
    const info = oauth.verifyAccessToken(tokens.access_token);
    expect(info?.clientId).toBe(client.client_id);
    expect(info?.scopes).toContain("mcp");
  });

  it("rejects a bad PKCE verifier", async () => {
    const oauth = make();
    const origin = "http://127.0.0.1:9";
    const { challenge } = pkce();
    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const reg = await oauth.handle(
      new Request(`${origin}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
      }),
    );
    const client = (await reg?.json()) as { client_id: string };
    const auth = await oauth.handle(
      new Request(
        `${origin}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256`,
      ),
    );
    const code = new URL(auth?.headers.get("location") ?? "").searchParams.get("code");
    const tokenRes = await oauth.handle(
      new Request(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code ?? "",
          redirect_uri: redirect,
          client_id: client.client_id,
          code_verifier: "definitely-not-the-verifier",
        }).toString(),
      }),
    );
    expect(tokenRes?.status).toBe(400);
  });
});
