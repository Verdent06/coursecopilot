import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { assertPublicUrl } from "../util/ssrf.js";
import type { RegistryClient } from "./registry.js";
import { PackError, type PackManifest, type PackOrigin, parsePackDocument } from "./schema.js";

export type ResolvedPack = {
  manifest: PackManifest;
  origin: PackOrigin;
  source: string;
};

export type ResolvePackOptions = {
  registry: RegistryClient;
  allowLocalPaths?: boolean;
  allowPrivateNetwork?: boolean;
  fetchFn?: FetchLike;
};

export function looksLikeHttpUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref.trim());
}

export function looksLikeLocalPackRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) {
    return false;
  }
  if (/^file:/i.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("~")) {
    return true;
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }
  if (isAbsolute(trimmed)) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return true;
  }
  if (/\.(json|ya?ml)$/i.test(trimmed) && (trimmed.includes("/") || trimmed.includes("\\"))) {
    return true;
  }
  return existsSync(expandPath(trimmed));
}

export async function resolvePack(ref: string, options: ResolvePackOptions): Promise<ResolvedPack> {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new PackError("Pack id, URL, or path is required.");
  }
  if (looksLikeHttpUrl(trimmed)) {
    return resolveFromUrl(trimmed, options, "url");
  }
  if (looksLikeLocalPackRef(trimmed)) {
    if (options.allowLocalPaths === false) {
      throw new PackError(
        "Local pack paths are disabled unless --allow-path is set (remote mode). Pass a pack URL or registry id.",
      );
    }
    return resolveFromPath(trimmed);
  }
  const entry = await options.registry.findById(trimmed);
  const resolved = await resolveFromUrl(entry.url, options, "registry");
  if (resolved.manifest.id !== trimmed) {
    throw new PackError(
      `Registry pack "${trimmed}" resolved to manifest id "${resolved.manifest.id}". They must match.`,
    );
  }
  return { ...resolved, origin: "registry", source: trimmed };
}

async function resolveFromUrl(
  url: string,
  options: ResolvePackOptions,
  origin: PackOrigin,
): Promise<ResolvedPack> {
  if (options.allowPrivateNetwork === false) {
    assertPublicUrl(url);
  }
  const fetchFn = options.fetchFn ?? fetch;
  const res = await fetchFn(url, {
    headers: { accept: "application/json, text/yaml, text/plain" },
  });
  if (!res.ok) {
    throw new PackError(
      `Failed to download pack from ${url}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const text = await res.text();
  const manifest = parsePackDocument(text, filenameFromPackUrl(url));
  return { manifest, origin, source: url };
}

function filenameFromPackUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    if (/\.(json|ya?ml)$/i.test(path)) {
      return path;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function resolveFromPath(ref: string): ResolvedPack {
  const abs = expandPath(ref);
  if (!existsSync(abs)) {
    throw new PackError(`Pack file not found: ${abs}`);
  }
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    throw new PackError(
      `Could not read pack file ${abs}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const manifest = parsePackDocument(text, abs);
  return { manifest, origin: "path", source: abs };
}

function expandPath(ref: string): string {
  const trimmed = ref.trim();
  if (/^file:/i.test(trimmed)) {
    return fileURLToPath(trimmed);
  }
  if (trimmed.startsWith("~")) {
    return resolvePath(homedir(), trimmed.slice(1).replace(/^[\\/]/, ""));
  }
  return resolvePath(trimmed);
}
