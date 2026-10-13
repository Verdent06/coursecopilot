import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cuesToSegments,
  groupCuesByDuration,
  mergeCaptionWindows,
  parseCaptionFile,
  parseClock,
  parseSrt,
  parseVtt,
} from "../../src/ingest/sources/vtt.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("VTT / SRT parser", () => {
  it("parses WebVTT cues and timestamps", () => {
    const cues = parseVtt(readFileSync(join(fixtures, "sample.vtt"), "utf8"));
    expect(cues.length).toBeGreaterThanOrEqual(6);
    expect(cues[0]?.start_s).toBe(0);
    expect(cues[1]?.text).toMatch(/pumping lemma/i);
    expect(cues.some((c) => c.start_s >= 65)).toBe(true);
  });

  it("parses SubRip with comma milliseconds", () => {
    const cues = parseSrt(readFileSync(join(fixtures, "sample.srt"), "utf8"));
    expect(cues).toHaveLength(3);
    expect(cues[0]?.text).toMatch(/deterministic finite automata/i);
    expect(cues[2]?.start_s).toBe(60);
  });

  it("auto-detects SRT vs VTT", () => {
    const srt = parseCaptionFile(readFileSync(join(fixtures, "sample.srt"), "utf8"));
    const vtt = parseCaptionFile(readFileSync(join(fixtures, "sample.vtt"), "utf8"));
    expect(srt[0]?.text).toMatch(/SubRip/);
    expect(vtt[0]?.text).toMatch(/automata theory/);
  });

  it("parses clocks with hours", () => {
    expect(parseClock("01:02:03.500")).toBe(3723.5);
    expect(parseClock("1:02:03,500")).toBe(3723.5);
    expect(parseClock("02:03.000")).toBe(123);
  });

  it("strips VTT tags and groups ~60s windows then merges to ~350 tokens", () => {
    const tagged = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<c>Hello</c> <b>world</b>\n";
    expect(parseVtt(tagged)[0]?.text).toBe("Hello world");

    const cues = Array.from({ length: 90 }, (_, i) => ({
      start_s: i,
      end_s: i + 0.8,
      text: `cue${i} word extra padding for tokens`,
    }));
    const grouped = groupCuesByDuration(cues, 60);
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    expect(grouped[0]?.end_s).toBeLessThan(60);

    const many = Array.from({ length: 8 }, (_, i) => ({
      start_s: i * 60,
      end_s: i * 60 + 50,
      text: Array.from({ length: 40 }, () => `tok${i}`).join(" "),
    }));
    const merged = mergeCaptionWindows(many);
    expect(merged.length).toBeGreaterThan(1);
    expect(merged[0]?.start_s).toBe(0);
    expect(merged[0]?.end_s).toBeGreaterThan(50);

    const segs = cuesToSegments(cues.slice(0, 5), { url: "https://youtu.be/abcdefghijk" }, "Lec");
    expect(segs[0]?.locator.start_s).toBe(0);
    expect(segs[0]?.headingPath).toContain("Lec");
  });
});
