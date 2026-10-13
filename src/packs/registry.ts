import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { getHomeDir } from "../util/paths.js";
import { DEFAULT_REGISTRY_URL, PackError, REGISTRY_CACHE_TTL_MS, REGISTRY_ENV } from "./schema.js";

export type RegistryPack = {
  id: string;
  name: string;
  term: string | null;
  institution: string | null;
  version: string | null;
  source_count: number;
  verified: boolean;
  url: string;
};

export type RegistryIndex = {
  generated_at?: string;
  packs: RegistryPack[];
};

export type RegistryCacheFile = {
  fetched_at: string;
  url: string;
  index: RegistryIndex;
};

export type RegistryClientOptions = {
  url?: string;
  homeDir?: string;
  fetchFn?: FetchLike;
  now?: () => number;
  ttlMs?: number;
};

export function defaultRegistryUrl(): string {
  return process.env[REGISTRY_ENV]?.trim() || DEFAULT_REGISTRY_URL;
}

export function registryCachePath(homeDir = getHomeDir()): string {
  return join(homeDir, "cache", "registry-index.json");
}

export class RegistryClient {
  private readonly url: string;
  private readonly homeDir: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: RegistryClientOptions = {}) {
    this.url = options.url?.trim() || defaultRegistryUrl();
    this.homeDir = options.homeDir ?? getHomeDir();
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? REGISTRY_CACHE_TTL_MS;
  }

  registryUrl(): string {
    return this.url;
  }

  async getIndex(options: { force?: boolean } = {}): Promise<RegistryIndex> {
    const cached = this.readCache();
    const fresh =
      cached && cached.url === this.url && this.now() - Date.parse(cached.fetched_at) < this.ttlMs;
    if (cached && fresh && !options.force) {
      return cached.index;
    }
    try {
      const index = await this.fetchIndex();
      this.writeCache(index);
      return index;
    } catch (err) {
      if (cached && cached.url === this.url) {
        return cached.index;
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new PackError(
        `Could not reach the pack registry at ${this.url}. ${detail} ` +
          `Set ${REGISTRY_ENV} or pass a pack file path / URL to add-pack.`,
      );
    }
  }

  async findById(id: string): Promise<RegistryPack> {
    const index = await this.getIndex();
    const hit = index.packs.find((p) => p.id === id);
    if (!hit) {
      const known = index.packs
        .map((p) => p.id)
        .slice(0, 12)
        .join(", ");
      throw new PackError(
        `Pack "${id}" is not in the registry. ${known ? `Known ids: ${known}` : "The registry index is empty."}`,
      );
    }
    return hit;
  }

  private async fetchIndex(): Promise<RegistryIndex> {
    const res = await this.fetchFn(this.url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as unknown;
    return parseRegistryIndex(raw);
  }

  private readCache(): RegistryCacheFile | null {
    try {
      const raw = readFileSync(registryCachePath(this.homeDir), "utf8");
      const parsed = JSON.parse(raw) as RegistryCacheFile;
      if (!parsed?.index || !Array.isArray(parsed.index.packs) || !parsed.fetched_at) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private writeCache(index: RegistryIndex): void {
    const path = registryCachePath(this.homeDir);
    mkdirSync(dirname(path), { recursive: true });
    const body: RegistryCacheFile = {
      fetched_at: new Date(this.now()).toISOString(),
      url: this.url,
      index,
    };
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
}

export function parseRegistryIndex(raw: unknown): RegistryIndex {
  const root = Array.isArray(raw)
    ? { packs: raw }
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const list = Array.isArray(root.packs) ? root.packs : [];
  const packs: RegistryPack[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!id || !url) {
      continue;
    }
    packs.push({
      id,
      name: typeof rec.name === "string" ? rec.name : id,
      term: typeof rec.term === "string" ? rec.term : null,
      institution: typeof rec.institution === "string" ? rec.institution : null,
      version: typeof rec.version === "string" ? rec.version : null,
      source_count: typeof rec.source_count === "number" ? rec.source_count : 0,
      verified: rec.verified === true,
      url,
    });
  }
  return {
    generated_at: typeof root.generated_at === "string" ? root.generated_at : undefined,
    packs,
  };
}
