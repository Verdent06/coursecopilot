import { type CaptionCue, decodeEntities, parseCaptionFile } from "../sources/vtt.js";

export type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: string;
};

export type PlayerCaptions = {
  videoId: string;
  title: string;
  duration_s?: number;
  playability: "ok" | "age_restricted" | "private" | "unavailable";
  playabilityReason?: string;
  tracks: CaptionTrack[];
};

/** Prefer English manual, then English auto, then any language (spec §9.4). */
export function selectCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) {
    return null;
  }
  const enManual = tracks.find((t) => isEnglish(t.languageCode) && !isAuto(t));
  if (enManual) {
    return enManual;
  }
  const enAuto = tracks.find((t) => isEnglish(t.languageCode) && isAuto(t));
  if (enAuto) {
    return enAuto;
  }
  const anyManual = tracks.find((t) => !isAuto(t));
  return anyManual ?? tracks[0] ?? null;
}

function isEnglish(code: string): boolean {
  const c = code.toLowerCase();
  return c === "en" || c.startsWith("en-") || c.startsWith("en_");
}

function isAuto(track: CaptionTrack): boolean {
  return track.kind === "asr" || /^a\./i.test(track.kind ?? "") || /auto/i.test(track.name ?? "");
}

export function parseTimedText(body: string): CaptionCue[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("{")) {
    return parseJson3(trimmed);
  }
  if (/<transcript[\s>]|<timedtext[\s>]|<text\s/i.test(trimmed)) {
    return parseYoutubeXml(trimmed);
  }
  return parseCaptionFile(trimmed);
}

function parseJson3(body: string): CaptionCue[] {
  try {
    const parsed = JSON.parse(body) as {
      events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
    };
    const cues: CaptionCue[] = [];
    for (const ev of parsed.events ?? []) {
      const startMs = ev.tStartMs ?? 0;
      const durMs = ev.dDurationMs ?? 0;
      const text = (ev.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!text) {
        continue;
      }
      cues.push({
        start_s: startMs / 1000,
        end_s: (startMs + durMs) / 1000,
        text: decodeEntities(text),
      });
    }
    return cues;
  } catch {
    return [];
  }
}

function parseYoutubeXml(body: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null = textRe.exec(body);
  while (m) {
    const attrs = m[1] ?? "";
    const inner = stripTags(decodeEntities(m[2] ?? ""));
    const start = Number(attr(attrs, "start") ?? "NaN");
    const dur = Number(attr(attrs, "dur") ?? "0");
    if (inner && Number.isFinite(start)) {
      cues.push({ start_s: start, end_s: start + (Number.isFinite(dur) ? dur : 0), text: inner });
    }
    m = textRe.exec(body);
  }
  if (cues.length > 0) {
    return cues;
  }
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let p = pRe.exec(body);
  while (p) {
    const attrs = p[1] ?? "";
    const inner = stripTags(decodeEntities(p[2] ?? ""));
    const t = Number(attr(attrs, "t") ?? "NaN");
    const d = Number(attr(attrs, "d") ?? "0");
    if (inner && Number.isFinite(t)) {
      cues.push({
        start_s: t / 1000,
        end_s: (t + (Number.isFinite(d) ? d : 0)) / 1000,
        text: inner,
      });
    }
    p = pRe.exec(body);
  }
  return cues;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attrs);
  return m?.[1];
}

function stripTags(text: string): string {
  return text
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractJsonAssignment(html: string, varName: string): unknown | null {
  const idx = html.indexOf(varName);
  if (idx < 0) {
    return null;
  }
  const eq = html.indexOf("{", idx);
  if (eq < 0) {
    return null;
  }
  const json = sliceBalancedObject(html, eq);
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function sliceBalancedObject(src: string, start: number): string | null {
  if (src[start] !== "{") {
    return null;
  }
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function playerFromObject(obj: unknown, fallbackId?: string): PlayerCaptions | null {
  if (!obj || typeof obj !== "object") {
    return null;
  }
  const rec = obj as Record<string, unknown>;
  const details = (rec.videoDetails ?? {}) as Record<string, unknown>;
  const videoId = String(details.videoId ?? fallbackId ?? "");
  const title = String(details.title ?? "");
  const duration = details.lengthSeconds != null ? Number(details.lengthSeconds) : undefined;
  const play = playabilityOf(rec);
  const tracks = captionTracksOf(rec);
  if (!videoId && tracks.length === 0 && play.status === "unavailable") {
    return null;
  }
  return {
    videoId: videoId || fallbackId || "",
    title: title || videoId || "YouTube video",
    duration_s: Number.isFinite(duration) ? duration : undefined,
    playability: play.status,
    playabilityReason: play.reason,
    tracks,
  };
}

function playabilityOf(rec: Record<string, unknown>): {
  status: PlayerCaptions["playability"];
  reason?: string;
} {
  const p = (rec.playabilityStatus ?? {}) as Record<string, unknown>;
  const status = String(p.status ?? "OK").toUpperCase();
  const reason = String(p.reason ?? p.messages ?? "");
  if (status === "OK") {
    return { status: "ok" };
  }
  const blob = `${status} ${reason}`.toLowerCase();
  if (blob.includes("age") || blob.includes("confirm your age")) {
    return { status: "age_restricted", reason: reason || status };
  }
  if (blob.includes("private") || status === "LOGIN_REQUIRED") {
    return {
      status: blob.includes("private") ? "private" : "unavailable",
      reason: reason || status,
    };
  }
  return { status: "unavailable", reason: reason || status };
}

function captionTracksOf(rec: Record<string, unknown>): CaptionTrack[] {
  const captions = rec.captions as Record<string, unknown> | undefined;
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
  const raw = renderer?.captionTracks;
  if (!Array.isArray(raw)) {
    return [];
  }
  const tracks: CaptionTrack[] = [];
  for (const item of raw) {
    const t = item as Record<string, unknown>;
    const nameObj = t.name as Record<string, unknown> | undefined;
    const baseUrl = String(t.baseUrl ?? "");
    const languageCode = String(t.languageCode ?? t.vssId ?? "");
    if (!baseUrl) {
      continue;
    }
    const track: CaptionTrack = { baseUrl, languageCode };
    if (t.kind != null) {
      track.kind = String(t.kind);
    }
    if (nameObj?.simpleText != null) {
      track.name = String(nameObj.simpleText);
    }
    tracks.push(track);
  }
  return tracks;
}

export function playerFromWatchHtml(html: string, fallbackId?: string): PlayerCaptions | null {
  const fromVar = extractJsonAssignment(html, "ytInitialPlayerResponse");
  const parsed = playerFromObject(fromVar, fallbackId);
  if (parsed && (parsed.tracks.length > 0 || parsed.title)) {
    return parsed;
  }
  const split = html.split('"captions":');
  if (split.length < 2) {
    return parsed;
  }
  const json = sliceBalancedObject(split[1] ?? "", (split[1] ?? "").indexOf("{"));
  if (!json) {
    return parsed;
  }
  try {
    const captions = JSON.parse(json) as Record<string, unknown>;
    const tracks = captionTracksOf({ captions });
    if (tracks.length === 0) {
      return parsed;
    }
    return {
      videoId: parsed?.videoId || fallbackId || "",
      title: parsed?.title || fallbackId || "YouTube video",
      duration_s: parsed?.duration_s,
      playability: parsed?.playability ?? "ok",
      playabilityReason: parsed?.playabilityReason,
      tracks,
    };
  } catch {
    return parsed;
  }
}

export function playlistVideoIdsFromHtml(html: string): Array<{ videoId: string; title?: string }> {
  const data = extractJsonAssignment(html, "ytInitialData");
  const fromJson = data ? collectPlaylistVideos(data) : [];
  if (fromJson.length > 0) {
    return uniqueVideos(fromJson);
  }
  return uniqueVideos(regexVideoIds(html));
}

function collectPlaylistVideos(node: unknown): Array<{ videoId: string; title?: string }> {
  const out: Array<{ videoId: string; title?: string }> = [];
  const walk = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    const rec = value as Record<string, unknown>;
    const renderer = rec.playlistVideoRenderer as Record<string, unknown> | undefined;
    if (renderer && typeof renderer.videoId === "string") {
      const titleObj = renderer.title as Record<string, unknown> | undefined;
      const runs = titleObj?.runs;
      const title =
        (Array.isArray(runs) && typeof (runs[0] as { text?: string })?.text === "string"
          ? (runs[0] as { text: string }).text
          : undefined) ??
        (typeof titleObj?.simpleText === "string" ? titleObj.simpleText : undefined);
      out.push({ videoId: renderer.videoId, title });
      return;
    }
    for (const child of Object.values(rec)) {
      walk(child);
    }
  };
  walk(node);
  return out;
}

function regexVideoIds(html: string): Array<{ videoId: string; title?: string }> {
  const out: Array<{ videoId: string }> = [];
  const re = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m = re.exec(html);
  while (m) {
    const id = m[1];
    if (id) {
      out.push({ videoId: id });
    }
    m = re.exec(html);
  }
  return out;
}

function uniqueVideos(
  items: Array<{ videoId: string; title?: string }>,
): Array<{ videoId: string; title?: string }> {
  const seen = new Set<string>();
  const out: Array<{ videoId: string; title?: string }> = [];
  for (const item of items) {
    if (seen.has(item.videoId)) {
      continue;
    }
    seen.add(item.videoId);
    out.push(item);
  }
  return out;
}

export function withJson3Format(trackUrl: string): string {
  try {
    const u = new URL(trackUrl);
    if (!u.searchParams.has("fmt")) {
      u.searchParams.set("fmt", "json3");
    }
    return u.toString();
  } catch {
    const join = trackUrl.includes("?") ? "&" : "?";
    return `${trackUrl}${join}fmt=json3`;
  }
}
