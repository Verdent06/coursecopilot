import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import { NO_CAPTIONS_FALLBACK, YOUTUBE_PLAYLIST_CAP } from "../config.js";
import { sha256 } from "../hash.js";
import { lectureNoFromConfig, persistExtractedDocument } from "../persist.js";
import type { ExtractedDocument, IngestResult, SkipReason } from "../types.js";
import { selectCaptionTrack } from "../youtube/captions.js";
import { createYoutubeClient, type YoutubeClient } from "../youtube/client.js";
import { parseYoutubeUrl, watchUrl } from "../youtube/parse.js";
import type { ProgressFn } from "./file.js";
import { cuesToSegments } from "./vtt.js";

export type YoutubeIngestContext = {
  repo: CourseRepo;
  youtube?: YoutubeClient;
};

export async function ingestYoutubeSource(
  ctx: YoutubeIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }
  if (source.kind !== "youtube") {
    throw new RepoError(`ingestYoutubeSource cannot handle kind "${source.kind}"`);
  }

  const parsed = parseYoutubeUrl(source.uri);
  if (!parsed) {
    throw new RepoError(
      `Not a YouTube video or playlist URL: "${source.uri}". Use watch, youtu.be, shorts, embed, or playlist?list=...`,
    );
  }

  const client = ctx.youtube ?? createYoutubeClient();
  const lectureNo = lectureNoFromConfig(source.config_json);
  const skipped: SkipReason[] = [];
  let videos: Array<{ videoId: string; title?: string }> = [];

  if (parsed.type === "playlist") {
    onProgress(0.05, `Expanding playlist ${parsed.playlistId}`, skipped);
    const entries = await client.fetchPlaylist(parsed.playlistId);
    if (entries.length === 0) {
      skipped.push({
        url: `https://www.youtube.com/playlist?list=${parsed.playlistId}`,
        reason:
          "Could not expand playlist (private, empty, or YouTube HTML changed). If yt-dlp is on PATH it will be tried automatically. Otherwise add individual video URLs.",
      });
      return { docs: 0, chunks: 0, skipped, errors: 1 };
    }
    if (entries.length > YOUTUBE_PLAYLIST_CAP) {
      skipped.push({
        url: `https://www.youtube.com/playlist?list=${parsed.playlistId}`,
        reason: `playlist truncated at ${YOUTUBE_PLAYLIST_CAP} videos`,
      });
    }
    videos = entries.slice(0, YOUTUBE_PLAYLIST_CAP);
  } else {
    videos = [{ videoId: parsed.videoId }];
  }

  let docs = 0;
  let chunks = 0;
  let errors = 0;

  for (let i = 0; i < videos.length; i++) {
    const item = videos[i];
    if (!item) {
      continue;
    }
    const url = watchUrl(item.videoId);
    onProgress((i + 1) / (videos.length + 1), `Fetching captions for ${item.videoId}`, skipped);
    try {
      const extracted = await extractYoutubeVideo(client, item.videoId, item.title);
      if ("skip" in extracted) {
        skipped.push({ url, reason: extracted.skip });
        if (extracted.error) {
          errors += 1;
        }
        continue;
      }
      if (lectureNo != null) {
        extracted.meta.lecture_no = lectureNo;
      }
      const hash = sha256(extracted.segments.map((s) => s.text).join("\n"));
      const n = persistExtractedDocument(ctx.repo, {
        sourceId,
        courseId: source.course_id,
        url,
        extracted,
        contentHash: hash,
        lectureNo,
      });
      docs += 1;
      chunks += n;
    } catch (err) {
      errors += 1;
      skipped.push({ url, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (docs > 0 && videos[0]?.title) {
    ctx.repo.updateSource(sourceId, { title: videos[0].title });
  }

  onProgress(1, `Indexed ${docs} video(s), ${chunks} chunk(s)`, skipped);
  return { docs, chunks, skipped, errors };
}

export async function extractYoutubeVideo(
  client: YoutubeClient,
  videoId: string,
  hintTitle?: string,
): Promise<ExtractedDocument | { skip: string; error?: boolean }> {
  const info = await client.fetchVideo(videoId);
  const title = hintTitle || info.title || videoId;
  if (info.playability === "private") {
    return {
      skip: `Video is private or requires login. ${NO_CAPTIONS_FALLBACK}`,
      error: true,
    };
  }
  if (info.playability === "age_restricted") {
    return {
      skip: `Age-restricted video; captions cannot be fetched without login. ${NO_CAPTIONS_FALLBACK}`,
      error: true,
    };
  }

  const track = selectCaptionTrack(info.tracks);
  if (!track) {
    const extra =
      info.playability === "unavailable" && info.playabilityReason
        ? ` (${info.playabilityReason})`
        : "";
    return { skip: `${NO_CAPTIONS_FALLBACK}${extra}`, error: true };
  }

  const cues = await client.fetchCaptionCues(track);
  if (cues.length === 0) {
    return { skip: NO_CAPTIONS_FALLBACK, error: true };
  }

  const url = watchUrl(videoId);
  const segments = cuesToSegments(cues, { url, video_id: videoId, title }, title);
  return {
    title,
    mime: "text/vtt",
    segments,
    meta: {
      duration_s: info.duration_s ?? cues[cues.length - 1]?.end_s,
      lang: track.languageCode,
      caption_kind: track.kind === "asr" ? "auto" : "manual",
      video_id: videoId,
    },
  };
}
