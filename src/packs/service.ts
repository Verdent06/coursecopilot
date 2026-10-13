import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CourseRepo } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import type { IngestQueue } from "../ingest/queue.js";
import { getHomeDir } from "../util/paths.js";
import { exportPackFromCourse } from "./export.js";
import { type AddPackResult, addPack, stringifyManifest } from "./install.js";
import { RegistryClient } from "./registry.js";
import type { PackManifest } from "./schema.js";
import { PackError } from "./schema.js";

export type PackListItem = {
  id: string;
  name: string;
  term: string | null;
  institution: string | null;
  source_count: number;
  installed: boolean;
  verified: boolean;
};

export type PackServiceOptions = {
  repo: CourseRepo;
  queue: IngestQueue;
  allowLocalPaths?: boolean;
  allowPrivateNetwork?: boolean;
  registryUrl?: string;
  fetchFn?: FetchLike;
  homeDir?: string;
  now?: () => number;
};

export class PackService {
  private readonly registry: RegistryClient;
  private readonly homeDir: string;

  constructor(private readonly opts: PackServiceOptions) {
    this.homeDir = opts.homeDir ?? getHomeDir();
    this.registry = new RegistryClient({
      url: opts.registryUrl,
      homeDir: this.homeDir,
      fetchFn: opts.fetchFn,
      now: opts.now,
    });
  }

  async addPack(pack: string, options: { course_id?: string } = {}): Promise<AddPackResult> {
    return addPack({
      repo: this.opts.repo,
      queue: this.opts.queue,
      registry: this.registry,
      pack,
      course_id: options.course_id,
      allowLocalPaths: this.opts.allowLocalPaths,
      allowPrivateNetwork: this.opts.allowPrivateNetwork,
      fetchFn: this.opts.fetchFn,
    });
  }

  exportPack(
    courseId: string,
    options: { include_local_paths?: boolean; outPath?: string } = {},
  ): { manifest: PackManifest; path?: string; warnings: string[] } {
    const { manifest, warnings } = exportPackFromCourse(this.opts.repo, courseId, {
      include_local_paths: options.include_local_paths,
    });
    const path = options.outPath;
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, stringifyManifest(manifest), "utf8");
    }
    return { manifest, path, warnings };
  }

  defaultExportPath(packId: string): string {
    return join(this.homeDir, "exports", `${packId}.json`);
  }

  async listPacks(options: { query?: string; installed_only?: boolean } = {}): Promise<{
    packs: PackListItem[];
  }> {
    const installed = this.opts.repo.listInstalledPacks();
    const installedById = new Map(installed.map((p) => [p.id, p]));
    const q = options.query?.trim().toLowerCase();
    const matches = (item: PackListItem) => {
      if (!q) {
        return true;
      }
      const hay =
        `${item.id} ${item.name} ${item.term ?? ""} ${item.institution ?? ""}`.toLowerCase();
      return hay.includes(q);
    };

    if (options.installed_only) {
      const packs = installed
        .map((row) => ({
          id: row.id,
          name: row.name,
          term: row.term,
          institution: row.institution,
          source_count: row.source_count,
          installed: true,
          verified: false,
        }))
        .filter(matches);
      return { packs };
    }

    let registryPacks: PackListItem[] = [];
    try {
      const index = await this.registry.getIndex();
      registryPacks = index.packs.map((p) => ({
        id: p.id,
        name: p.name,
        term: p.term,
        institution: p.institution,
        source_count: p.source_count,
        installed: installedById.has(p.id),
        verified: p.verified,
      }));
    } catch (err) {
      if (installed.length === 0) {
        throw err instanceof PackError
          ? err
          : new PackError(err instanceof Error ? err.message : String(err));
      }
    }

    const seen = new Set(registryPacks.map((p) => p.id));
    const extras = installed
      .filter((row) => !seen.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        term: row.term,
        institution: row.institution,
        source_count: row.source_count,
        installed: true,
        verified: false,
      }));
    const packs = [...registryPacks, ...extras].filter(matches);
    packs.sort((a, b) => a.id.localeCompare(b.id));
    return { packs };
  }
}
