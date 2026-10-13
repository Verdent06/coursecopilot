import { describe, expect, it } from "vitest";
import { extractVideoId, parseYoutubeUrl, youtuBeUrl } from "../../src/ingest/youtube/parse.js";

describe("YouTube URL parse", () => {
  it("parses watch, youtu.be, shorts, embed, live, and bare ids", () => {
    const id = "dQw4w9WgXcQ";
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?v=${id}`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(`https://youtu.be/${id}`)).toEqual({ type: "video", videoId: id });
    expect(parseYoutubeUrl(`https://www.youtube.com/shorts/${id}`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(`https://www.youtube.com/embed/${id}`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(`https://www.youtube.com/live/${id}`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(`https://m.youtube.com/watch?v=${id}&t=12s`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(`https://music.youtube.com/watch?v=${id}`)).toEqual({
      type: "video",
      videoId: id,
    });
    expect(parseYoutubeUrl(id)).toEqual({ type: "video", videoId: id });
    expect(parseYoutubeUrl(`youtube.com/watch?v=${id}`)).toEqual({ type: "video", videoId: id });
  });

  it("parses playlist URLs and keeps watch+list as a single video", () => {
    const list = "PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab";
    expect(parseYoutubeUrl(`https://www.youtube.com/playlist?list=${list}`)).toEqual({
      type: "playlist",
      playlistId: list,
    });
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?v=abcdefghijk&list=${list}`)).toEqual({
      type: "video",
      videoId: "abcdefghijk",
      playlistId: list,
    });
    expect(parseYoutubeUrl(`https://www.youtube.com/watch?list=${list}`)).toEqual({
      type: "playlist",
      playlistId: list,
    });
  });

  it("rejects non-YouTube URLs", () => {
    expect(parseYoutubeUrl("https://vimeo.com/123")).toBeNull();
    expect(parseYoutubeUrl("https://example.com")).toBeNull();
    expect(parseYoutubeUrl("not a url")).toBeNull();
    expect(extractVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(youtuBeUrl("abcdefghijk", 125)).toBe("https://youtu.be/abcdefghijk?t=125s");
  });
});
