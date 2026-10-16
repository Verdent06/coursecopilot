import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../util/log.js";
import { getCanvasSnapshotPath } from "../util/paths.js";
import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCourse,
  CanvasFile,
  CanvasModule,
  CanvasPage,
  CanvasUser,
} from "./client.js";

export const CANVAS_SNAPSHOT_VERSION = 1 as const;

export type CanvasSnapshot = {
  version: typeof CANVAS_SNAPSHOT_VERSION;
  synced_at: string;
  base_url?: string;
  self?: Pick<CanvasUser, "id" | "name" | "time_zone">;
  courses: CanvasCourse[];
  modules: Record<string, CanvasModule[]>;
  pages: Record<string, CanvasPage[]>;
  files: Record<string, CanvasFile[]>;
  assignments: Record<string, CanvasAssignment[]>;
  announcements: CanvasAnnouncement[];
};

export function loadCanvasSnapshot(): CanvasSnapshot | null {
  const path = getCanvasSnapshotPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return normalizeSnapshot(parsed);
  } catch (err) {
    log.warn("could not read canvas-snapshot.json", err);
    return null;
  }
}

export function saveCanvasSnapshot(snapshot: CanvasSnapshot): string {
  const path = getCanvasSnapshotPath();
  mkdirSync(dirname(path), { recursive: true });
  const body: CanvasSnapshot = {
    version: CANVAS_SNAPSHOT_VERSION,
    synced_at: snapshot.synced_at || new Date().toISOString(),
    base_url: snapshot.base_url,
    self: snapshot.self,
    courses: snapshot.courses,
    modules: snapshot.modules,
    pages: snapshot.pages,
    files: snapshot.files,
    assignments: snapshot.assignments,
    announcements: snapshot.announcements,
  };
  writeFileSync(path, `${JSON.stringify(body)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function parseCanvasSnapshot(raw: unknown): CanvasSnapshot {
  const snap = normalizeSnapshot(raw);
  if (!snap) {
    throw new Error("Canvas snapshot is missing courses or has the wrong shape.");
  }
  return snap;
}

function normalizeSnapshot(raw: unknown): CanvasSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.courses)) {
    return null;
  }
  return {
    version: CANVAS_SNAPSHOT_VERSION,
    synced_at: typeof obj.synced_at === "string" ? obj.synced_at : new Date().toISOString(),
    base_url: typeof obj.base_url === "string" ? obj.base_url : undefined,
    self: asSelf(obj.self),
    courses: obj.courses as CanvasCourse[],
    modules: asRecord(obj.modules),
    pages: asRecord(obj.pages),
    files: asRecord(obj.files),
    assignments: asRecord(obj.assignments),
    announcements: Array.isArray(obj.announcements)
      ? (obj.announcements as CanvasAnnouncement[])
      : [],
  };
}

function asSelf(raw: unknown): CanvasSnapshot["self"] {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  return {
    id: typeof obj.id === "number" ? obj.id : 0,
    name: typeof obj.name === "string" ? obj.name : "",
    time_zone: typeof obj.time_zone === "string" ? obj.time_zone : undefined,
  };
}

function asRecord<T>(raw: unknown): Record<string, T[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, T[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = value as T[];
    }
  }
  return out;
}
