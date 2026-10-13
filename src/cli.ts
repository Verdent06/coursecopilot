#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { runLoginCommand } from "./cli/login.js";
import { RepoError } from "./db/repo.js";
import { stringifyManifest } from "./packs/install.js";
import { PackError } from "./packs/schema.js";
import { wipeCourse, wipeDatabaseFile } from "./packs/wipe.js";
import { generateRemoteSecrets } from "./remote/auth.js";
import { startQuickTunnel } from "./remote/tunnel.js";
import { createAppContext } from "./server/index.js";
import { formatConnectorHelp, startHttpServer } from "./server/transport-http.js";
import { startStdio } from "./server/transport-stdio.js";
import { log } from "./util/log.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("coursecopilot")
  .description(
    "CourseCopilot MCP server — your classes, inside the AI you already use. No API key.",
  )
  .version(VERSION)
  .action(() => {
    startStdio();
  });

program
  .command("serve")
  .description("Run the MCP server. Pass --http for Streamable HTTP (web clients).")
  .option("--http", "Serve Streamable HTTP instead of stdio")
  .option("--port <n>", "HTTP port", process.env.PORT ?? "8787")
  .option(
    "--bind <addr>",
    "Bind address (default 127.0.0.1; 0.0.0.0 when PORT is set)",
    process.env.COURSECOPILOT_BIND ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
  )
  .option("--token <token>", "Bearer token (or COURSECOPILOT_TOKEN)")
  .option("--secret-path <token>", "Secret URL path token (or COURSECOPILOT_SECRET_PATH)")
  .option("--allow-path", "Allow local file/folder sources over HTTP", false)
  .option("--public-url <url>", "Public origin for OAuth metadata (COURSECOPILOT_PUBLIC_URL)")
  .option("--no-oauth", "Disable single-user OAuth (Gemini Spark needs OAuth)")
  .option("--oauth-auto-approve", "Skip the OAuth consent page (tests only)", false)
  .action(async (opts: Record<string, unknown>) => {
    if (!opts.http) {
      log.info(
        "stdio is the default command (`coursecopilot` with no args). Pass --http for remote mode.",
      );
      startStdio();
      return;
    }
    const generated = generateRemoteSecrets();
    const token =
      (typeof opts.token === "string" && opts.token) ||
      process.env.COURSECOPILOT_TOKEN ||
      generated.token;
    const secretPath =
      (typeof opts.secretPath === "string" && opts.secretPath) ||
      process.env.COURSECOPILOT_SECRET_PATH ||
      token;
    const allowPath = Boolean(opts.allowPath) || process.env.COURSECOPILOT_ALLOW_PATH === "1";
    const oauthEnv = process.env.COURSECOPILOT_OAUTH;
    const oauth = opts.oauth !== false && oauthEnv !== "0";
    const handle = await startHttpServer({
      port: Number(opts.port),
      bind: String(opts.bind),
      token,
      secretPath,
      allowLocalPaths: allowPath,
      publicUrl:
        (typeof opts.publicUrl === "string" && opts.publicUrl) ||
        process.env.COURSECOPILOT_PUBLIC_URL,
      oauth,
      oauthAutoApprove: Boolean(opts.oauthAutoApprove),
    });
    process.stderr.write(
      `${formatConnectorHelp(handle.origin, handle.secretPath, handle.token)}\n`,
    );
    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });

program
  .command("tunnel")
  .description("Expose a local HTTP server via a Cloudflare quick tunnel (trycloudflare.com).")
  .option("--port <n>", "Local HTTP port to serve and tunnel", process.env.PORT ?? "8787")
  .option("--token <token>", "Bearer token (or COURSECOPILOT_TOKEN)")
  .option("--secret-path <token>", "Secret URL path token")
  .option("--allow-path", "Allow local file/folder sources over HTTP", false)
  .option("--no-oauth", "Disable single-user OAuth")
  .option("--no-serve", "Do not start the HTTP server; tunnel an already-running one")
  .action(async (opts: Record<string, unknown>) => {
    const port = Number(opts.port);
    const generated = generateRemoteSecrets();
    const token =
      (typeof opts.token === "string" && opts.token) ||
      process.env.COURSECOPILOT_TOKEN ||
      generated.token;
    const secretPath =
      (typeof opts.secretPath === "string" && opts.secretPath) ||
      process.env.COURSECOPILOT_SECRET_PATH ||
      token;
    let closeServer: (() => Promise<void>) | undefined;
    if (opts.serve !== false) {
      const handle = await startHttpServer({
        port,
        bind: "127.0.0.1",
        token,
        secretPath,
        allowLocalPaths: Boolean(opts.allowPath),
        oauth: opts.oauth !== false,
      });
      closeServer = handle.close;
    }
    log.info("starting Cloudflare quick tunnel (hostname changes every restart)");
    const tunnel = await startQuickTunnel(port);
    process.stderr.write(`\nPublic origin: ${tunnel.url}\n\n`);
    process.stderr.write(`${formatConnectorHelp(tunnel.url, secretPath, token)}\n`);
    process.stderr.write(
      "\nQuick Tunnels do not support SSE. If a client needs GET streams, use Render/Fly.\nNamed tunnels: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/\n",
    );
    const shutdown = async () => {
      tunnel.close();
      await closeServer?.();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });

program
  .command("login")
  .description(
    "Sign in to a lecture-capture provider in a real browser. Passwords are never stored.",
  )
  .argument("<provider>", "Provider id (currently: leccap)")
  .option(
    "--cookies <file>",
    "Import cookies from a Netscape cookies.txt or Playwright storageState JSON instead of opening a browser",
  )
  .action(async (provider: string, opts: { cookies?: string }) => {
    await runLoginCommand(provider, opts);
  });

program
  .command("add-pack")
  .description("Install a course pack from a registry id, URL, or local manifest path.")
  .argument("<pack>", "Pack id (registry), http(s) URL, or local .json/.yaml path")
  .option("--course-id <id>", "Override the course slug")
  .option("--registry <url>", "Registry index URL (or COURSECOPILOT_PACK_REGISTRY)")
  .action(async (pack: string, opts: { courseId?: string; registry?: string }) => {
    const ctx = createAppContext({
      registryUrl: opts.registry,
    });
    try {
      const result = await ctx.packs.addPack(pack, { course_id: opts.courseId });
      process.stderr.write(
        `Installing ${result.pack_id} as ${result.course_id} (${result.job_ids.length} source job(s))\n`,
      );
      for (const skip of result.skipped) {
        process.stderr.write(`  skipped ${skip.url}: ${skip.reason}\n`);
      }
      await ctx.queue.waitForIdle();
      const jobs = ctx.repo.listIngestStatus({ course_id: result.course_id });
      for (const job of jobs) {
        process.stderr.write(`  ${job.job_id}: ${job.state} — ${job.message}\n`);
      }
      const course = ctx.repo.listCourses().find((c) => c.course_id === result.course_id);
      process.stdout.write(
        `Installed ${result.pack_id} → ${result.course_id}` +
          (course ? ` (${course.chunk_count} chunks, ${course.source_count} sources)\n` : "\n"),
      );
    } catch (err) {
      failCli(err);
    } finally {
      ctx.opened.db.close();
    }
  });

program
  .command("export-pack")
  .description(
    "Write a shareable pack manifest (links + topic map). Drops Canvas, leccap, and local files.",
  )
  .argument("<course>", "Course id to export")
  .option(
    "-o, --out <file>",
    "Write JSON/YAML to this path (default: stdout + ~/.coursecopilot/exports)",
  )
  .option("--include-local-paths", "Mention local file paths under connect_yourself", false)
  .action((course: string, opts: { out?: string; includeLocalPaths?: boolean }) => {
    const ctx = createAppContext();
    try {
      const exported = ctx.packs.exportPack(course, {
        include_local_paths: Boolean(opts.includeLocalPaths),
      });
      for (const warning of exported.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }
      const text = stringifyManifest(exported.manifest);
      if (opts.out) {
        const dest = resolve(opts.out);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, text, "utf8");
        process.stdout.write(`${dest}\n`);
      } else {
        const dest = ctx.packs.defaultExportPath(exported.manifest.id);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, text, "utf8");
        process.stdout.write(text);
        process.stderr.write(`also wrote ${dest}\n`);
      }
    } catch (err) {
      failCli(err);
    } finally {
      ctx.opened.db.close();
    }
  });

program
  .command("list-packs")
  .description("List packs from the registry index (cached 24h) and locally installed packs.")
  .argument("[query]", "Optional substring filter")
  .option("--installed", "Only show packs already installed", false)
  .option("--registry <url>", "Registry index URL")
  .action(async (query: string | undefined, opts: { installed?: boolean; registry?: string }) => {
    const ctx = createAppContext({ registryUrl: opts.registry });
    try {
      const { packs } = await ctx.packs.listPacks({
        query,
        installed_only: Boolean(opts.installed),
      });
      if (packs.length === 0) {
        process.stdout.write("No packs found.\n");
        return;
      }
      for (const pack of packs) {
        const bits = [
          pack.id,
          pack.name,
          pack.term ?? "",
          pack.institution ?? "",
          `${pack.source_count} sources`,
          pack.installed ? "installed" : "",
          pack.verified ? "verified" : "",
        ].filter(Boolean);
        process.stdout.write(`${bits.join("  ")}\n`);
      }
    } catch (err) {
      failCli(err);
    } finally {
      ctx.opened.db.close();
    }
  });

program
  .command("wipe")
  .description("Delete local CourseCopilot data (the SQLite DB, or one course).")
  .option("--course <id>", "Delete only this course")
  .option("--yes", "Confirm deletion", false)
  .action((opts: { course?: string; yes?: boolean }) => {
    if (!opts.yes) {
      process.stderr.write("Refusing to wipe without --yes.\n");
      process.exitCode = 1;
      return;
    }
    if (opts.course) {
      const ctx = createAppContext();
      try {
        wipeCourse(ctx.repo, opts.course);
        process.stdout.write(`Wiped course ${opts.course}\n`);
      } catch (err) {
        failCli(err);
      } finally {
        ctx.opened.db.close();
      }
      return;
    }
    const result = wipeDatabaseFile();
    process.stdout.write(
      result.removed ? `Wiped ${result.path}\n` : `No database at ${result.path}\n`,
    );
  });

function failCli(err: unknown): never {
  const message =
    err instanceof PackError || err instanceof RepoError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await program.parseAsync(process.argv);
