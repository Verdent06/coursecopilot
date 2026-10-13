import { spawn } from "node:child_process";
import { YOUTUBE_PLAYLIST_CAP } from "../config.js";
import type { CaptionCue } from "../sources/vtt.js";
import type { CaptionTrack, PlayerCaptions } from "./captions.js";
import { parseTimedText } from "./captions.js";
import { watchUrl } from "./parse.js";

export type YtDlpRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type YtDlpRunner = (args: string[], timeoutMs?: number) => Promise<YtDlpRunResult>;

export type YtDlpVideoDump = {
  info: PlayerCaptions;
};

const DEFAULT_TIMEOUT_MS = 90_000;

export async function runYtDlp(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<YtDlpRunResult> {
  const bin = process.env.COURSECOPILOT_YTDLP?.trim() || "yt-dlp";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
      });
    });
  });
}

export function isYtDlpMissing(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export function parseYtDlpJson(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function videoDumpFromYtDlp(json: unknown, videoId: string): YtDlpVideoDump | null {
  if (!json || typeof json !== "object") {
    return null;
  }
  const rec = json as Record<string, unknown>;
  if (rec._type === "playlist" && Array.isArray(rec.entries)) {
    return null;
  }
  const id = String(rec.id ?? rec.display_id ?? videoId);
  const title = String(rec.title ?? id);
  const duration = rec.duration != null ? Number(rec.duration) : undefined;
  const tracks = subtitleTracksOf(rec);
  return {
    info: {
      videoId: id,
      title,
      duration_s: Number.isFinite(duration) ? duration : undefined,
      playability: "ok",
      tracks,
    },
  };
}

export function playlistEntriesFromYtDlp(
  json: unknown,
): Array<{ videoId: string; title?: string }> {
  if (!json || typeof json !== "object") {
    return [];
  }
  const rec = json as Record<string, unknown>;
  const entries = Array.isArray(rec.entries) ? rec.entries : [];
  const out: Array<{ videoId: string; title?: string }> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const id = String(e.id ?? e.display_id ?? "");
    if (!id) {
      continue;
    }
    out.push({ videoId: id, title: e.title != null ? String(e.title) : undefined });
  }
  return out.slice(0, YOUTUBE_PLAYLIST_CAP);
}

function subtitleTracksOf(rec: Record<string, unknown>): CaptionTrack[] {
  const tracks: CaptionTrack[] = [];
  const add = (bag: Record<string, unknown> | undefined, automatic: boolean) => {
    if (!bag) {
      return;
    }
    for (const [lang, list] of Object.entries(bag)) {
      if (!Array.isArray(list)) {
        continue;
      }
      const url = pickExt(list as Array<Record<string, unknown>>);
      if (!url) {
        continue;
      }
      tracks.push({
        baseUrl: url,
        languageCode: lang,
        kind: automatic ? "asr" : undefined,
        name: automatic ? `${lang} (auto-generated)` : lang,
      });
    }
  };
  add(rec.subtitles as Record<string, unknown> | undefined, false);
  add(rec.automatic_captions as Record<string, unknown> | undefined, true);
  return tracks;
}

function pickExt(list: Array<Record<string, unknown>>): string | null {
  const order = ["json3", "srv3", "srv1", "vtt", "ttml", "srt"];
  for (const ext of order) {
    const hit = list.find((item) => String(item.ext ?? "") === ext && typeof item.url === "string");
    if (hit && typeof hit.url === "string") {
      return hit.url;
    }
  }
  const any = list.find((item) => typeof item.url === "string");
  return any && typeof any.url === "string" ? any.url : null;
}

export function cuesFromYtDlpCaptionBody(body: string): CaptionCue[] {
  return parseTimedText(body);
}

export function ytdlpVideoArgs(videoId: string): string[] {
  return [
    "-J",
    "--skip-download",
    "--no-warnings",
    "--no-progress",
    "--no-playlist",
    watchUrl(videoId),
  ];
}

export function ytdlpPlaylistArgs(playlistId: string): string[] {
  return [
    "-J",
    "--flat-playlist",
    "--skip-download",
    "--no-warnings",
    "--no-progress",
    "--playlist-end",
    String(YOUTUBE_PLAYLIST_CAP),
    `https://www.youtube.com/playlist?list=${playlistId}`,
  ];
}
