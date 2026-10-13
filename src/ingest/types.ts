/** Locator stored on each chunk (subset of the citation object in spec §10). */
export type Locator = {
  path?: string;
  url?: string;
  page?: number;
  slide?: number;
  title?: string;
  anchor?: string;
  start_s?: number;
  end_s?: number;
  video_id?: string;
};

export type ExtractedSegment = {
  text: string;
  locator: Locator;
  headingPath: string;
};

export type ExtractedDocument = {
  title: string;
  mime: string;
  segments: ExtractedSegment[];
  meta: Record<string, unknown>;
};

export type SkipReason = {
  url: string;
  reason: string;
};

export type SuggestedExam = {
  name: string;
  date: string | null;
  evidence: string;
};

export type IngestResult = {
  docs: number;
  chunks: number;
  skipped: SkipReason[];
  errors: number;
  /** Documents skipped because sha256 / ETag matched (website + file re-sync). */
  unchanged?: number;
  /** Newly inserted chunk ids; website/file re-sync only embeds these. */
  newChunkIds?: number[];
  suggestedExams?: SuggestedExam[];
};
