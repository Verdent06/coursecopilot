import { extname } from "node:path";

export const MIME_PDF = "application/pdf";
export const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const MIME_MARKDOWN = "text/markdown";
export const MIME_PLAIN = "text/plain";
export const MIME_HTML = "text/html";

const BY_EXT: Record<string, string> = {
  ".pdf": MIME_PDF,
  ".pptx": MIME_PPTX,
  ".md": MIME_MARKDOWN,
  ".markdown": MIME_MARKDOWN,
  ".txt": MIME_PLAIN,
};

export type SupportedKind = "pdf" | "pptx" | "markdown" | "txt";

export function mimeForPath(filePath: string): string | undefined {
  return BY_EXT[extname(filePath).toLowerCase()];
}

export function supportedKind(filePath: string): SupportedKind | undefined {
  const mime = mimeForPath(filePath);
  if (mime === MIME_PDF) {
    return "pdf";
  }
  if (mime === MIME_PPTX) {
    return "pptx";
  }
  if (mime === MIME_MARKDOWN) {
    return "markdown";
  }
  if (mime === MIME_PLAIN) {
    return "txt";
  }
  return undefined;
}

export type RoutedKind = "html" | "pdf" | "pptx" | "other";

/** Route a fetched body by Content-Type, then magic bytes, then URL extension. */
export function routeFetchedKind(contentType: string, url: string, bytes: Uint8Array): RoutedKind {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    mime === MIME_HTML ||
    mime === "application/xhtml+xml" ||
    mime === "application/xml" ||
    mime === "text/xml"
  ) {
    if (looksLikePdfBytes(bytes)) {
      return "pdf";
    }
    return "html";
  }
  if (mime === MIME_PDF || mime === "application/x-pdf") {
    return "pdf";
  }
  if (
    mime === MIME_PPTX ||
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return "pptx";
  }
  if (looksLikePdfBytes(bytes)) {
    return "pdf";
  }
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".pdf")) {
      return "pdf";
    }
    if (path.endsWith(".pptx") || path.endsWith(".ppt")) {
      return "pptx";
    }
    if (path.endsWith(".html") || path.endsWith(".htm") || path.endsWith("/") || path === "") {
      return "html";
    }
  } catch {
    // ignore
  }
  if (mime.startsWith("text/")) {
    return "html";
  }
  return "other";
}

function looksLikePdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) {
    return false;
  }
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
