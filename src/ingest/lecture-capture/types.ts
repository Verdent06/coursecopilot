/**
 * Generic lecture-capture types. Leccap is the first provider; Panopto/Kaltura
 * can implement the same `LectureCaptureProvider` later.
 */

export type LectureUrlKind = "site" | "recording";

export type ParsedLectureUrl = {
  kind: LectureUrlKind;
  origin: string;
  siteId?: string;
  recordingId?: string;
  canonical: string;
};

export type LectureRecordingRef = {
  recordingId: string;
  title: string;
  date?: string;
  url: string;
  siteId?: string;
  siteName?: string;
};

export type LectureCaption = {
  text: string;
  start_s: number;
  end_s: number;
};

export type SlideChange = {
  /** 1-based slide index as shown in the player. */
  slideIndex: number;
  start_s: number;
};

export type AuxSourceMeta = {
  kind: string;
  prefix?: string;
  count?: number;
  interval_s?: number;
};

export type LectureProduct = {
  recordingId: string;
  siteId?: string;
  siteName?: string;
  title: string;
  /** Original date string from the product (often MM/DD/YYYY). */
  date?: string;
  duration_s?: number;
  playerUrl: string;
  captions: LectureCaption[];
  slides: SlideChange[];
  /** Absolute URLs for slide images, keyed by 1-based slide index. */
  slideImageUrls: Record<number, string>;
  auxSources: AuxSourceMeta[];
  /** Stable string used for incremental content_hash. */
  hashMaterial: string;
};

export type PdfSlideCandidate = {
  title: string;
  page?: number;
  slide?: number;
  text: string;
  path?: string;
  url?: string;
};

export type MatchedPdfSlide = {
  title: string;
  page?: number;
  slide?: number;
  score: number;
};

export type LectureCaptureSession = {
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
};

export class SessionExpiredError extends Error {
  readonly code = "session_expired" as const;

  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export type LectureCaptureProvider = {
  readonly id: string;
  parseUrl(uri: string): ParsedLectureUrl | null;
  listRecordings(siteId: string): Promise<LectureRecordingRef[]>;
  fetchProduct(recordingId: string): Promise<LectureProduct>;
  fetchBytes?(url: string): Promise<Uint8Array | null>;
  playerDeepLink(playerUrl: string, startS: number | null | undefined): string;
};

export type OcrFn = (imageBytes: Uint8Array) => Promise<string>;
