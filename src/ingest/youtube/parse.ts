/** Parse YouTube watch / youtu.be / shorts / embed / live / playlist URLs. */

export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const YOUTUBE_PLAYLIST_ID = /^[A-Za-z0-9_-]{10,}$/;

export type YoutubeRef =
  | { type: "video"; videoId: string; playlistId?: string }
  | { type: "playlist"; playlistId: string };

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtuBeUrl(videoId: string, startS?: number | null): string {
  const t = startS != null ? Math.floor(startS) : null;
  return t != null ? `https://youtu.be/${videoId}?t=${t}s` : `https://youtu.be/${videoId}`;
}

/** Accept a bare 11-char id, a missing-scheme youtube host, or a full URL. */
export function normalizeYoutubeInput(input: string): string {
  const raw = input.trim();
  if (!raw) {
    return raw;
  }
  if (YOUTUBE_VIDEO_ID.test(raw)) {
    return watchUrl(raw);
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com|youtube-nocookie\.com)\b/i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

export function parseYoutubeUrl(input: string): YoutubeRef | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  if (YOUTUBE_VIDEO_ID.test(raw)) {
    return { type: "video", videoId: raw };
  }

  let url: URL;
  try {
    url = new URL(normalizeYoutubeInput(raw));
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) {
    return null;
  }

  const list = url.searchParams.get("list")?.trim() || undefined;
  const vParam = url.searchParams.get("v")?.trim() || undefined;
  const pathParts = url.pathname.split("/").filter(Boolean);
  const first = pathParts[0]?.toLowerCase();

  if (first === "playlist") {
    if (list && YOUTUBE_PLAYLIST_ID.test(list)) {
      return { type: "playlist", playlistId: list };
    }
    return null;
  }

  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = pathParts[0];
    if (id && YOUTUBE_VIDEO_ID.test(id)) {
      return list
        ? { type: "video", videoId: id, playlistId: list }
        : { type: "video", videoId: id };
    }
    return null;
  }

  if (first && ["embed", "shorts", "live", "v", "e"].includes(first)) {
    const id = pathParts[1]?.split("&")[0];
    if (id && YOUTUBE_VIDEO_ID.test(id)) {
      return list
        ? { type: "video", videoId: id, playlistId: list }
        : { type: "video", videoId: id };
    }
    return null;
  }

  if (vParam && YOUTUBE_VIDEO_ID.test(vParam)) {
    return list
      ? { type: "video", videoId: vParam, playlistId: list }
      : { type: "video", videoId: vParam };
  }

  // /watch?list=PL... without v= is a playlist share link.
  if (first === "watch" && list && YOUTUBE_PLAYLIST_ID.test(list)) {
    return { type: "playlist", playlistId: list };
  }

  return null;
}

export function extractVideoId(url: string): string | null {
  const parsed = parseYoutubeUrl(url);
  return parsed?.type === "video" ? parsed.videoId : null;
}
