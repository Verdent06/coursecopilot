import type { ParsedLectureUrl } from "../../lecture-capture/types.js";

export const LECCAP_HOST = "leccap.engin.umich.edu";
export const LECCAP_ORIGIN = "https://leccap.engin.umich.edu";

const SITE_RE = /\/leccap\/site\/([^/?#]+)/i;
const PLAYER_RE = /\/leccap\/player\/r\/([^/?#]+)/i;
const VIEWER_REC_RE = /\/leccap\/viewer\/r\/([^/?#]+)/i;
const VIEWER_SITE_RE = /\/leccap\/viewer\/s\/([^/?#]+)/i;

export function leccapOrigin(): string {
  const override = process.env.COURSECOPILOT_LECCAP_ORIGIN?.trim();
  return override && override.length > 0 ? override.replace(/\/$/, "") : LECCAP_ORIGIN;
}

export function parseLeccapUrl(uri: string): ParsedLectureUrl | null {
  const trimmed = uri.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const originOverride = process.env.COURSECOPILOT_LECCAP_ORIGIN;
  const allowedHost =
    host === LECCAP_HOST || (originOverride ? host === new URL(leccapOrigin()).hostname : false);
  if (!allowedHost) {
    return null;
  }
  const path = url.pathname;
  const player = PLAYER_RE.exec(path) ?? VIEWER_REC_RE.exec(path);
  if (player?.[1]) {
    const recordingId = player[1];
    return {
      kind: "recording",
      origin: leccapOrigin(),
      recordingId,
      canonical: playerUrl(recordingId),
    };
  }
  const site = SITE_RE.exec(path) ?? VIEWER_SITE_RE.exec(path);
  if (site?.[1]) {
    const siteId = site[1];
    return {
      kind: "site",
      origin: leccapOrigin(),
      siteId,
      canonical: siteUrl(siteId),
    };
  }
  return null;
}

export function playerUrl(recordingId: string): string {
  return `${leccapOrigin()}/leccap/player/r/${recordingId}`;
}

export function siteUrl(siteId: string): string {
  return `${leccapOrigin()}/leccap/site/${siteId}`;
}

/**
 * Deep link into the CAEN player.
 *
 * Live player JS is behind Shibboleth + Cloudflare, so a time query/hash is
 * **[UNVERIFIED]** against the signed-in SPA. We emit the HTML Media Fragments
 * hash `#t=<seconds>` (Cloudflare's challenge preserves `location.hash`, so it
 * survives the SSO bounce). `?t=` is also accepted when parsing.
 */
export function leccapPlayerDeepLink(
  recordingUrl: string,
  startS: number | null | undefined,
): string {
  const parsed = parseLeccapUrl(recordingUrl);
  const base = parsed?.recordingId ? playerUrl(parsed.recordingId) : stripTime(recordingUrl);
  if (startS == null || !Number.isFinite(startS) || startS < 1) {
    return base;
  }
  return `${base}#t=${Math.floor(startS)}`;
}

function stripTime(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("t");
    u.searchParams.delete("time");
    return u.toString().replace(/\/$/, "") === `${u.origin}`
      ? u.toString()
      : `${u.origin}${u.pathname}`;
  } catch {
    return url.split("#")[0]?.split("?")[0] ?? url;
  }
}

export function mediaUrl(mediaPrefix: string, sitekey: string, rest: string): string {
  const prefix = mediaPrefix.startsWith("//")
    ? `https:${mediaPrefix}`
    : mediaPrefix.startsWith("http")
      ? mediaPrefix
      : `https://${mediaPrefix}`;
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${base}${sitekey}/${rest.replace(/^\//, "")}`;
}
