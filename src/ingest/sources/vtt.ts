import { basename } from "node:path";
import { formatTimestamp } from "../../util/timestamp.js";
import { estimateTokens } from "../chunker.js";
import { CAPTION_WINDOW_SECONDS, TARGET_TOKENS, WORD_TOKEN_FACTOR } from "../config.js";
import type { ExtractedDocument, ExtractedSegment, Locator } from "../types.js";

export type CaptionCue = {
  start_s: number;
  end_s: number;
  text: string;
};

const MIME_VTT = "text/vtt";
const MIME_SRT = "application/x-subrip";

/** Parse a VTT or SRT body into timed cues. */
export function parseCaptionFile(content: string): CaptionCue[] {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (looksLikeSrt(text)) {
    return parseSrt(text);
  }
  return parseVtt(text);
}

export function looksLikeSrt(text: string): boolean {
  const trimmed = text.trimStart();
  if (/^WEBVTT\b/i.test(trimmed)) {
    return false;
  }
  return /^\d+\s*\n\d{1,2}:\d{2}/m.test(trimmed) || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(trimmed);
}

export function parseVtt(content: string): CaptionCue[] {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const body = text.replace(/^WEBVTT[^\n]*\n/, "");
  const chunks = body.split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trimEnd());
    if (
      lines.length === 0 ||
      /^NOTE\b/i.test(lines[0] ?? "") ||
      /^STYLE\b/i.test(lines[0] ?? "") ||
      /^REGION\b/i.test(lines[0] ?? "")
    ) {
      continue;
    }
    let timeLine = lines[0] ?? "";
    let textLines = lines.slice(1);
    if (!timeLine.includes("-->") && lines[1]?.includes("-->")) {
      timeLine = lines[1] ?? "";
      textLines = lines.slice(2);
    }
    const range = parseTimeRange(timeLine);
    if (!range) {
      continue;
    }
    const cueText = cleanCueText(textLines.join(" "));
    if (!cueText) {
      continue;
    }
    cues.push({ start_s: range.start, end_s: range.end, text: cueText });
  }
  return cues;
}

export function parseSrt(content: string): CaptionCue[] {
  const text = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const chunks = text.split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trimEnd());
    if (lines.length === 0) {
      continue;
    }
    let idx = 0;
    if (/^\d+$/.test(lines[0]?.trim() ?? "")) {
      idx = 1;
    }
    const timeLine = lines[idx] ?? "";
    const range = parseTimeRange(timeLine);
    if (!range) {
      continue;
    }
    const cueText = cleanCueText(lines.slice(idx + 1).join(" "));
    if (!cueText) {
      continue;
    }
    cues.push({ start_s: range.start, end_s: range.end, text: cueText });
  }
  return cues;
}

export function parseTimeRange(line: string): { start: number; end: number } | null {
  if (!/-->/.test(line)) {
    return null;
  }
  const parts = line.split(/\s*-->\s*/);
  const startTok = parts[0]?.trim().split(/\s+/)[0];
  const endTok = parts[1]?.trim().split(/\s+/)[0];
  if (!startTok || !endTok) {
    return null;
  }
  const start = parseClock(startTok);
  const end = parseClock(endTok);
  if (start == null || end == null) {
    return null;
  }
  return { start, end };
}

export function parseClock(token: string): number | null {
  const cleaned = token.trim().replace(",", ".");
  const bits = cleaned.split(":");
  if (bits.length === 3) {
    const h = Number(bits[0]);
    const m = Number(bits[1]);
    const s = Number(bits[2]);
    if (![h, m, s].every((n) => Number.isFinite(n))) {
      return null;
    }
    return h * 3600 + m * 60 + s;
  }
  if (bits.length === 2) {
    const m = Number(bits[0]);
    const s = Number(bits[1]);
    if (![m, s].every((n) => Number.isFinite(n))) {
      return null;
    }
    return m * 60 + s;
  }
  return null;
}

const TAG_RE = /<\/?[^>]+>/g;

export function cleanCueText(raw: string): string {
  return decodeEntities(raw.replace(TAG_RE, " ").replace(/\s+/g, " ").trim());
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Group cues into ~60 s windows, then merge until ~350 tokens.
 * Each resulting segment keeps the window's start_s / end_s (spec §8).
 */
export function cuesToSegments(
  cues: CaptionCue[],
  locatorBase: Locator,
  headingPrefix?: string,
): ExtractedSegment[] {
  const windows = mergeCaptionWindows(groupCuesByDuration(cues, CAPTION_WINDOW_SECONDS));
  return windows.map((w) => {
    const where = `${formatTimestamp(w.start_s)}–${formatTimestamp(w.end_s)}`;
    return {
      text: w.text,
      locator: { ...locatorBase, start_s: w.start_s, end_s: w.end_s },
      headingPath: headingPrefix ? `${headingPrefix} > ${where}` : where,
    };
  });
}

export type CaptionWindow = {
  start_s: number;
  end_s: number;
  text: string;
};

export function groupCuesByDuration(cues: CaptionCue[], maxSpanS: number): CaptionWindow[] {
  const cleaned = cues.filter((c) => c.text.trim());
  const windows: CaptionWindow[] = [];
  let buf: CaptionCue[] = [];
  let origin = 0;
  const flush = () => {
    if (buf.length === 0) {
      return;
    }
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (!first || !last) {
      buf = [];
      return;
    }
    windows.push({
      start_s: first.start_s,
      end_s: last.end_s,
      text: buf.map((c) => c.text).join(" "),
    });
    buf = [];
  };
  for (const cue of cleaned) {
    if (buf.length === 0) {
      origin = cue.start_s;
      buf.push(cue);
      continue;
    }
    if (cue.start_s - origin >= maxSpanS) {
      flush();
      origin = cue.start_s;
      buf.push(cue);
      continue;
    }
    buf.push(cue);
  }
  flush();
  return windows;
}

export function mergeCaptionWindows(windows: CaptionWindow[]): CaptionWindow[] {
  const out: CaptionWindow[] = [];
  let cur: CaptionWindow | null = null;
  const maxWords = Math.max(1, Math.round(TARGET_TOKENS / WORD_TOKEN_FACTOR));
  for (const w of windows) {
    if (!cur) {
      cur = { ...w };
      continue;
    }
    const combined = `${cur.text} ${w.text}`.trim();
    if (
      estimateTokens(combined) <= TARGET_TOKENS &&
      combined.split(/\s+/).length <= maxWords + 20
    ) {
      cur = { start_s: cur.start_s, end_s: w.end_s, text: combined };
    } else {
      out.push(cur);
      cur = { ...w };
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

export function extractTranscript(
  content: string,
  fileUri: string,
  filePath: string,
  mimeHint?: string,
): ExtractedDocument {
  const cues = parseCaptionFile(content);
  const isSrt = mimeHint === MIME_SRT || looksLikeSrt(content);
  const title = basename(filePath);
  const locator: Locator = fileUri.startsWith("http") ? { url: fileUri } : { path: fileUri };
  const segments = cuesToSegments(cues, locator, title);
  return {
    title,
    mime: isSrt ? MIME_SRT : MIME_VTT,
    segments,
    meta: {
      duration_s: cues.length > 0 ? cues[cues.length - 1]?.end_s : 0,
      cue_count: cues.length,
    },
  };
}
