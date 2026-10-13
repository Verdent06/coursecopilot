import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { SERVER_NAME, VERSION } from "../version.js";
import { PUBLISHED_STDIO_SPEC } from "./command.js";

export type McpbManifest = {
  manifest_version: string;
  name: string;
  display_name?: string;
  version: string;
  description: string;
  author: { name: string; url?: string; email?: string };
  repository?: { type: string; url: string };
  license?: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
  user_config?: Record<string, unknown>;
  compatibility?: Record<string, unknown>;
  tools_generated?: boolean;
  keywords?: string[];
};

export type PackMcpbResult = {
  outputPath: string;
  stagingDir: string;
  usedOfficialCli: boolean;
  validated: boolean;
  cliMessage?: string;
};

export function repoRootFromHere(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function readMcpbManifest(root: string): McpbManifest {
  const raw = readFileSync(join(root, "manifest.json"), "utf8");
  return JSON.parse(raw) as McpbManifest;
}

/** mcp_config must match the published npx stdio entry (native modules stay on npm). */
export function assertManifestLaunchConfig(manifest: McpbManifest): void {
  const { command, args } = manifest.server.mcp_config;
  if (command !== PUBLISHED_STDIO_SPEC.command) {
    throw new Error(`manifest mcp_config.command must be ${PUBLISHED_STDIO_SPEC.command}`);
  }
  if (JSON.stringify(args) !== JSON.stringify(PUBLISHED_STDIO_SPEC.args)) {
    throw new Error(
      `manifest mcp_config.args must be ${JSON.stringify(PUBLISHED_STDIO_SPEC.args)}`,
    );
  }
  if (manifest.name !== SERVER_NAME) {
    throw new Error(`manifest name must be ${SERVER_NAME}`);
  }
}

export function findMcpbCli(root: string): string | undefined {
  const binName = process.platform === "win32" ? "mcpb.cmd" : "mcpb";
  const local = join(root, "node_modules", ".bin", binName);
  if (existsSync(local)) {
    return local;
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["mcpb"], {
    encoding: "utf8",
  });
  if (which.status === 0) {
    const line = which.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return line || undefined;
  }
  return undefined;
}

function runMcpb(
  bin: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const isCmd = bin.endsWith(".cmd") || bin.endsWith(".bat");
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    shell: isCmd,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "." || name === "..") {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function copyDistRuntime(srcDist: string, destDist: string): void {
  mkdirSync(destDist, { recursive: true });
  for (const file of listFilesRecursive(srcDist)) {
    const ext = extname(file);
    if (ext === ".map" || ext === ".ts") {
      continue;
    }
    const rel = relative(srcDist, file);
    const dest = join(destDist, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
}

export function stageMcpbDirectory(root: string, stagingDir: string, manifest: McpbManifest): void {
  mkdirSync(stagingDir, { recursive: true });
  const stagedManifest: McpbManifest = {
    ...manifest,
    version: VERSION,
    name: SERVER_NAME,
  };
  writeFileSync(join(stagingDir, "manifest.json"), `${JSON.stringify(stagedManifest, null, 2)}\n`);
  copyFileSync(join(root, "LICENSE"), join(stagingDir, "LICENSE"));
  copyFileSync(join(root, "README.md"), join(stagingDir, "README.md"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
    type?: string;
    bin?: unknown;
    engines?: unknown;
    license?: string;
  };
  writeFileSync(
    join(stagingDir, "package.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: VERSION,
        type: pkg.type ?? "module",
        bin: pkg.bin,
        engines: pkg.engines,
        license: pkg.license ?? "MIT",
        description: stagedManifest.description,
      },
      null,
      2,
    )}\n`,
  );
  const dist = join(root, "dist");
  if (existsSync(join(dist, "cli.js"))) {
    copyDistRuntime(dist, join(stagingDir, "dist"));
  }
  writeFileSync(
    join(stagingDir, ".mcpbignore"),
    ["*.map", "*.ts", "node_modules", ".git", "test", "src"].join("\n"),
  );
}

async function zipStagingDir(stagingDir: string, outputPath: string): Promise<void> {
  const zip = new JSZip();
  for (const file of listFilesRecursive(stagingDir)) {
    const rel = relative(stagingDir, file).split("\\").join("/");
    if (rel === ".mcpbignore") {
      continue;
    }
    zip.file(rel, readFileSync(file));
  }
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buf);
}

export async function packMcpbBundle(
  options: { repoRoot?: string; outputPath?: string; keepStaging?: boolean } = {},
): Promise<PackMcpbResult> {
  const root = options.repoRoot ?? repoRootFromHere();
  const outputPath = resolve(options.outputPath ?? join(root, `${SERVER_NAME}.mcpb`));
  const manifest = readMcpbManifest(root);
  assertManifestLaunchConfig(manifest);
  const stagingDir = mkdtempSync(join(tmpdir(), "cc-mcpb-"));
  try {
    stageMcpbDirectory(root, stagingDir, manifest);
    const cli = findMcpbCli(root);
    let usedOfficialCli = false;
    let validated = false;
    let cliMessage: string | undefined;
    if (cli) {
      const validate = runMcpb(cli, ["validate", join(stagingDir, "manifest.json")], stagingDir);
      cliMessage = `${validate.stdout}${validate.stderr}`.trim();
      if (validate.status === 0) {
        validated = true;
        const packed = runMcpb(cli, ["pack", stagingDir, outputPath], root);
        cliMessage = `${cliMessage}\n${packed.stdout}${packed.stderr}`.trim();
        if (packed.status === 0 && existsSync(outputPath)) {
          usedOfficialCli = true;
        } else {
          await zipStagingDir(stagingDir, outputPath);
        }
      } else {
        await zipStagingDir(stagingDir, outputPath);
      }
    } else {
      await zipStagingDir(stagingDir, outputPath);
    }
    return { outputPath, stagingDir, usedOfficialCli, validated, cliMessage };
  } finally {
    if (!options.keepStaging) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}
