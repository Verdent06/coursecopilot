#!/usr/bin/env node
import { Command } from "commander";
import { generateRemoteSecrets } from "./remote/auth.js";
import { startQuickTunnel } from "./remote/tunnel.js";
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

program.parse();
