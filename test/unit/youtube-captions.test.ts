import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseTimedText,
  playerFromObject,
  playerFromWatchHtml,
  playlistVideoIdsFromHtml,
  selectCaptionTrack,
} from "../../src/ingest/youtube/captions.js";
import {
  parseYtDlpJson,
  playlistEntriesFromYtDlp,
  videoDumpFromYtDlp,
} from "../../src/ingest/youtube/ytdlp.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/youtube");

describe("YouTube caption adapter (recorded fixtures)", () => {
  it("prefers English manual over English auto over any language", () => {
    const html = readFileSync(join(dir, "watch.html"), "utf8");
    const player = playerFromWatchHtml(html, "abcdefghijk");
    expect(player?.title).toMatch(/Lecture 1/);
    const picked = selectCaptionTrack(player?.tracks ?? []);
    expect(picked?.languageCode).toBe("en");
    expect(picked?.kind).toBeUndefined();
    expect(picked?.baseUrl).not.toContain("kind=asr");
  });

  it("parses Innertube player JSON and timedtext XML / json3", () => {
    const json = JSON.parse(readFileSync(join(dir, "player.json"), "utf8")) as unknown;
    const player = playerFromObject(json, "abcdefghijk");
    expect(player?.tracks.length).toBe(2);
    expect(selectCaptionTrack(player?.tracks ?? [])?.languageCode).toBe("en");

    const xml = parseTimedText(readFileSync(join(dir, "captions.xml"), "utf8"));
    expect(xml[1]?.text).toMatch(/pumping lemma/);
    expect(xml[1]?.start_s).toBe(4.5);

    const j3 = parseTimedText(readFileSync(join(dir, "captions.json3"), "utf8"));
    expect(j3[0]?.text).toMatch(/automata theory/);
    expect(j3[1]?.text).toMatch(/pumping lemma/);
  });

  it("extracts playlist video ids from recorded HTML", () => {
    const html = readFileSync(join(dir, "playlist.html"), "utf8");
    const ids = playlistVideoIdsFromHtml(html);
    expect(ids.map((v) => v.videoId)).toEqual(["abcdefghijk", "bcdefghijkl", "cdefghijklm"]);
    expect(ids[0]?.title).toMatch(/Lecture 1/);
  });

  it("parses yt-dlp -J dumps for a video and a playlist", () => {
    const video = parseYtDlpJson(readFileSync(join(dir, "ytdlp-video.json"), "utf8"));
    const dump = videoDumpFromYtDlp(video, "abcdefghijk");
    expect(dump?.info.title).toMatch(/yt-dlp/);
    expect(selectCaptionTrack(dump?.info.tracks ?? [])?.kind).toBeUndefined();

    const playlist = parseYtDlpJson(readFileSync(join(dir, "ytdlp-playlist.json"), "utf8"));
    const entries = playlistEntriesFromYtDlp(playlist);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.videoId).toBe("bcdefghijkl");
  });
});
