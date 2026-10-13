import { ulid } from "ulid";

const SLUG_MAX = 64;

/** Generate a ULID (used for sources, jobs, quiz attempts, …). */
export function newId(): string {
  return ulid();
}

/**
 * Build a course slug from a title and optional term.
 * "EECS 376" + "F26" → "eecs-376-f26". Users can pass an explicit course_id
 * (e.g. "eecs376-f26") to override.
 */
export function slugifyCourseId(title: string, term?: string): string {
  const titleSlug = slugPart(title);
  const termSlug = term ? slugPart(term) : "";
  let slug = titleSlug;
  if (termSlug && !titleSlug.endsWith(`-${termSlug}`) && titleSlug !== termSlug) {
    slug = `${titleSlug}-${termSlug}`;
  }
  if (!slug) {
    slug = "course";
  }
  return slug.slice(0, SLUG_MAX).replace(/-+$/, "") || "course";
}

export function isValidCourseId(id: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id);
}

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nextAvailableSlug(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) {
    return base;
  }
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique course_id");
}
