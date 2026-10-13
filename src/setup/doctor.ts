import { createRequire } from "node:module";
import { loadCanvasCredentials } from "../canvas/auth.js";
import { CanvasClient } from "../canvas/client.js";
import { CanvasApiError } from "../canvas/errors.js";
import { openDatabase } from "../db/migrate.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { createDefaultEmbedder, type Embedder } from "../ingest/embed.js";
import { loadSession } from "../ingest/lecture-capture/session.js";
import { RegistryClient } from "../packs/registry.js";
import { EMBED_MODEL_ID } from "../retrieve/config.js";
import { getDbPath } from "../util/paths.js";
import { VERSION } from "../version.js";
import { clientHasValidEntry, detectClients } from "./detect.js";
import { isEmbeddingModelCached } from "./model-cache.js";
import type { SetupContext } from "./types.js";
import { createSetupContext } from "./types.js";

const require = createRequire(import.meta.url);
const MIN_NODE_MAJOR = 20;

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type DoctorCheck = {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  version: string;
  checks: DoctorCheck[];
};

export type DoctorOptions = {
  json?: boolean;
  offline?: boolean;
  url?: string;
  token?: string;
  secretPath?: string;
  ctx?: SetupContext;
  fetchFn?: FetchLike;
  canvasFetchFn?: FetchLike;
  registryFetchFn?: FetchLike;
  remoteFetchFn?: FetchLike;
  embedder?: Embedder;
  nodeVersion?: string;
  skipModelDownload?: boolean;
  native?: {
    betterSqlite3?: () => void;
    sqliteVec?: () => void;
    onnxruntime?: () => void;
  };
  now?: () => Date;
};

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNode(opts.nodeVersion ?? process.versions.node));
  checks.push(checkBetterSqlite3(opts.native?.betterSqlite3));
  checks.push(checkSqliteVec(opts.native?.sqliteVec));
  checks.push(checkOnnx(opts.native?.onnxruntime));
  checks.push(checkDatabase());
  checks.push(await checkEmbeddings(opts));
  const ctx = opts.ctx ?? createSetupContext();
  checks.push(...checkClients(ctx));
  checks.push(await checkCanvas(opts.canvasFetchFn ?? opts.fetchFn));
  checks.push(checkLeccap());
  checks.push(await checkRegistry(opts.registryFetchFn ?? opts.fetchFn));
  checks.push(await checkRemote(opts));

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, version: VERSION, checks };
}

export function formatDoctorText(report: DoctorReport): string {
  const icon: Record<CheckStatus, string> = {
    pass: "✅",
    fail: "❌",
    warn: "⚠️",
    skip: "⏭️",
  };
  const lines = [`CourseCopilot doctor v${report.version}`, ""];
  for (const c of report.checks) {
    lines.push(`${icon[c.status]} ${c.name}: ${c.message}`);
    if (c.fix && c.status !== "pass") {
      lines.push(`   Fix: ${c.fix}`);
    }
  }
  lines.push("");
  lines.push(report.ok ? "All required checks passed." : "One or more checks failed.");
  return lines.join("\n");
}

export function doctorExitCode(report: DoctorReport): number {
  return report.ok ? 0 : 1;
}

function checkNode(version: string): DoctorCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    return {
      id: "node",
      name: "Node.js",
      status: "fail",
      message: `Node ${version} (need >=${MIN_NODE_MAJOR})`,
      fix: `Install Node.js ${MIN_NODE_MAJOR} or later from https://nodejs.org`,
    };
  }
  return {
    id: "node",
    name: "Node.js",
    status: "pass",
    message: `Node ${version} (>=${MIN_NODE_MAJOR})`,
  };
}

function checkBetterSqlite3(probe?: () => void): DoctorCheck {
  try {
    if (probe) {
      probe();
    } else {
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      const db = new Database(":memory:");
      db.prepare("select 1 as n").get();
      db.close();
    }
    return {
      id: "better-sqlite3",
      name: "better-sqlite3",
      status: "pass",
      message: "native module loaded",
    };
  } catch (err) {
    return {
      id: "better-sqlite3",
      name: "better-sqlite3",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      fix: "npm rebuild better-sqlite3   (needs a Node 20/22 prebuild; see docs/SPEC.md §22)",
    };
  }
}

function checkSqliteVec(probe?: () => void): DoctorCheck {
  try {
    if (probe) {
      probe();
    } else {
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      const sqliteVec = require("sqlite-vec") as { load: (db: unknown) => void };
      const db = new Database(":memory:");
      sqliteVec.load(db);
      db.prepare("SELECT vec_version() AS v").get();
      db.close();
    }
    return {
      id: "sqlite-vec",
      name: "sqlite-vec",
      status: "pass",
      message: "vector extension loaded",
    };
  } catch (err) {
    return {
      id: "sqlite-vec",
      name: "sqlite-vec",
      status: "warn",
      message: `unavailable (${err instanceof Error ? err.message : String(err)}); search will be keyword-only`,
      fix: "npm rebuild sqlite-vec  — FTS5 still works without it",
    };
  }
}

function checkOnnx(probe?: () => void): DoctorCheck {
  try {
    if (probe) {
      probe();
    } else {
      require("onnxruntime-node");
    }
    return {
      id: "onnxruntime",
      name: "onnxruntime-node",
      status: "pass",
      message: "native module loaded",
    };
  } catch (err) {
    return {
      id: "onnxruntime",
      name: "onnxruntime-node",
      status: "warn",
      message: `unavailable (${err instanceof Error ? err.message : String(err)}); embeddings may fall back to FTS-only`,
      fix: "npm rebuild onnxruntime-node  or set COURSECOPILOT_MODEL_PATH to a local MiniLM dir",
    };
  }
}

function checkDatabase(): DoctorCheck {
  const path = getDbPath();
  try {
    const opened = openDatabase({ path });
    const row = opened.db.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const integrity = row?.integrity_check ?? "ok";
    const version = opened.db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as {
      v: number | null;
    };
    opened.db.close();
    if (integrity !== "ok") {
      return {
        id: "db",
        name: "database",
        status: "fail",
        message: `integrity_check=${integrity} at ${path}`,
        fix: "Back up ~/.coursecopilot then `coursecopilot wipe --yes` if the file is corrupt",
      };
    }
    return {
      id: "db",
      name: "database",
      status: "pass",
      message: `${path} opens (schema v${version.v ?? "?"}${opened.vecEnabled ? ", vec on" : ", vec off"})`,
    };
  } catch (err) {
    return {
      id: "db",
      name: "database",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      fix: "Check COURSECOPILOT_HOME permissions and rebuild native modules",
    };
  }
}

async function checkEmbeddings(opts: DoctorOptions): Promise<DoctorCheck> {
  if (process.env.COURSECOPILOT_DISABLE_EMBEDDINGS === "1") {
    return {
      id: "embeddings",
      name: "embeddings",
      status: "warn",
      message: "COURSECOPILOT_DISABLE_EMBEDDINGS=1 (keyword-only)",
      fix: "Unset COURSECOPILOT_DISABLE_EMBEDDINGS to enable MiniLM vectors",
    };
  }
  const cached = isEmbeddingModelCached();
  const skip = opts.skipModelDownload || opts.offline;
  if (skip && cached) {
    return {
      id: "embeddings",
      name: "embeddings",
      status: "pass",
      message: `${EMBED_MODEL_ID} is cached`,
    };
  }
  if (skip && !cached) {
    return {
      id: "embeddings",
      name: "embeddings",
      status: "warn",
      message: `${EMBED_MODEL_ID} is not cached (offline doctor)`,
      fix: "Re-run `npx coursecopilot doctor` without --offline to download ~23 MB",
    };
  }
  try {
    const embedder = opts.embedder ?? createDefaultEmbedder();
    const ok = await embedder.ready();
    if (!ok) {
      return {
        id: "embeddings",
        name: "embeddings",
        status: "warn",
        message: "MiniLM failed to load; search will be keyword-only",
        fix: "Check onnxruntime-node, disk space, and HF_HOME / COURSECOPILOT_MODEL_PATH",
      };
    }
    return {
      id: "embeddings",
      name: "embeddings",
      status: "pass",
      message: `${EMBED_MODEL_ID} ready`,
    };
  } catch (err) {
    return {
      id: "embeddings",
      name: "embeddings",
      status: "warn",
      message: err instanceof Error ? err.message : String(err),
      fix: "Retry on a network, or set COURSECOPILOT_MODEL_PATH",
    };
  }
}

function checkClients(ctx: SetupContext): DoctorCheck[] {
  const detected = detectClients(ctx);
  return detected.map((d) => {
    if (!d.detected) {
      return {
        id: `client:${d.id}`,
        name: d.name,
        status: "skip",
        message: "not installed",
      };
    }
    const valid = clientHasValidEntry(d.id, ctx);
    if (valid.ok) {
      return {
        id: `client:${d.id}`,
        name: d.name,
        status: "pass",
        message: valid.message,
      };
    }
    return {
      id: `client:${d.id}`,
      name: d.name,
      status: "fail",
      message: valid.message,
      fix: `npx coursecopilot setup --client ${d.id}`,
    };
  });
}

async function checkCanvas(fetchFn?: FetchLike): Promise<DoctorCheck> {
  const creds = loadCanvasCredentials();
  if (!creds) {
    return {
      id: "canvas",
      name: "Canvas",
      status: "skip",
      message: "not configured",
      fix: "npx coursecopilot canvas connect   (optional; never stored in client configs)",
    };
  }
  try {
    const client = new CanvasClient({ credentials: creds, fetchFn });
    const self = await client.getSelf();
    return {
      id: "canvas",
      name: "Canvas",
      status: "pass",
      message: `token valid as ${self.name || `user ${self.id}`} @ ${creds.baseUrl}`,
    };
  } catch (err) {
    const detail =
      err instanceof CanvasApiError
        ? err.fallback
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      id: "canvas",
      name: "Canvas",
      status: "fail",
      message: detail,
      fix: "Create a new token at Account → Settings → Approved Integrations, then `canvas connect`",
    };
  }
}

function checkLeccap(): DoctorCheck {
  const session = loadSession("leccap");
  if (!session) {
    return {
      id: "leccap",
      name: "leccap session",
      status: "skip",
      message: "no session file",
      fix: "npx coursecopilot login leccap   (UMich CAEN Lecture Capture; optional)",
    };
  }
  if (session.cookies.length === 0) {
    return {
      id: "leccap",
      name: "leccap session",
      status: "fail",
      message: "session file has no cookies",
      fix: "npx coursecopilot login leccap",
    };
  }
  return {
    id: "leccap",
    name: "leccap session",
    status: "pass",
    message: `${session.cookies.length} cookie(s) on disk (passwords are never stored)`,
  };
}

async function checkRegistry(fetchFn?: FetchLike): Promise<DoctorCheck> {
  try {
    const client = new RegistryClient({ fetchFn, ttlMs: 0 });
    const index = await client.getIndex({ force: true });
    return {
      id: "registry",
      name: "pack registry",
      status: "pass",
      message: `${client.registryUrl()} (${index.packs.length} pack(s))`,
    };
  } catch (err) {
    return {
      id: "registry",
      name: "pack registry",
      status: "warn",
      message: err instanceof Error ? err.message : String(err),
      fix: "Check network, or set COURSECOPILOT_PACK_REGISTRY, or add-pack a local file / URL",
    };
  }
}

async function checkRemote(opts: DoctorOptions): Promise<DoctorCheck> {
  const origin = (opts.url || process.env.COURSECOPILOT_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!origin) {
    return {
      id: "remote",
      name: "remote MCP",
      status: "skip",
      message: "COURSECOPILOT_PUBLIC_URL not set",
      fix: "npx coursecopilot setup --remote   (or pass --url to doctor)",
    };
  }
  const secret = opts.secretPath || process.env.COURSECOPILOT_SECRET_PATH;
  const token = opts.token || process.env.COURSECOPILOT_TOKEN;
  const url = secret ? `${origin}/mcp/${secret}` : `${origin}/mcp`;
  try {
    const result = await probeMcpInitialize(url, {
      token: secret ? undefined : token,
      fetchFn: opts.remoteFetchFn ?? opts.fetchFn,
    });
    if (!result.ok) {
      return {
        id: "remote",
        name: "remote MCP",
        status: "fail",
        message: result.message,
        fix: "Confirm `coursecopilot serve --http` / tunnel is running and the URL is public HTTPS",
      };
    }
    return {
      id: "remote",
      name: "remote MCP",
      status: "pass",
      message: result.message,
    };
  } catch (err) {
    return {
      id: "remote",
      name: "remote MCP",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      fix: "Confirm the public URL answers MCP initialize",
    };
  }
}

export async function probeMcpInitialize(
  url: string,
  opts: { token?: string; fetchFn?: FetchLike } = {},
): Promise<{ ok: boolean; message: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
  };
  if (opts.token) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  const res = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "coursecopilot-doctor", version: VERSION },
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, message: `${url} → HTTP ${res.status} ${text.slice(0, 180)}` };
  }
  if (!/initialize|serverInfo|protocolVersion|coursecopilot|result/i.test(text)) {
    return {
      ok: false,
      message: `${url} → HTTP ${res.status} but body was not an MCP initialize result`,
    };
  }
  return { ok: true, message: `${url} answered MCP initialize (HTTP ${res.status})` };
}
