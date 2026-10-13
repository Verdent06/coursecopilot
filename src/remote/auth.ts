import type { AuthInfo } from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { randomSecret128, timingSafeEqualString } from "../util/crypto.js";

const YEAR_S = 365 * 24 * 60 * 60;

export type RemoteAuthConfig = {
  /** Static bearer token. Also the default secret-path token. */
  token: string;
  /** Path segment after /mcp/. Undefined disables secret-path auth. */
  secretPath?: string;
};

export function generateRemoteSecrets(): { token: string; secretPath: string } {
  const token = randomSecret128();
  return { token, secretPath: token };
}

export function verifyStaticToken(token: string, expected: string): boolean {
  return timingSafeEqualString(token, expected);
}

export function staticAuthInfo(token: string, clientId: string, resource?: URL): AuthInfo {
  return {
    token,
    clientId,
    scopes: ["mcp"],
    expiresAt: Math.floor(Date.now() / 1000) + YEAR_S,
    resource,
  };
}

export function invalidTokenError(): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or missing access token");
}

/** True when pathname is `/mcp/<secret>` (trailing slash ignored). */
export function pathMatchesSecret(pathname: string, secret: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  const expected = `/mcp/${secret}`;
  return timingSafeEqualString(trimmed, expected);
}

export function isMcpEndpoint(pathname: string, secret?: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (trimmed === "/mcp" || trimmed === "/") {
    return true;
  }
  if (secret && pathMatchesSecret(trimmed, secret)) {
    return true;
  }
  return false;
}

export function mcpUrl(origin: string, secretPath?: string): string {
  const base = origin.replace(/\/+$/, "");
  return secretPath ? `${base}/mcp/${secretPath}` : `${base}/mcp`;
}
