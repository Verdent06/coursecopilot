/** Chunking and file-ingest knobs (spec §8, §9.3). */

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
