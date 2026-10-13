/** Chunking and file-ingest knobs (spec §8, §9.3, §9.4). */

/** Target size of a chunk in approximate tokens. */
export const TARGET_TOKENS = 350;

/** Overlap between adjacent chunks of the same segment, in approximate tokens. */
export const OVERLAP_TOKENS = 50;

/** tokens ≈ words × this factor (spec §8). */
export const WORD_TOKEN_FACTOR = 1.3;

/** Skip a single file larger than this (50 MB, same cap as the website pipeline). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Recurse folders up to this many files (spec §9.3). */
export const FOLDER_FILE_CAP = 2000;

/** A PDF is flagged needs_ocr when most pages have fewer than this many characters. */
export const OCR_CHAR_THRESHOLD = 20;

/** Topic-name cosine for heuristic dedupe (spec §9.6). */
export const TOPIC_DEDUP_COSINE = 0.85;

/** Assign leftover chunks to nearest topic centroid above this cosine. */
export const TOPIC_ASSIGN_COSINE = 0.4;

/** Caption cues are grouped into ~60 s windows before token merging (spec §8, §9.4). */
export const CAPTION_WINDOW_SECONDS = 60;

/** Expand a YouTube playlist to at most this many videos (spec §9.4). */
export const YOUTUBE_PLAYLIST_CAP = 50;

/** Shown when a video has no caption track (spec §9.4 / §9.5). */
export const NO_CAPTIONS_FALLBACK =
  "No captions available. Export a .vtt/.srt from Canvas, Kaltura, or Panopto and add it with kind=transcript, or wait for v1.1 local Whisper.";

/** Website crawl defaults (spec §3.7). */
export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_MAX_PAGES = 300;
export const CRAWL_CONCURRENCY = 2;
export const CRAWL_DELAY_MS = 500;
