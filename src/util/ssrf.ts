import { isIP } from "node:net";
import { RepoError } from "../db/repo.js";

/**
 * Block private/loopback/link-local/metadata destinations so a remote MCP
 * caller cannot make the server fetch internal networks (spec §13).
 *
 * Hostname and IP-literal checks are synchronous and offline. DNS resolution
 * of public hostnames to a private address is M4 crawl-time (`assertResolvedPublic`).
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
  "::",
  "::1",
]);

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return false;
  }
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = stripIpv6Brackets(ip).toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }
  const mapped = ipv4Mapped(normalized);
  if (mapped) {
    return isPrivateIpv4(mapped);
  }
  const first = normalized.split(":")[0];
  if (!first) {
    return true;
  }
  const n = Number.parseInt(first.padEnd(4, "0").slice(0, 4), 16);
  if (Number.isNaN(n)) {
    return true;
  }
  // fc00::/7 unique local, fe80::/10 link-local
  if ((n & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((n & 0xffc0) === 0xfe80) {
    return true;
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const cleaned = stripIpv6Brackets(ip);
  const kind = isIP(cleaned);
  if (kind === 4) {
    return isPrivateIpv4(cleaned);
  }
  if (kind === 6) {
    return isPrivateIpv6(cleaned);
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) {
    return true;
  }
  if (BLOCKED_HOSTS.has(host)) {
    return true;
  }
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (isIP(host) && isPrivateIp(host)) {
    return true;
  }
  return false;
}

/**
 * Reject non-http(s) URLs and destinations that are obviously private.
 * Does not perform DNS. Throws RepoError.
 */
export function assertPublicUrl(urlString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new RepoError(`Invalid URL "${urlString}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RepoError(`URL must be http(s). Got ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new RepoError("URLs with userinfo are not allowed");
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new RepoError(
      `Refusing to fetch private or loopback address "${parsed.hostname}" (SSRF guard).`,
    );
  }
  return parsed;
}

function stripIpv6Brackets(value: string): string {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1);
  }
  return value;
}

function ipv4Mapped(ipv6: string): string | undefined {
  const lower = ipv6.toLowerCase();
  const marker = lower.lastIndexOf("::ffff:");
  if (marker === -1) {
    return undefined;
  }
  const tail = lower.slice(marker + "::ffff:".length);
  if (isIP(tail) === 4) {
    return tail;
  }
  return undefined;
}
