import { extname } from "node:path";

export const MIME_PDF = "application/pdf";
export const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const MIME_MARKDOWN = "text/markdown";
export const MIME_PLAIN = "text/plain";

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
