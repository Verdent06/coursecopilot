import { basename, extname } from "node:path";
import { parse as parseYamlDocument } from "yaml";
import * as z from "zod/v4";

export const PACK_SCHEMA_VERSION = 1;
export const MAX_PACK_SOURCES = 500;
export const MAX_STRING = 4000;
export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/Verdent06/coursecopilot-packs/main/index.json";
export const REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REGISTRY_ENV = "COURSECOPILOT_PACK_REGISTRY";

/** Keys that usually mean someone pasted lecture text into a pack. */
const EMBEDDED_CONTENT_KEYS = new Set([
  "content",
  "text",
  "body",
  "html",
  "markdown",
  "slides",
  "answers",
  "transcript",
  "captions",
  "notes",
  "data",
]);

export const packIdSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/,
    "Pack id must be a lowercase slug (letters, digits, dots, hyphens, underscores)",
  );

export const packSourceSchema = z.object({
  kind: z.enum(["website", "pdf", "youtube", "transcript"]),
  url: z.string().min(1).max(2000),
  max_depth: z.number().int().min(0).max(10).optional(),
  max_pages: z.number().int().min(1).max(1000).optional(),
  include_prefix: z.string().max(500).optional(),
  lecture: z.number().int().min(0).max(999).optional(),
  as_slides: z.boolean().optional(),
  title: z.string().max(300).optional(),
});

export const packTopicSchema = z.object({
  lecture: z.number().int().min(0).max(999).optional(),
  title: z.string().max(300).optional(),
  topics: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export const packExamSchema = z.object({
  name: z.string().min(1).max(200),
  topics: z.array(z.string().min(1).max(200)).max(100).optional(),
});

export const packConnectYourselfSchema = z.object({
  kind: z.enum(["canvas", "lecture_capture", "local_files"]),
  message: z.string().min(1).max(1000),
  host: z.string().max(200).optional(),
});

export const packManifestSchema = z.object({
  schema: z.literal(PACK_SCHEMA_VERSION),
  id: packIdSchema,
  name: z.string().min(1).max(200),
  institution: z.string().max(200).optional(),
  term: z.string().max(80).optional(),
  license_note: z.string().max(4000).optional(),
  maintainers: z.array(z.string().min(1).max(80)).max(20).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver (e.g. 1.0.0)"),
  sources: z.array(packSourceSchema).min(1).max(MAX_PACK_SOURCES),
  topics: z.array(packTopicSchema).max(500).optional(),
  exams: z.array(packExamSchema).max(20).optional(),
  connect_yourself: z.array(packConnectYourselfSchema).max(20).optional(),
});

export type PackSource = z.infer<typeof packSourceSchema>;
export type PackTopic = z.infer<typeof packTopicSchema>;
export type PackExam = z.infer<typeof packExamSchema>;
export type PackConnectYourself = z.infer<typeof packConnectYourselfSchema>;
export type PackManifest = z.infer<typeof packManifestSchema>;

export type PackOrigin = "registry" | "url" | "path";

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

export function packIdFromFilename(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  if (!/^\.(json|ya?ml)$/i.test(ext)) {
    return base;
  }
  return base.slice(0, -ext.length);
}

export function assertHttpUrl(url: string, label = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PackError(`Invalid ${label} "${url}". Packs may only contain http(s) URLs.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PackError(
      `${label} must be http(s); got ${parsed.protocol}. Packs never embed files or local paths.`,
    );
  }
  return parsed;
}

/**
 * Reject packs that look like they contain course content rather than links.
 * Spec §9.7 / §14: links, metadata, and topic maps only.
 */
export function rejectEmbeddedContent(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    if (path.endsWith("license_note")) {
      if (value.length > 4000) {
        throw new PackError(`license_note is too long at ${path} (max 4000).`);
      }
      return;
    }
    if (value.length > MAX_STRING) {
      throw new PackError(
        `Packs may not embed course content (string at ${path} is ${value.length} chars). Links only.`,
      );
    }
    if (/^data:/i.test(value.trim())) {
      throw new PackError(`Packs may not embed data: URIs (found at ${path}).`);
    }
    if (looksLikeEmbeddedBlob(value)) {
      throw new PackError(`Packs may not embed binary/base64 blobs (found at ${path}).`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      rejectEmbeddedContent(item, `${path}[${i}]`);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (EMBEDDED_CONTENT_KEYS.has(key.toLowerCase()) && isContentPayload(child)) {
        throw new PackError(
          `Packs may not embed course content (found "${key}" at ${childPath}). Use source URLs only.`,
        );
      }
      rejectEmbeddedContent(child, childPath);
    }
  }
}

function isContentPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 80;
  }
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && item.trim().length > 40);
  }
  return false;
}

function looksLikeEmbeddedBlob(value: string): boolean {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length < 400) {
    return false;
  }
  return /^[A-Za-z0-9+/=]+$/.test(trimmed);
}

export function validatePackManifest(
  raw: unknown,
  options: { filename?: string } = {},
): PackManifest {
  rejectEmbeddedContent(raw);
  const parsed = packManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new PackError(`Invalid pack manifest: ${detail}`);
  }
  const manifest = parsed.data;
  for (const source of manifest.sources) {
    assertHttpUrl(source.url, `${source.kind} url`);
  }
  if (options.filename) {
    const stem = packIdFromFilename(options.filename);
    if (stem && stem !== manifest.id) {
      throw new PackError(
        `Pack id "${manifest.id}" must match the filename stem "${stem}" (spec §9.7).`,
      );
    }
  }
  return manifest;
}

export function parsePackDocument(text: string, filename?: string): PackManifest {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new PackError("Pack manifest is empty.");
  }
  let raw: unknown;
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) {
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch (err) {
      throw new PackError(
        `Pack JSON is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    try {
      raw = parseYamlDocument(trimmed) as unknown;
    } catch (err) {
      throw new PackError(
        `Pack YAML is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return validatePackManifest(raw, { filename });
}
