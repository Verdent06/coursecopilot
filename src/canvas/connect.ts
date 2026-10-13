import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { log } from "../util/log.js";
import { saveCanvasCredentials } from "./auth.js";
import { CanvasClient } from "./client.js";
import { CanvasApiError, canvasFallbackMessage } from "./errors.js";
import { normalizeCanvasBaseUrl } from "./uri.js";

export type CanvasConnectInput = {
  baseUrl?: string;
  token?: string;
  yes?: boolean;
  fetchFn?: FetchLike;
};

export type CanvasConnectResult =
  | { ok: true; name: string; baseUrl: string; secretsPath: string }
  | { ok: false; message: string };

export async function connectCanvas(input: CanvasConnectInput = {}): Promise<CanvasConnectResult> {
  try {
    const baseRaw =
      input.baseUrl?.trim() ||
      (input.yes ? "" : await prompt("Canvas instance URL (e.g. https://umich.instructure.com): "));
    const token = input.token?.trim() || (input.yes ? "" : await prompt("Personal access token: "));
    if (!baseRaw || !token) {
      return {
        ok: false,
        message:
          "Need a Canvas URL and personal access token. Create one at Account → Settings → Approved Integrations → “+ New Access Token.”",
      };
    }
    const baseUrl = normalizeCanvasBaseUrl(baseRaw);
    const client = new CanvasClient({
      credentials: { baseUrl, token },
      fetchFn: input.fetchFn,
    });
    const self = await client.getSelf();
    const secretsPath = saveCanvasCredentials({ baseUrl, token });
    return { ok: true, name: self.name || `user ${self.id}`, baseUrl, secretsPath };
  } catch (err) {
    if (err instanceof CanvasApiError) {
      return { ok: false, message: err.fallback };
    }
    const message = err instanceof Error ? err.message : String(err);
    log.warn("canvas connect failed", message);
    return { ok: false, message: `${message}\n\n${canvasFallbackMessage("token_rejected")}` };
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
