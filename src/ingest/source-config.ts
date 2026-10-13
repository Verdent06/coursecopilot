export type SourceConfig = {
  max_depth?: number;
  max_pages?: number;
  include_prefix?: string;
  lecture_no?: number;
  as_slides?: boolean;
};

export function parseSourceConfig(raw: string | null): SourceConfig {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SourceConfig = {};
    if (typeof parsed.max_depth === "number") {
      out.max_depth = parsed.max_depth;
    }
    if (typeof parsed.max_pages === "number") {
      out.max_pages = parsed.max_pages;
    }
    if (typeof parsed.include_prefix === "string") {
      out.include_prefix = parsed.include_prefix;
    }
    if (typeof parsed.lecture_no === "number") {
      out.lecture_no = parsed.lecture_no;
    }
    if (typeof parsed.as_slides === "boolean") {
      out.as_slides = parsed.as_slides;
    }
    return out;
  } catch {
    return {};
  }
}
