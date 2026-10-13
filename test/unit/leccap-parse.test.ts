import { describe, expect, it } from "vitest";
import { parseCaptionTime } from "../../src/ingest/lecture-capture/captions.js";
import {
  matchOcrToPdf,
  slideAtTime,
  textOverlap,
} from "../../src/ingest/lecture-capture/slides.js";
import {
  parseRecordingsList,
  parseSiteHtml,
  productFromJson,
} from "../../src/ingest/providers/leccap/client.js";
import {
  leccapPlayerDeepLink,
  parseLeccapUrl,
  playerUrl,
} from "../../src/ingest/providers/leccap/parse.js";
import { fixtureText } from "../helpers/fake-leccap.js";

describe("leccap URL parse", () => {
  it("parses site and player URLs, including legacy viewer paths", () => {
    const site = parseLeccapUrl("https://leccap.engin.umich.edu/leccap/site/testsitexxx");
    expect(site).toMatchObject({ kind: "site", siteId: "testsitexxx" });
    const rec = parseLeccapUrl("https://leccap.engin.umich.edu/leccap/player/r/abc123");
    expect(rec).toMatchObject({ kind: "recording", recordingId: "abc123" });
    const legacy = parseLeccapUrl("https://leccap.engin.umich.edu/leccap/viewer/r/abc123");
    expect(legacy?.recordingId).toBe("abc123");
    const series = parseLeccapUrl("https://leccap.engin.umich.edu/leccap/viewer/s/testsitexxx");
    expect(series?.siteId).toBe("testsitexxx");
    expect(parseLeccapUrl("https://example.com/leccap/site/x")).toBeNull();
  });

  it("emits a #t= deep link (player time param unverified live)", () => {
    const url = leccapPlayerDeepLink(playerUrl("abc123"), 1394);
    expect(url).toBe("https://leccap.engin.umich.edu/leccap/player/r/abc123#t=1394");
    expect(leccapPlayerDeepLink(playerUrl("abc123"), 0)).toBe(
      "https://leccap.engin.umich.edu/leccap/player/r/abc123",
    );
  });
});

describe("leccap product fixtures", () => {
  it("parses the documented product JSON shape", () => {
    const product = productFromJson(JSON.parse(fixtureText("product-lecture.json")), "abc123");
    expect(product.recordingId).toBe("abc123");
    expect(product.date).toBe("10/12/2026");
    expect(product.captions.length).toBeGreaterThan(3);
    expect(product.slides).toEqual([
      { slideIndex: 1, start_s: 0 },
      { slideIndex: 2, start_s: 30 },
      { slideIndex: 3, start_s: 90 },
      { slideIndex: 4, start_s: 180 },
    ]);
    expect(product.slideImageUrls[3]).toContain("testsitexxx");
    expect(product.slideImageUrls[3]).toContain("1000000000-000-O-test-slides/3.jpg");
    expect(product.auxSources[0]?.kind).toBe("whiteboard");
  });

  it("lists recordings from JSON and HTML", () => {
    const json = parseRecordingsList(fixtureText("site-recordings.json"), "testsitexxx");
    expect(json.map((r) => r.recordingId)).toEqual(["abc123", "def456"]);
    const html = parseSiteHtml(fixtureText("site.html"), "testsitexxx");
    expect(html.map((r) => r.recordingId)).toEqual(["abc123", "def456"]);
  });

  it("parses caption times as seconds, ms, or clocks", () => {
    expect(parseCaptionTime(12)).toBe(12);
    expect(parseCaptionTime(12_000)).toBe(12_000);
    expect(parseCaptionTime(120_000)).toBe(120);
    expect(parseCaptionTime("00:00:12.000")).toBe(12);
  });
});

describe("slide timeline + PDF match", () => {
  it("picks the slide on screen at a timestamp", () => {
    const slides = [
      { slideIndex: 1, start_s: 0 },
      { slideIndex: 2, start_s: 30 },
      { slideIndex: 3, start_s: 90 },
    ];
    expect(slideAtTime(slides, 0)?.slideIndex).toBe(1);
    expect(slideAtTime(slides, 29)?.slideIndex).toBe(1);
    expect(slideAtTime(slides, 30)?.slideIndex).toBe(2);
    expect(slideAtTime(slides, 200)?.slideIndex).toBe(3);
  });

  it("matches OCR text to an ingested PDF page", () => {
    const ocr =
      "Proof that a^n b^n is not regular. Assume for contradiction that L is regular. Let p be the pumping length.";
    const hit = matchOcrToPdf(ocr, [
      { title: "notes.pdf", page: 2, text: "Office hours and exam logistics." },
      {
        title: "lec07.pdf",
        page: 14,
        text: "Proof that a^n b^n is not regular. Assume for contradiction that L is regular. Let p be the pumping length. Choose s = a^p b^p.",
      },
    ]);
    expect(hit?.title).toBe("lec07.pdf");
    expect(hit?.page).toBe(14);
    expect(textOverlap(ocr, hit ? "pumping length regular" : "")).toBeGreaterThan(0);
  });
});
