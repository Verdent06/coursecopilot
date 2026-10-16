import { RepoError } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { crawlUserAgent } from "../ingest/crawl/ua.js";
import { assertPublicUrl } from "../util/ssrf.js";

const MAX_ICS_BYTES = 2 * 1024 * 1024;

export type IcsEvent = {
  summary: string;
  course: string;
  dueAt: string | null;
  url: string;
  uid: string;
};

/**
 * Canvas Calendar → Calendar Feed ICS. Schools that block personal tokens still
 * expose this URL; it is enough for due dates across every course.
 */
export function parseIcsCalendar(text: string): IcsEvent[] {
  const unfolded = unfoldIcs(text);
  const events: IcsEvent[] = [];
  let block: string[] = [];
  let inEvent = false;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      block = [];
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      const parsed = eventFromBlock(block);
      if (parsed) {
        events.push(parsed);
      }
      block = [];
      continue;
    }
    if (inEvent) {
      block.push(line);
    }
  }
  return events;
}

export function normalizeCanvasIcsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste the Canvas calendar feed URL (Calendar → Calendar Feed).");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid calendar feed URL. Copy it from Canvas → Calendar → Calendar Feed.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Calendar feed URL must be http(s).");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Calendar feed URL must not include a username or password.");
  }
  return parsed.href;
}

export async function fetchCanvasIcs(
  icsUrl: string,
  fetchFn: FetchLike = fetch,
  opts: { allowPrivateNetwork?: boolean } = {},
): Promise<string> {
  const url = normalizeCanvasIcsUrl(icsUrl);
  if (!opts.allowPrivateNetwork) {
    try {
      assertPublicUrl(url);
    } catch (err) {
      const message = err instanceof RepoError ? err.message : String(err);
      throw new Error(message);
    }
  }
  const res = await fetchFn(url, {
    headers: {
      Accept: "text/calendar, text/plain, */*",
      "User-Agent": crawlUserAgent(),
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Calendar feed returned HTTP ${res.status}. Check that you copied the full ICS URL from Calendar → Calendar Feed.`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_ICS_BYTES) {
    throw new Error("Calendar feed is larger than 2 MB.");
  }
  const text = new TextDecoder("utf-8").decode(buf);
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(
      "That URL did not return an iCalendar feed. In Canvas: Calendar → Calendar Feed (bottom right), copy the URL.",
    );
  }
  return text;
}

export async function fetchAndParseCanvasIcs(
  icsUrl: string,
  fetchFn: FetchLike = fetch,
  opts: { allowPrivateNetwork?: boolean } = {},
): Promise<IcsEvent[]> {
  const text = await fetchCanvasIcs(icsUrl, fetchFn, opts);
  return parseIcsCalendar(text);
}

function unfoldIcs(text: string): string[] {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function eventFromBlock(lines: string[]): IcsEvent | null {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const meta = line.slice(0, colon);
    const value = unescapeIcs(line.slice(colon + 1));
    const name = meta.split(";")[0]?.toUpperCase();
    if (name) {
      fields.set(name, value);
      if (name === "DTSTART") {
        fields.set("DTSTART_RAW", line);
      }
    }
  }
  const summaryRaw = fields.get("SUMMARY")?.trim();
  if (!summaryRaw) {
    return null;
  }
  const { name, course } = splitSummary(summaryRaw);
  const dueAt = parseIcsDate(fields.get("DTSTART_RAW") ?? fields.get("DTSTART") ?? "");
  return {
    summary: name,
    course,
    dueAt,
    url: fields.get("URL")?.trim() ?? "",
    uid: fields.get("UID")?.trim() ?? "",
  };
}

/** Canvas titles look like `Homework 3 [EECS 376]`. */
export function splitSummary(summary: string): { name: string; course: string } {
  const match = /^(.*)\[([^\]]+)\]\s*$/.exec(summary);
  if (match?.[1] && match[2]) {
    return { name: match[1].trim(), course: match[2].trim() };
  }
  return { name: summary.trim(), course: "Canvas" };
}

export function parseIcsDate(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const colon = raw.indexOf(":");
  const value = (colon === -1 ? raw : raw.slice(colon + 1)).trim();
  const params = colon === -1 ? "" : raw.slice(0, colon);
  if (/VALUE=DATE/i.test(params) && /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return `${y}-${m}-${d}T23:59:00.000Z`;
  }
  const zulu = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (zulu) {
    return `${zulu[1]}-${zulu[2]}-${zulu[3]}T${zulu[4]}:${zulu[5]}:${zulu[6]}.000Z`;
  }
  const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (local) {
    const iso = `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6]}`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : `${iso}.000Z`;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
