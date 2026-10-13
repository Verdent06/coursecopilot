import { type CaptionCue, parseCaptionFile } from "../sources/vtt.js";
import type { LectureCaption } from "./types.js";

/** Convert provider captions (seconds or clock strings) into CaptionCue[]. */
export function lectureCaptionsToCues(captions: LectureCaption[]): CaptionCue[] {
  return captions
    .map((c) => ({
      start_s: c.start_s,
      end_s: Math.max(c.end_s, c.start_s),
      text: c.text.trim(),
    }))
    .filter((c) => c.text.length > 0);
}

export function webvttToCaptions(vtt: string): LectureCaption[] {
  return parseCaptionFile(vtt).map((c) => ({
    text: c.text,
    start_s: c.start_s,
    end_s: c.end_s,
  }));
}

/**
 * Product `intime`/`outtime` may be seconds, milliseconds, or a clock string.
 * A 3-hour lecture is ~10_800s; values above 20_000 are treated as milliseconds
 * (20s of audio would be 20_000ms; a 5.5h lecture in seconds is still below).
 */
export function parseCaptionTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 20_000 ? value / 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseCaptionTime(Number(trimmed));
    }
    const clock = parseClock(trimmed);
    if (clock != null) {
      return clock;
    }
  }
  return null;
}

function parseClock(token: string): number | null {
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
