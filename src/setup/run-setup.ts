import { connectCanvas } from "../canvas/connect.js";
import { runLoginCommand } from "../cli/login.js";
import { createDefaultEmbedder } from "../ingest/embed.js";
import { createAppContext } from "../server/index.js";
import { configureClaudeCode } from "./clients/claude-code.js";
import { configureClaudeDesktop } from "./clients/claude-desktop.js";
import { configureCursor } from "./clients/cursor.js";
import { configureGeminiCli } from "./clients/gemini-cli.js";
import { restartHints, webClientInstructions } from "./clients/web-instructions.js";
import { detectClients } from "./detect.js";
import { isInteractive, confirm as promptConfirm } from "./prompt.js";
import { type SetupRemoteHandle, startSetupRemote } from "./remote.js";
import { manualClientHelp, manualJsonSnippet } from "./snippet.js";
import type { LocalClientId, SetupContext } from "./types.js";
import { createSetupContext, parseClientIds } from "./types.js";
import { recordUndoSession, type UndoFile, undoLastSetup } from "./undo.js";

export type SetupCliOptions = {
  dryRun?: boolean;
  undo?: boolean;
  client?: string[] | string;
  remote?: boolean;
  yes?: boolean;
  canvas?: boolean;
  leccap?: boolean;
  pack?: string;
  downloadModel?: boolean;
  port?: number;
  token?: string;
  secretPath?: string;
  skipOptional?: boolean;
};

export type SetupWriter = (line: string) => void;

export type SetupDeps = {
  ctx?: SetupContext;
  confirm?: (question: string, defaultYes: boolean) => Promise<boolean>;
  ask?: (question: string) => Promise<string>;
  connectCanvasFn?: typeof connectCanvas;
  loginLeccapFn?: () => Promise<void>;
  addPackFn?: (id: string) => Promise<{ course_id: string; pack_id: string }>;
  downloadModelFn?: () => Promise<boolean>;
  startRemoteFn?: (opts: {
    port: number;
    token?: string;
    secretPath?: string;
  }) => Promise<SetupRemoteHandle>;
  out?: SetupWriter;
  err?: SetupWriter;
  interactive?: boolean;
  homeDir?: string;
};

export type ClientSetupResult = {
  id: LocalClientId;
  name: string;
  detected: boolean;
  configured: boolean;
  path: string;
  action?: string;
  error?: string;
  notes: string[];
  diff?: string;
  deeplink?: string;
};

export type SetupReport = {
  ok: boolean;
  clients: ClientSetupResult[];
  web: string;
  lines: string[];
  remote?: { origin: string; mcpUrl: string };
  remoteHandle?: SetupRemoteHandle;
};

export async function runSetup(
  cli: SetupCliOptions = {},
  deps: SetupDeps = {},
): Promise<SetupReport> {
  const write = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeErr = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const ctx = deps.ctx ?? createSetupContext();
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    write(line);
  };

  if (cli.undo) {
    const result = undoLastSetup(deps.homeDir);
    if (!result.ok) {
      writeErr(result.message);
      return { ok: false, clients: [], web: "", lines: [result.message] };
    }
    say("Restored the most recent setup backups:");
    for (const p of result.restored) {
      say(`  restored ${p}`);
    }
    for (const p of result.removed) {
      say(`  removed ${p} (created by setup)`);
    }
    if (result.restored.length === 0 && result.removed.length === 0) {
      say("  (nothing to apply — backups were already gone)");
    }
    return { ok: true, clients: [], web: "", lines };
  }

  let wanted: LocalClientId[] | undefined;
  try {
    wanted = parseClientIds(cli.client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErr(message);
    return { ok: false, clients: [], web: "", lines: [message] };
  }
  const detected = detectClients(ctx);
  say("CourseCopilot setup");
  say("");
  say("Local clients:");
  for (const d of detected) {
    const mark = d.detected ? "✓" : "·";
    const extra = d.detected ? ` (${d.reasons[0]})` : " (not found)";
    say(`  ${mark} ${d.name}${extra}`);
  }
  say("");

  const targets = detected.filter((d) => {
    if (wanted) {
      return wanted.includes(d.id);
    }
    return d.detected;
  });

  if (wanted && targets.length === 0) {
    writeErr(`No matching client for --client ${wanted.join(",")}`);
    return { ok: false, clients: [], web: "", lines };
  }

  if (!wanted && targets.length === 0) {
    say("No local clients detected. Writing nothing.");
    say("Install Claude Desktop, Claude Code, Cursor, or Gemini CLI and re-run,");
    say("or pass --client <id> to write a config anyway.");
    say("");
  }

  const undoFiles: UndoFile[] = [];
  const clientResults: ClientSetupResult[] = [];
  let ok = true;

  for (const target of targets) {
    const outcome = configureOne(target.id, ctx, Boolean(cli.dryRun));
    const result = outcome.result;
    const item: ClientSetupResult = {
      id: target.id,
      name: target.name,
      detected: target.detected,
      configured: result.ok,
      path: outcome.path,
      notes: outcome.notes,
      diff: outcome.diff,
      deeplink: "deeplink" in outcome ? outcome.deeplink : undefined,
    };
    if (!result.ok) {
      ok = false;
      item.error = result.message;
      say(`✗ ${target.name}`);
      say(`  ${result.message}`);
      say("  Manual snippet:");
      say(manualJsonSnippet(target.id));
    } else {
      item.action = result.action;
      const verb = cli.dryRun ? "would" : "did";
      say(`✓ ${target.name} (${verb} ${result.action} ${result.path})`);
      if (cli.dryRun && outcome.diff) {
        say(outcome.diff);
      }
      if (result.ok && result.backup) {
        undoFiles.push({ path: result.path, backup: result.backup });
      } else if (result.ok && result.action === "created" && !cli.dryRun) {
        undoFiles.push({ path: result.path, backup: null });
      }
      for (const note of outcome.notes) {
        for (const line of note.split("\n")) {
          say(`  ${line}`);
        }
      }
    }
    clientResults.push(item);
  }

  if (!cli.dryRun && undoFiles.length > 0) {
    recordUndoSession({ at: ctx.now.toISOString(), files: undoFiles }, deps.homeDir);
  }

  say("");
  const configured = clientResults.filter((c) => c.configured);
  for (const hint of restartHints(configured)) {
    say(hint);
  }

  let remoteHandle: SetupRemoteHandle | undefined;
  let remoteMeta: SetupReport["remote"];
  if (cli.remote && !cli.dryRun) {
    say("");
    say("Starting HTTP server + Cloudflare quick tunnel…");
    const start = deps.startRemoteFn ?? startSetupRemote;
    remoteHandle = await start({
      port: cli.port ?? 8787,
      token: cli.token,
      secretPath: cli.secretPath,
    });
    remoteMeta = { origin: remoteHandle.origin, mcpUrl: remoteHandle.mcpUrl };
    say(`Public origin: ${remoteHandle.origin}`);
  } else if (cli.remote && cli.dryRun) {
    say("");
    say("`--remote` dry-run: would start `serve --http` and `coursecopilot tunnel`.");
  }

  say("");
  const web = webClientInstructions({
    origin: remoteHandle?.origin,
    secretPath: remoteHandle?.secretPath ?? cli.secretPath,
    token: remoteHandle?.token ?? cli.token,
  });
  say(web);

  if (targets.length === 0) {
    say("");
    say(manualClientHelp());
  }

  const interactive = deps.interactive ?? isInteractive();
  const skipOptional = Boolean(cli.yes) || Boolean(cli.skipOptional) || !interactive;
  const confirmFn = deps.confirm ?? promptConfirm;

  if (!cli.dryRun) {
    const wantCanvas = cli.canvas || (!skipOptional && (await confirmFn("Connect Canvas?", false)));
    if (wantCanvas) {
      const connect = deps.connectCanvasFn ?? connectCanvas;
      const result = await connect({ yes: Boolean(cli.yes) && !interactive });
      if (result.ok) {
        say(`✓ Canvas connected as ${result.name} (${result.baseUrl})`);
        say(`  Token stored in ${result.secretsPath} (0600). Never written to client configs.`);
      } else {
        say(`Canvas connect skipped/failed: ${result.message}`);
      }
    }

    const wantLeccap =
      cli.leccap ||
      (!skipOptional && (await confirmFn("Log in to UMich Lecture Capture (leccap)?", false)));
    if (wantLeccap) {
      try {
        const login = deps.loginLeccapFn ?? (() => runLoginCommand("leccap", {}));
        await login();
        say("✓ leccap login finished (passwords were not stored).");
      } catch (err) {
        say(`leccap login failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let packId = cli.pack?.trim();
    const wantPack =
      Boolean(packId) ||
      (!skipOptional && (await confirmFn("Add a starter pack from the registry?", false)));
    if (wantPack) {
      if (!packId) {
        const askFn = deps.ask;
        packId = askFn
          ? (await askFn("Pack id [harvard-cs50x]: ")).trim() || "harvard-cs50x"
          : "harvard-cs50x";
      }
      try {
        const add =
          deps.addPackFn ??
          (async (id: string) => {
            const app = createAppContext({ allowLocalPaths: true, allowPrivateNetwork: true });
            try {
              const result = await app.packs.addPack(id);
              await app.queue.waitForIdle();
              return { course_id: result.course_id, pack_id: result.pack_id };
            } finally {
              app.opened.db.close();
            }
          });
        const installed = await add(packId);
        say(`✓ Installed pack ${installed.pack_id} → course ${installed.course_id}`);
      } catch (err) {
        say(`add-pack failed: ${err instanceof Error ? err.message : String(err)}`);
        ok = false;
      }
    }

    const wantModel =
      cli.downloadModel ||
      (!skipOptional && (await confirmFn("Pre-download the embedding model (~23 MB)?", true)));
    if (wantModel) {
      try {
        const dl =
          deps.downloadModelFn ??
          (async () => {
            const embedder = createDefaultEmbedder();
            return embedder.ready();
          });
        const ready = await dl();
        say(
          ready
            ? "✓ Embedding model ready (Xenova/all-MiniLM-L6-v2)."
            : "Embedding model unavailable; search will use keyword-only until it loads.",
        );
      } catch (err) {
        say(`Model download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  say("");
  say("Next:");
  say("  npx coursecopilot add-pack harvard-cs50x");
  say("  npx coursecopilot doctor");
  say("  Ask your AI: quiz me on what I missed");

  return {
    ok,
    clients: clientResults,
    web,
    lines,
    remote: remoteMeta,
    remoteHandle,
  };
}

function configureOne(id: LocalClientId, ctx: SetupContext, dryRun: boolean) {
  switch (id) {
    case "claude-desktop":
      return configureClaudeDesktop(ctx, { dryRun });
    case "claude-code":
      return configureClaudeCode(ctx, { dryRun });
    case "cursor":
      return configureCursor(ctx, { dryRun });
    case "gemini":
      return configureGeminiCli(ctx, { dryRun });
  }
}
