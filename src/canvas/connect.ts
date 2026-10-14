import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { log } from "../util/log.js";
import { saveCanvasCredentials, saveCanvasIcsUrl } from "./auth.js";
import { CanvasClient } from "./client.js";
import { CanvasApiError, canvasFallbackMessage } from "./errors.js";
import { fetchCanvasIcs, normalizeCanvasIcsUrl } from "./ics.js";
import { normalizeCanvasBaseUrl } from "./uri.js";

export type CanvasConnectInput = {
  baseUrl?: string;
  token?: string;
  icsUrl?: string;
  yes?: boolean;
  fetchFn?: FetchLike;
  allowPrivateNetwork?: boolean;
};

export type CanvasConnectResult =
  | { ok: true; name: string; baseUrl: string; secretsPath: string; via: "pat" | "ics" }
  | { ok: false; message: string };

export async function connectCanvas(input: CanvasConnectInput = {}): Promise<CanvasConnectResult> {
  const icsRaw = input.icsUrl?.trim();
  if (icsRaw) {
    return connectIcs(icsRaw, input);
  }
  const token = input.token?.trim();
  const baseRaw = input.baseUrl?.trim();
  if (token || baseRaw) {
    return connectPat({ ...input, baseUrl: baseRaw, token });
  }
  if (input.yes) {
    return {
      ok: false,
      message:
        "Need a Canvas calendar feed URL (Calendar → Calendar Feed) or a URL + personal access token. Many schools block tokens — start with the ICS feed.",
    };
  }
  process.stderr.write(
    "Many schools block student access tokens. Prefer the calendar feed.\n" +
      "  1. Canvas → Calendar → Calendar Feed (bottom right) → copy the ICS URL\n" +
      "  2. Or a personal token, only if Account → Settings still shows + New Access Token\n",
  );
  const icsPrompt = await prompt("Calendar feed URL (Enter to skip): ");
  if (icsPrompt) {
    return connectIcs(icsPrompt, input);
  }
  return connectPat(input);
}

async function connectIcs(raw: string, input: CanvasConnectInput): Promise<CanvasConnectResult> {
  try {
    const icsUrl = normalizeCanvasIcsUrl(raw);
    await fetchCanvasIcs(icsUrl, input.fetchFn, {
      allowPrivateNetwork: input.allowPrivateNetwork ?? true,
    });
    const secretsPath = saveCanvasIcsUrl(icsUrl);
    let baseUrl = "";
    try {
      baseUrl = new URL(icsUrl).origin;
    } catch {
      baseUrl = icsUrl;
    }
    return { ok: true, name: "calendar feed", baseUrl, secretsPath, via: "ics" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("canvas ics connect failed", message);
    return {
      ok: false,
      message: `${message}\n\n${canvasFallbackMessage("canvas_not_configured")}`,
    };
  }
}

async function connectPat(input: CanvasConnectInput): Promise<CanvasConnectResult> {
  try {
    const baseRaw =
      input.baseUrl?.trim() ||
      (input.yes ? "" : await prompt("Canvas instance URL (e.g. https://umich.instructure.com): "));
    const token = input.token?.trim() || (input.yes ? "" : await prompt("Personal access token: "));
    if (!baseRaw || !token) {
      return {
        ok: false,
        message:
          "Need a Canvas URL and personal access token. If your school hid “+ New Access Token”, use the calendar feed instead (Calendar → Calendar Feed).",
      };
    }
    const baseUrl = normalizeCanvasBaseUrl(baseRaw);
    const client = new CanvasClient({
      credentials: { baseUrl, token },
      fetchFn: input.fetchFn,
    });
    const self = await client.getSelf();
    const secretsPath = saveCanvasCredentials({ baseUrl, token });
    return { ok: true, name: self.name || `user ${self.id}`, baseUrl, secretsPath, via: "pat" };
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
