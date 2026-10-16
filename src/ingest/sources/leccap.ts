import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import { ingestLectureCaptureSource } from "../lecture-capture/ingest.js";
import { loadOcr } from "../lecture-capture/ocr.js";
import { loadSession, SESSION_EXPIRED_MESSAGE } from "../lecture-capture/session.js";
import { loadLeccapSnapshot, overlayLeccapSnapshot } from "../lecture-capture/snapshot.js";
import type { OcrFn } from "../lecture-capture/types.js";
import { SessionExpiredError } from "../lecture-capture/types.js";
import { LECCAP_PROVIDER, requireLeccapSession } from "../providers/leccap/auth.js";
import { createLeccapClient, type LeccapClient } from "../providers/leccap/client.js";
import { parseLeccapUrl } from "../providers/leccap/parse.js";
import type { IngestResult } from "../types.js";
import type { ProgressFn } from "./file.js";

export type LeccapIngestContext = {
  repo: CourseRepo;
  client?: LeccapClient;
  ocr?: OcrFn | null;
  skipSession?: boolean;
};

export function parseLeccapSourceUri(uri: string): ReturnType<typeof parseLeccapUrl> {
  return parseLeccapUrl(uri);
}

export async function ingestLeccapSource(
  ctx: LeccapIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }
  if (source.kind !== "leccap") {
    throw new RepoError(`ingestLeccapSource cannot handle kind "${source.kind}"`);
  }
  if (!parseLeccapUrl(source.uri)) {
    throw new RepoError(
      `Not a CAEN Lecture Capture URL: "${source.uri}". Use https://leccap.engin.umich.edu/leccap/site/{sitekey} or /leccap/player/r/{rk}.`,
    );
  }

  const client = ctx.client ?? createClientFromSession(ctx.skipSession === true);
  const ocr = ctx.ocr === undefined ? await loadOcr() : ctx.ocr;
  const includeWhiteboard = whiteboardFromConfig(source.config_json);
  const wantOcr = ocrFromConfig(source.config_json);

  try {
    return await ingestLectureCaptureSource({
      repo: ctx.repo,
      provider: client,
      sourceId,
      onProgress,
      ocr: wantOcr ? ocr : null,
      fetchSlideBytes: client.fetchBytes.bind(client),
      includeWhiteboard,
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      throw new RepoError(err.message);
    }
    throw err;
  }
}

function createClientFromSession(skipSession: boolean): LeccapClient {
  const snapshot = loadLeccapSnapshot();
  if (skipSession) {
    return overlayLeccapSnapshot(
      createLeccapClient({ session: loadSession(LECCAP_PROVIDER) }),
      snapshot,
    );
  }
  if (snapshot && snapshot.recordings.length > 0) {
    return overlayLeccapSnapshot(
      createLeccapClient({ session: loadSession(LECCAP_PROVIDER) }),
      snapshot,
    );
  }
  const session = requireLeccapSession();
  return overlayLeccapSnapshot(createLeccapClient({ session }), snapshot);
}

function ocrFromConfig(configJson: string | null): boolean {
  if (!configJson) {
    return true;
  }
  try {
    const parsed = JSON.parse(configJson) as { ocr?: unknown };
    return parsed.ocr !== false;
  } catch {
    return true;
  }
}

function whiteboardFromConfig(configJson: string | null): boolean {
  if (!configJson) {
    return false;
  }
  try {
    const parsed = JSON.parse(configJson) as { whiteboard?: unknown };
    return parsed.whiteboard === true;
  } catch {
    return false;
  }
}

export { SESSION_EXPIRED_MESSAGE };
