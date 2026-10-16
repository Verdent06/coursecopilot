import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "../util/crypto.js";

export type FlowPurpose = "canvas" | "leccap" | "upload";

export type FlowPayload = {
  userId: string;
  purpose: FlowPurpose;
  exp: number;
};

const DEFAULT_TTL_S = 2 * 60 * 60;

export function signFlowToken(
  secret: string,
  payload: Omit<FlowPayload, "exp"> & { exp?: number },
  ttlS = DEFAULT_TTL_S,
): string {
  const full: FlowPayload = {
    userId: payload.userId,
    purpose: payload.purpose,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + ttlS,
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

export function verifyFlowToken(secret: string, token: string): FlowPayload | undefined {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!timingSafeEqualString(sig, hmac(secret, body))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as FlowPayload;
    if (!parsed.userId || !parsed.purpose || typeof parsed.exp !== "number") {
      return undefined;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function signCookie(secret: string, userId: string): string {
  return `${userId}.${hmac(secret, userId)}`;
}

export function verifyCookie(secret: string, cookie: string | undefined): string | undefined {
  if (!cookie) {
    return undefined;
  }
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const userId = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (!userId || !timingSafeEqualString(sig, hmac(secret, userId))) {
    return undefined;
  }
  return userId;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}
