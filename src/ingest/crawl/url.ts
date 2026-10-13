const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

/** Canonicalize for de-dupe: strip hash, utm/tracking params, default ports, trailing slash, index.html. */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  let path = url.pathname || "/";
  if (/\/index\.html?$/i.test(path)) {
    path = path.replace(/\/index\.html?$/i, "/");
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (!path) {
    path = "/";
  }
  url.pathname = path;
  return url.href;
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function hostOf(url: string): string {
  return new URL(url).host;
}

/** Path prefix used as the default crawl scope (directory of the seed URL). */
export function defaultPathPrefix(seedUrl: string): string {
  const url = new URL(seedUrl);
  let path = url.pathname || "/";
  if (/\/index\.html?$/i.test(path)) {
    path = path.replace(/\/index\.html?$/i, "/");
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  if (last.includes(".")) {
    const cut = path.lastIndexOf("/");
    path = cut <= 0 ? "/" : path.slice(0, cut + 1);
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (!path.endsWith("/")) {
    path += "/";
  }
  return path;
}

export function normalizePrefix(prefix: string, seedUrl: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) {
    return defaultPathPrefix(seedUrl);
  }
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const path = new URL(trimmed).pathname || "/";
      return path.endsWith("/") ? path : `${path}/`;
    }
  } catch {
    // fall through
  }
  let path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!path.endsWith("/")) {
    path += "/";
  }
  return path;
}
