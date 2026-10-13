import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { log } from "../util/log.js";
import { getHomeDir } from "../util/paths.js";

const RELEASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";

/** Apache-2.0 cloudflared assets: https://github.com/cloudflare/cloudflared */
export function cloudflaredAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === "linux" && arch === "x64") {
    return "cloudflared-linux-amd64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "cloudflared-linux-arm64";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "cloudflared-darwin-arm64.tgz";
  }
  if (platform === "darwin") {
    return "cloudflared-darwin-amd64.tgz";
  }
  if (platform === "win32") {
    return "cloudflared-windows-amd64.exe";
  }
  throw new Error(`No cloudflared binary for ${platform}-${arch}`);
}

export function parseQuickTunnelUrl(output: string): string | undefined {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match?.[0];
}

export function findCloudflaredOnPath(): string | undefined {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, ["cloudflared"], { encoding: "utf8" });
  if (r.status !== 0) {
    return undefined;
  }
  const line = r.stdout.trim().split(/\r?\n/)[0];
  return line && existsSync(line) ? line : undefined;
}

export function bundledCloudflaredPath(): string {
  const bin = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return join(getHomeDir(), "bin", bin);
}

export async function ensureCloudflared(): Promise<string> {
  const onPath = findCloudflaredOnPath();
  if (onPath) {
    return onPath;
  }
  const dest = bundledCloudflaredPath();
  if (existsSync(dest)) {
    return dest;
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  const asset = cloudflaredAssetName();
  const url = `${RELEASE}/${asset}`;
  log.info(`downloading cloudflared from ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download cloudflared (${res.status} ${res.statusText})`);
  }
  if (asset.endsWith(".tgz")) {
    const tmp = `${dest}.tgz`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const tar = spawnSync("tar", ["-xzf", tmp, "-C", join(dest, "..")], { encoding: "utf8" });
    if (tar.status !== 0) {
      throw new Error(`tar extract failed: ${tar.stderr}`);
    }
    const extracted = join(dest, "..", "cloudflared");
    if (extracted !== dest && existsSync(extracted)) {
      spawnSync(process.platform === "win32" ? "move" : "mv", [extracted, dest]);
    }
  } else {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  }
  if (process.platform !== "win32") {
    chmodSync(dest, 0o755);
  }
  return dest;
}

export type TunnelHandle = {
  url: string;
  child: ChildProcess;
  close: () => void;
};

/**
 * Run `cloudflared tunnel --url http://127.0.0.1:<port>` (a Cloudflare Quick
 * Tunnel). No Cloudflare account required. Hostname changes on every restart.
 * Quick Tunnels do not support SSE:
 * https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
 */
export async function startQuickTunnel(localPort: number): Promise<TunnelHandle> {
  const bin = await ensureCloudflared();
  const child = spawn(
    bin,
    ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for cloudflared quick-tunnel URL"));
    }, 45_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      buf += text;
      process.stderr.write(text);
      const found = parseQuickTunnelUrl(buf);
      if (found) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve(found);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited ${code} before printing a URL\n${buf}`));
    });
  });

  return {
    url,
    child,
    close: () => {
      child.kill("SIGTERM");
    },
  };
}
