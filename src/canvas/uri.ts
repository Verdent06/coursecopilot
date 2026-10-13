const COURSE_URI = /^canvas:\/\/(?:course\/)?(\d+)\/?$/i;

/** Parse `canvas://course/<id>`, a bare Canvas course id, or a /courses/<id> URL. */
export function parseCanvasCourseId(uri: string): string | null {
  const trimmed = uri.trim();
  const proto = COURSE_URI.exec(trimmed);
  if (proto?.[1]) {
    return proto[1];
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const path = /\/courses\/(\d+)/.exec(url.pathname);
    if (path?.[1]) {
      return path[1];
    }
  } catch {
    // not a URL
  }
  return null;
}

export function canvasCourseUri(courseId: string | number): string {
  return `canvas://course/${courseId}`;
}

export function normalizeCanvasBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!value) {
    throw new Error("Canvas URL is required (e.g. https://umich.instructure.com).");
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Canvas URL "${raw}". Example: https://umich.instructure.com`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Canvas URL must be http(s).");
  }
  url.hash = "";
  url.search = "";
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "/api" || path.startsWith("/api/")) {
    path = "";
  }
  url.pathname = path;
  return url.origin + (path && path !== "/" ? path : "");
}
