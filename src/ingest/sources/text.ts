import { basename } from "node:path";
import { MIME_MARKDOWN, MIME_PLAIN } from "../mime.js";
import type { ExtractedDocument, ExtractedSegment } from "../types.js";

export function extractPlainText(
  content: string,
  fileUri: string,
  filePath: string,
  mime: string,
): ExtractedDocument {
  const text = content
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "")
    .trim();
  const title = basename(filePath);
  const segments: ExtractedSegment[] =
    text.length === 0
      ? []
      : [
          {
            text,
            locator: { path: fileUri },
            headingPath: title,
          },
        ];
  return { title, mime: mime || MIME_PLAIN, segments, meta: {} };
}

export function extractMarkdown(
  content: string,
  fileUri: string,
  filePath: string,
): ExtractedDocument {
  const text = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const sections = splitMarkdownSections(text);
  const title = firstHeading(text) || basename(filePath);
  const segments: ExtractedSegment[] = sections.map((section) => ({
    text: section.text,
    locator: { path: fileUri },
    headingPath: section.headingPath || title,
  }));
  return { title, mime: MIME_MARKDOWN, segments, meta: {} };
}

export type MarkdownSection = {
  headingPath: string;
  text: string;
};

export function splitMarkdownSections(md: string): MarkdownSection[] {
  const lines = md.split("\n");
  const headings: string[] = [];
  const sections: MarkdownSection[] = [];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) {
      sections.push({ headingPath: headings.filter(Boolean).join(" > "), text });
    }
    buf = [];
  };

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match?.[1] && match[2]) {
      flush();
      const level = match[1].length;
      const title = match[2].trim();
      const next = headings.slice(0, level - 1);
      next[level - 1] = title;
      headings.length = 0;
      headings.push(...next);
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  if (sections.length === 0 && md.trim()) {
    return [{ headingPath: "", text: md.trim() }];
  }
  return sections;
}

function firstHeading(md: string): string {
  const match = /^#{1,3}\s+(.+)$/m.exec(md);
  return match?.[1]?.trim() ?? "";
}
