import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryIndex, RegistryPack } from "./registry.js";
import {
  DEFAULT_PACK_RAW_BASE,
  type PackManifest,
  packIdFromFilename,
  parsePackDocument,
} from "./schema.js";

export const PACK_SCHEMA_RELATIVE = "packs/schema/pack.schema.json";
export const PACK_INDEX_RELATIVE = "packs/index.json";

export function repoRootFromModule(moduleUrl = import.meta.url): string {
  // src/packs/catalog.ts → repo root. dist/packs/catalog.js → same (two levels up).
  return join(dirname(fileURLToPath(moduleUrl)), "../..");
}

export function packsDir(root = repoRootFromModule()): string {
  return join(root, "packs");
}

export function packSchemaPath(root = repoRootFromModule()): string {
  return join(root, PACK_SCHEMA_RELATIVE);
}

export function packIndexPath(root = repoRootFromModule()): string {
  return join(root, PACK_INDEX_RELATIVE);
}

export function isPackManifestFile(name: string): boolean {
  if (name === "index.json") {
    return false;
  }
  return /\.(json|ya?ml)$/i.test(name);
}

export type LoadedPack = {
  filename: string;
  path: string;
  manifest: PackManifest;
};

export function listPackManifestPaths(root = repoRootFromModule()): string[] {
  const dir = packsDir(root);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter(isPackManifestFile)
    .map((name) => join(dir, name))
    .sort();
}

export function loadStarterPacks(root = repoRootFromModule()): LoadedPack[] {
  const loaded: LoadedPack[] = [];
  for (const path of listPackManifestPaths(root)) {
    const filename = path.split(/[/\\]/).pop() ?? path;
    const text = readFileSync(path, "utf8");
    const manifest = parsePackDocument(text, filename);
    loaded.push({ filename, path, manifest });
  }
  loaded.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  return loaded;
}

export function packRawUrl(id: string, rawBase = DEFAULT_PACK_RAW_BASE): string {
  const base = rawBase.replace(/\/+$/, "");
  return `${base}/${id}.json`;
}

export function registryEntryFromManifest(
  manifest: PackManifest,
  options: { verified?: boolean; rawBase?: string } = {},
): RegistryPack {
  return {
    id: manifest.id,
    name: manifest.name,
    term: manifest.term ?? null,
    institution: manifest.institution ?? null,
    version: manifest.version,
    source_count: manifest.sources.length,
    verified: options.verified ?? true,
    url: packRawUrl(manifest.id, options.rawBase),
  };
}

export function buildRegistryIndex(
  packs: PackManifest[],
  options: { generatedAt?: string; verified?: boolean; rawBase?: string } = {},
): RegistryIndex {
  const entries = packs
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((manifest) => registryEntryFromManifest(manifest, options));
  return {
    generated_at: options.generatedAt ?? new Date().toISOString(),
    packs: entries,
  };
}

export function stringifyRegistryIndex(index: RegistryIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function writeRegistryIndexFile(
  root = repoRootFromModule(),
  options: { generatedAt?: string } = {},
): { path: string; index: RegistryIndex } {
  const loaded = loadStarterPacks(root);
  const index = buildRegistryIndex(
    loaded.map((p) => p.manifest),
    { generatedAt: options.generatedAt },
  );
  const path = packIndexPath(root);
  writeFileSync(path, stringifyRegistryIndex(index), "utf8");
  return { path, index };
}

export function assertIndexInSync(root = repoRootFromModule()): RegistryIndex {
  const loaded = loadStarterPacks(root);
  const expected = buildRegistryIndex(
    loaded.map((p) => p.manifest),
    { generatedAt: "2000-01-01T00:00:00.000Z" },
  );
  const path = packIndexPath(root);
  if (!existsSync(path)) {
    throw new Error(`Missing ${PACK_INDEX_RELATIVE}. Run npm run packs:index.`);
  }
  const actual = JSON.parse(readFileSync(path, "utf8")) as RegistryIndex;
  const actualPacks = (actual.packs ?? []).map(normalizeIndexPack);
  const expectedPacks = expected.packs.map(normalizeIndexPack);
  if (JSON.stringify(actualPacks) !== JSON.stringify(expectedPacks)) {
    throw new Error(
      `${PACK_INDEX_RELATIVE} is out of date. Run npm run packs:index and commit the result.`,
    );
  }
  const seen = new Set<string>();
  for (const pack of loaded) {
    const stem = packIdFromFilename(pack.filename);
    if (stem !== pack.manifest.id) {
      throw new Error(`Pack id ${pack.manifest.id} does not match file stem ${stem}`);
    }
    if (seen.has(pack.manifest.id)) {
      throw new Error(`Duplicate pack id "${pack.manifest.id}"`);
    }
    seen.add(pack.manifest.id);
  }
  return actual;
}

function normalizeIndexPack(pack: RegistryPack): Omit<RegistryPack, never> {
  return {
    id: pack.id,
    name: pack.name,
    term: pack.term ?? null,
    institution: pack.institution ?? null,
    version: pack.version ?? null,
    source_count: pack.source_count,
    verified: pack.verified === true,
    url: pack.url,
  };
}
