import type { SourceKind } from "../db/repo.js";

export type DroppedSourceKind = "canvas" | "lecture_capture" | "local_files";

const LECCAP_HOST = /leccap/i;
const LECTURE_CAPTURE_HOST = /lecture[-.]?capture/i;

export function isLocalSourceUri(uri: string, kind: SourceKind): boolean {
  if (kind === "file" || kind === "folder") {
    return true;
  }
  if (/^file:/i.test(uri) || uri.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uri)) {
    return true;
  }
  if (kind === "transcript" && !/^https?:\/\//i.test(uri)) {
    return true;
  }
  return false;
}

export function isCanvasSource(uri: string, kind: SourceKind): boolean {
  return kind === "canvas" || /^canvas:/i.test(uri);
}

export function isLectureCaptureUri(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return LECCAP_HOST.test(host) || LECTURE_CAPTURE_HOST.test(host);
  } catch {
    return LECCAP_HOST.test(uri) || LECTURE_CAPTURE_HOST.test(uri);
  }
}

export function classifyDroppedSource(uri: string, kind: SourceKind): DroppedSourceKind | null {
  if (isCanvasSource(uri, kind)) {
    return "canvas";
  }
  if (kind === "leccap" || isLectureCaptureUri(uri)) {
    return "lecture_capture";
  }
  if (isLocalSourceUri(uri, kind)) {
    return "local_files";
  }
  return null;
}

export function placeholderMessage(kind: DroppedSourceKind, host?: string): string {
  if (kind === "canvas") {
    return "Canvas sources are never exported. Connect Canvas with your own token and add those sources yourself.";
  }
  if (kind === "lecture_capture") {
    const where = host ? ` (${host})` : "";
    return `Lecture capture${where} is login-gated and was not exported. Run \`coursecopilot login leccap\` and add the source yourself, or export a VTT/SRT as a transcript.`;
  }
  return "Local files were omitted from the pack. Add them yourself with add_source (kind file or folder).";
}

export function hostFromUri(uri: string): string | undefined {
  try {
    return new URL(uri).hostname;
  } catch {
    return undefined;
  }
}
