import { Readability } from "@mozilla/readability";
import { load } from "cheerio";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { ExtractedDocument, ExtractedSegment } from "../types.js";

export const MIME_HTML = "text/html";
export const JS_TEXT_THRESHOLD = 200;

export type SuggestedExam = {
  name: string;
  date: string | null;
  evidence: string;
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.addRule("tables", {
  filter: "table",
  replacement: (_content, node) => tableToMarkdown(outerHtml(node)),
});

export function looksLikeLoginHtml(html: string): boolean {
  const $ = load(html);
  if ($('input[type="password"]').length > 0) {
    return true;
  }
  return /type\s*=\s*["']password["']/i.test(html);
}

export function extractHtml(html: string, pageUrl: string): ExtractedDocument {
  const readable = readableContent(html, pageUrl);
  let contentHtml = readable.contentHtml;
  const originalTables = collectTables(html);
  if (originalTables.length > 0 && !/<table[\s>]/i.test(contentHtml)) {
    contentHtml += originalTables.join("\n");
  }

  const title = readable.title || titleFromUrl(pageUrl);
  const sections = splitHtmlSections(contentHtml, title);
  const segments: ExtractedSegment[] = [];
  for (const section of sections) {
    const markdown = turndown.turndown(section.html).trim();
    if (!markdown) {
      continue;
    }
    segments.push({
      text: markdown,
      locator: { url: pageUrl, anchor: section.anchor || undefined, title },
      headingPath: section.headingPath || title,
    });
  }

  return {
    title,
    mime: MIME_HTML,
    segments,
    meta: {
      needs_js:
        extractedTextLength(segments) > 0 && extractedTextLength(segments) < JS_TEXT_THRESHOLD,
    },
  };
}

export function extractLinks(html: string, pageUrl: string): string[] {
  const $ = load(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) {
      return;
    }
    try {
      out.push(new URL(href, pageUrl).href);
    } catch {
      // ignore
    }
  });
  return out;
}

export function extractedTextLength(segments: ExtractedSegment[]): number {
  return segments.reduce((n, s) => n + s.text.length, 0);
}

export function suggestExams(markdown: string): SuggestedExam[] {
  const results: SuggestedExam[] = [];
  const seen = new Set<string>();
  const re =
    /\b(midterm|final exam|\bfinal\b|\bexam\b)[\s\S]{0,80}?((?:\d{4}-\d{2}-\d{2})|(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}))/gi;
  let match: RegExpExecArray | null = re.exec(markdown);
  while (match) {
    const label = (match[1] ?? "Exam").replace(/\s+/g, " ").trim();
    const name = /final/i.test(label) ? "Final" : /midterm/i.test(label) ? "Midterm" : "Exam";
    const date = normalizeDate(match[2] ?? "");
    const evidence = match[0].replace(/\s+/g, " ").trim().slice(0, 160);
    const key = `${name}|${date ?? evidence}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ name, date, evidence });
    }
    match = re.exec(markdown);
  }
  return results;
}

type HtmlSection = {
  headingPath: string;
  anchor: string;
  html: string;
};

export function splitHtmlSections(contentHtml: string, pageTitle: string): HtmlSection[] {
  const $ = load(`<div id="cc-root">${contentHtml}</div>`);
  const root = $("#cc-root");
  const headings = ["", "", ""];
  const sections: HtmlSection[] = [];
  let current: { headingPath: string; anchor: string; parts: string[] } = {
    headingPath: pageTitle,
    anchor: "",
    parts: [],
  };

  const flush = () => {
    const html = current.parts.join("").trim();
    if (html) {
      sections.push({ headingPath: current.headingPath, anchor: current.anchor, html });
    }
  };

  const walk = (nodes: ReturnType<typeof root.contents>) => {
    nodes.each((_, node) => {
      const $node = $(node);
      const tag = String($node.prop("tagName") ?? "").toLowerCase();
      if (tag === "h1" || tag === "h2" || tag === "h3") {
        flush();
        const level = Number(tag[1]);
        const text = $node.text().trim();
        headings[level - 1] = text;
        for (let i = level; i < 3; i++) {
          headings[i] = "";
        }
        const id = $node.attr("id") || $node.attr("name") || slugify(text);
        current = {
          headingPath: headings.filter(Boolean).join(" > ") || pageTitle,
          anchor: id,
          parts: [$.html(node) ?? ""],
        };
        return;
      }
      if (tag && $node.find("h1, h2, h3").length > 0) {
        walk($node.contents());
        return;
      }
      current.parts.push($.html(node) ?? "");
    });
  };

  walk(root.contents());
  flush();
  if (sections.length === 0 && contentHtml.trim()) {
    return [{ headingPath: pageTitle, anchor: "", html: contentHtml }];
  }
  return sections;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readableContent(
  html: string,
  url: string,
): { title: string; contentHtml: string; text: string } {
  const withBase = injectBase(html, url);
  try {
    const window = parseHTML(withBase);
    const document = window.document;
    const title = document.querySelector("title")?.textContent?.trim() || "";
    try {
      const article = new Readability(document as never, { charThreshold: 20 }).parse();
      if (article?.content) {
        return {
          title: (article.title || title).trim(),
          contentHtml: String(article.content),
          text: article.textContent ?? "",
        };
      }
    } catch {
      // fall through to body
    }
    const body = document.body?.innerHTML || withBase;
    return {
      title,
      contentHtml: body,
      text: document.body?.textContent?.trim() || "",
    };
  } catch {
    return { title: "", contentHtml: html, text: stripTags(html) };
  }
}

function injectBase(html: string, url: string): string {
  const escaped = url.replace(/"/g, "&quot;");
  if (/<base\s/i.test(html)) {
    return html;
  }
  if (/<head/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${escaped}">`);
  }
  return `<base href="${escaped}">${html}`;
}

function collectTables(html: string): string[] {
  const $ = load(html);
  return $("table")
    .toArray()
    .map((el) => $.html(el))
    .filter((s): s is string => Boolean(s));
}

function tableToMarkdown(tableHtml: string): string {
  const $ = load(tableHtml);
  const rows = $("tr")
    .toArray()
    .map((tr) =>
      $(tr)
        .find("th,td")
        .toArray()
        .map((c) => $(c).text().trim().replace(/\s+/g, " ").replace(/\|/g, "\\|")),
    )
    .filter((r) => r.length > 0);
  const header = rows[0];
  if (!header) {
    return "";
  }
  const sep = header.map(() => "---");
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

function outerHtml(node: { outerHTML?: string }): string {
  return typeof node.outerHTML === "string" ? node.outerHTML : "";
}

function titleFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop() || url;
    return decodeURIComponent(name);
  } catch {
    return url;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function normalizeDate(raw: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.exec(raw.trim());
  if (iso) {
    return iso[0];
  }
  const m = /([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(raw);
  if (!m?.[1] || !m[2] || !m[3]) {
    return null;
  }
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) {
    return null;
  }
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}
