import { existsSync } from "node:fs";
import { join } from "node:path";
import { isLocalModelDir } from "../ingest/embed.js";
import { EMBED_MODEL_ID } from "../retrieve/config.js";
import { getHfCacheDir, getLocalModelPath } from "../util/paths.js";

export function embeddingModelCacheCandidates(
  cacheDir = getHfCacheDir(),
  modelId = EMBED_MODEL_ID,
): string[] {
  const local = getLocalModelPath();
  const safe = modelId.replace(/\//g, "--");
  const [org, name] = modelId.split("/");
  const hits = [
    join(cacheDir, modelId),
    join(cacheDir, org ?? "", name ?? ""),
    join(cacheDir, "hub", `models--${safe}`),
    join(cacheDir, `models--${safe}`),
  ];
  if (local) {
    hits.unshift(local);
  }
  return hits;
}

export function isEmbeddingModelCached(): boolean {
  const local = getLocalModelPath();
  if (local && isLocalModelDir(local)) {
    return true;
  }
  return embeddingModelCacheCandidates().some((p) => existsSync(p));
}
