const FILE_EXT = /\.(pdf|pptx|ppt|docx|doc)(?:$|[?#])/i;
const ARCHIVE_EXT = /\.(zip|tar|tgz|gz|rar|7z)(?:$|[?#])/i;
const MEDIA_EXT = /\.(mp4|webm|mov|avi|mkv|m4v|mp3|wav|m4a|ogg|m3u8)(?:$|[?#])/i;
const CALENDAR_EXT = /\.ics(?:$|[?#])/i;

const SSO_HOST_RE =
  /(?:^|\.)((login|sso|idp|cas|auth|okta|auth0|onelogin|pingidentity|duosecurity|shibboleth)(?:\.|$)|login\.microsoftonline\.com$|accounts\.google\.com$|signin\.aws\.amazon\.com$)/i;

export function looksLikeFileUrl(url: string): boolean {
  try {
    return FILE_EXT.test(new URL(url).pathname);
  } catch {
    return FILE_EXT.test(url);
  }
}

export function looksLikePdfUrl(url: string): boolean {
  try {
    return /\.pdf(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function looksLikePptxUrl(url: string): boolean {
  try {
    return /\.pptx?(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Pre-fetch skip: mailto, archives, media, calendars. */
export function urlSkipReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid URL";
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "mailto:") {
    return "mailto";
  }
  if (protocol === "javascript:" || protocol === "data:" || protocol === "tel:") {
    return `unsupported scheme (${protocol})`;
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return `unsupported scheme (${protocol})`;
  }
  const path = parsed.pathname.toLowerCase();
  if (ARCHIVE_EXT.test(path)) {
    return "archive";
  }
  if (MEDIA_EXT.test(path)) {
    return "video/audio";
  }
  if (CALENDAR_EXT.test(path) || isCalendarPath(parsed)) {
    return "calendar";
  }
  return null;
}

export function isSsoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (SSO_HOST_RE.test(host)) {
    return true;
  }
  return host.includes("shibboleth") || host.startsWith("login.");
}

function isCalendarPath(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (
    host.includes("calendar.google") ||
    host.includes("outlook.office") ||
    host.includes("outlook.live")
  ) {
    return true;
  }
  const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
  return parts.includes("calendar") || parts.includes("calendars");
}
