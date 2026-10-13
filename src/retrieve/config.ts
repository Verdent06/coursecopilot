/** Retrieval knobs (spec §8). Tunable; not research-validated. */

/** MiniLM embedding size. */
export const EMBED_DIM = 384;

/** Hugging Face model id (384-dim, ~23 MB quantized). */
export const EMBED_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Embed this many chunk texts per worker call. */
export const EMBED_BATCH = 32;

/** Reciprocal Rank Fusion constant k (spec §8). */
export const RRF_K = 60;

/** BM25 / FTS candidate pool. */
export const FTS_CANDIDATES = 30;

/** Vector candidate pool. */
export const VEC_CANDIDATES = 30;

/** Default search_course k. */
export const DEFAULT_K = 8;

/** Max search_course k. */
export const MAX_K = 20;

/** Multiply RRF score by this when the topic filter matches a chunk. */
export const TOPIC_BOOST = 1.1;
