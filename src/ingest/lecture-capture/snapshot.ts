import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../../util/log.js";
import { getLeccapSnapshotPath } from "../../util/paths.js";
import type { LectureCaptureProvider, LectureProduct, LectureRecordingRef } from "./types.js";

export const LECCAP_SNAPSHOT_VERSION = 1 as const;

export type LeccapSnapshot = {
  version: typeof LECCAP_SNAPSHOT_VERSION;
  synced_at: string;
  recordings: LectureProduct[];
};

export function loadLeccapSnapshot(): LeccapSnapshot | null {
  const path = getLeccapSnapshotPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return normalizeLeccapSnapshot(parsed);
  } catch (err) {
    log.warn("could not read leccap-snapshot.json", err);
    return null;
  }
}

export function saveLeccapSnapshot(snapshot: LeccapSnapshot): string {
  const path = getLeccapSnapshotPath();
  mkdirSync(dirname(path), { recursive: true });
  const body: LeccapSnapshot = {
    version: LECCAP_SNAPSHOT_VERSION,
    synced_at: snapshot.synced_at || new Date().toISOString(),
    recordings: snapshot.recordings,
  };
  writeFileSync(path, `${JSON.stringify(body)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function parseLeccapSnapshot(raw: unknown): LeccapSnapshot {
  const snap = normalizeLeccapSnapshot(raw);
  if (!snap || snap.recordings.length === 0) {
    throw new Error("leccap snapshot is missing recordings.");
  }
  return snap;
}

export function overlayLeccapSnapshot<T extends LectureCaptureProvider>(
  live: T,
  snapshot: LeccapSnapshot | null,
): T {
  if (!snapshot || snapshot.recordings.length === 0) {
    return live;
  }
  const byId = new Map(snapshot.recordings.map((r) => [r.recordingId, r]));
  const overlay: LectureCaptureProvider = {
    id: live.id,
    parseUrl: (uri) => live.parseUrl(uri),
    playerDeepLink: (url, start) => live.playerDeepLink(url, start),
    async listRecordings(siteId: string): Promise<LectureRecordingRef[]> {
      const fromSnap = snapshot.recordings
        .filter((r) => !r.siteId || r.siteId === siteId)
        .map((r) => ({
          recordingId: r.recordingId,
          title: r.title,
          date: r.date,
          url: r.playerUrl,
          siteId: r.siteId ?? siteId,
          siteName: r.siteName,
        }));
      if (fromSnap.length > 0) {
        return fromSnap;
      }
      return live.listRecordings(siteId);
    },
    async fetchProduct(recordingId: string): Promise<LectureProduct> {
      const hit = byId.get(recordingId);
      if (hit) {
        return hit;
      }
      return live.fetchProduct(recordingId);
    },
    fetchBytes: live.fetchBytes?.bind(live),
  };
  return Object.assign(live, overlay);
}

function normalizeLeccapSnapshot(raw: unknown): LeccapSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const recordings = Array.isArray(obj.recordings)
    ? obj.recordings.filter(isProduct)
    : Array.isArray(obj.products)
      ? obj.products.filter(isProduct)
      : [];
  if (recordings.length === 0) {
    return null;
  }
  return {
    version: LECCAP_SNAPSHOT_VERSION,
    synced_at: typeof obj.synced_at === "string" ? obj.synced_at : new Date().toISOString(),
    recordings,
  };
}

function isProduct(value: unknown): value is LectureProduct {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.recordingId === "string" && typeof obj.playerUrl === "string";
}
