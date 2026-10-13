import { log } from "../../util/log.js";
import { VERSION } from "../../version.js";
import type { CaptionCue } from "../sources/vtt.js";
import {
  type CaptionTrack,
  type PlayerCaptions,
  parseTimedText,
  playerFromObject,
  playerFromWatchHtml,
  playlistVideoIdsFromHtml,
  selectCaptionTrack,
  withJson3Format,
} from "./captions.js";
import { watchUrl } from "./parse.js";
import {
  isYtDlpMissing,
  parseYtDlpJson,
  playlistEntriesFromYtDlp,
  runYtDlp,
  videoDumpFromYtDlp,
  type YtDlpRunner,
  ytdlpPlaylistArgs,
  ytdlpVideoArgs,
} from "./ytdlp.js";

export type YoutubeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type YoutubeClient = {
  fetchVideo(videoId: string): Promise<PlayerCaptions>;
  fetchCaptionCues(track: CaptionTrack): Promise<CaptionCue[]>;
  fetchPlaylist(playlistId: string): Promise<Array<{ videoId: string; title?: string }>>;
  fetchOEmbedTitle(videoId: string): Promise<string | null>;
};

export type YoutubeClientOptions = {
  fetch?: YoutubeFetch;
  runYtDlp?: YtDlpRunner;
  /** Skip yt-dlp (unit tests). Default: try yt-dlp when HTML/Innertube fail. */
  disableYtDlp?: boolean;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 CourseCopilot/" +
  VERSION +
  " (+https://github.com/Verdent06/coursecopilot)";

const INNERTUBE_PLAYER = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

export function createYoutubeClient(opts: YoutubeClientOptions = {}): YoutubeClient {
  const fetchImpl = opts.fetch ?? defaultFetch;
  const ytdlp = opts.runYtDlp ?? runYtDlp;
  const disableYtDlp = opts.disableYtDlp ?? false;

  async function fetchVideo(videoId: string): Promise<PlayerCaptions> {
    const fromInner = await tryInnertube(fetchImpl, videoId);
    if (fromInner && (fromInner.tracks.length > 0 || fromInner.playability !== "ok")) {
      return maybeYtDlpVideo(fromInner, videoId);
    }
    const fromHtml = await tryWatchHtml(fetchImpl, videoId);
    const merged = mergePlayer(fromInner, fromHtml);
    return maybeYtDlpVideo(merged, videoId);
  }

  async function maybeYtDlpVideo(
    info: PlayerCaptions | null,
    videoId: string,
  ): Promise<PlayerCaptions> {
    if (info && info.tracks.length > 0) {
      if (!info.title || info.title === videoId) {
        const oembed = await fetchOEmbedTitle(videoId);
        if (oembed) {
          return { ...info, title: oembed };
        }
      }
      return info;
    }
    if (info && info.playability !== "ok") {
      return info;
    }
    if (disableYtDlp) {
      return (
        info ?? {
          videoId,
          title: videoId,
          playability: "unavailable",
          tracks: [],
        }
      );
    }
    const dumped = await tryYtDlpVideo(ytdlp, videoId);
    if (dumped) {
      return dumped;
    }
    return (
      info ?? {
        videoId,
        title: videoId,
        playability: "unavailable",
        playabilityReason: "Could not load the YouTube player response",
        tracks: [],
      }
    );
  }

  async function fetchCaptionCues(track: CaptionTrack): Promise<CaptionCue[]> {
    const urls = [withJson3Format(track.baseUrl), track.baseUrl];
    for (const url of urls) {
      try {
        const body = await fetchText(fetchImpl, url);
        const cues = parseTimedText(body);
        if (cues.length > 0) {
          return cues;
        }
      } catch (err) {
        log.warn("caption fetch failed", url, err);
      }
    }
    return [];
  }

  async function fetchPlaylist(
    playlistId: string,
  ): Promise<Array<{ videoId: string; title?: string }>> {
    try {
      const html = await fetchText(
        fetchImpl,
        `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      );
      const ids = playlistVideoIdsFromHtml(html);
      if (ids.length > 0) {
        return ids;
      }
    } catch (err) {
      log.warn("playlist HTML fetch failed", playlistId, err);
    }
    if (disableYtDlp) {
      return [];
    }
    return tryYtDlpPlaylist(ytdlp, playlistId);
  }

  async function fetchOEmbedTitle(videoId: string): Promise<string | null> {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    try {
      const body = await fetchText(fetchImpl, url);
      const parsed = JSON.parse(body) as { title?: unknown };
      return typeof parsed.title === "string" ? parsed.title : null;
    } catch {
      return null;
    }
  }

  return { fetchVideo, fetchCaptionCues, fetchPlaylist, fetchOEmbedTitle };
}

async function tryInnertube(
  fetchImpl: YoutubeFetch,
  videoId: string,
): Promise<PlayerCaptions | null> {
  try {
    const res = await fetchImpl(INNERTUBE_PLAYER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.10.39",
            hl: "en",
            gl: "US",
          },
        },
        videoId,
      }),
    });
    if (!res.ok) {
      return null;
    }
    const json: unknown = await res.json();
    return playerFromObject(json, videoId);
  } catch (err) {
    log.warn("innertube player failed", videoId, err);
    return null;
  }
}

async function tryWatchHtml(
  fetchImpl: YoutubeFetch,
  videoId: string,
): Promise<PlayerCaptions | null> {
  try {
    const html = await fetchText(fetchImpl, watchUrl(videoId));
    return playerFromWatchHtml(html, videoId);
  } catch (err) {
    log.warn("watch HTML fetch failed", videoId, err);
    return null;
  }
}

function mergePlayer(a: PlayerCaptions | null, b: PlayerCaptions | null): PlayerCaptions | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return {
    videoId: a.videoId || b.videoId,
    title: a.title && a.title !== a.videoId ? a.title : b.title,
    duration_s: a.duration_s ?? b.duration_s,
    playability: a.playability === "ok" ? a.playability : b.playability,
    playabilityReason: a.playabilityReason ?? b.playabilityReason,
    tracks: a.tracks.length > 0 ? a.tracks : b.tracks,
  };
}

async function tryYtDlpVideo(runner: YtDlpRunner, videoId: string): Promise<PlayerCaptions | null> {
  try {
    const result = await runner(ytdlpVideoArgs(videoId));
    if (result.code !== 0) {
      log.warn("yt-dlp video dump failed", result.stderr.slice(0, 400));
      return null;
    }
    const json = parseYtDlpJson(result.stdout);
    return videoDumpFromYtDlp(json, videoId)?.info ?? null;
  } catch (err) {
    if (!isYtDlpMissing(err)) {
      log.warn("yt-dlp fallback failed", err);
    }
    return null;
  }
}

async function tryYtDlpPlaylist(
  runner: YtDlpRunner,
  playlistId: string,
): Promise<Array<{ videoId: string; title?: string }>> {
  try {
    const result = await runner(ytdlpPlaylistArgs(playlistId));
    if (result.code !== 0) {
      log.warn("yt-dlp playlist dump failed", result.stderr.slice(0, 400));
      return [];
    }
    const json = parseYtDlpJson(result.stdout);
    return playlistEntriesFromYtDlp(json);
  } catch (err) {
    if (!isYtDlpMissing(err)) {
      log.warn("yt-dlp playlist fallback failed", err);
    }
    return [];
  }
}

async function fetchText(fetchImpl: YoutubeFetch, url: string): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export { selectCaptionTrack };
