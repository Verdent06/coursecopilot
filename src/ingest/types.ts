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

export type IngestResult = {
  docs: number;
  chunks: number;
  skipped: SkipReason[];
  errors: number;
};
