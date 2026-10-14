import { type Dirent, existsSync, lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RepoError } from "../db/repo.js";
import { FOLDER_FILE_CAP } from "../ingest/config.js";

/** Resolve a file:// URI or absolute filesystem path to an absolute path. */
export function resolveLocalPath(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new RepoError("uri is required");
  }
  if (/^file:/i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      throw new RepoError(
        `Invalid file URI "${uri}". Use an absolute file:// URL or filesystem path.`,
      );
    }
  }
  if (!isAbsolute(trimmed)) {
    throw new RepoError(
      `Path must be absolute. Got "${uri}". In remote mode, local file paths are disabled unless --allow-path is set.`,
    );
  }
  return trimmed;
}

export function toFileUri(absPath: string): string {
  return pathToFileURL(absPath).href;
}

/** True when `absPath` is the trusted prefix or a file inside it. */
export function isTrustedPath(absPath: string, prefix?: string): boolean {
  if (!prefix) {
    return false;
  }
  const root = resolve(prefix);
  const target = resolve(absPath);
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export function assertExists(absPath: string): void {
  if (!existsSync(absPath)) {
    throw new RepoError(`Path does not exist: ${absPath}`);
  }
}

export type WalkResult = {
  files: string[];
  truncated: boolean;
};

/**
 * Recurse a directory. Ignores dotfiles/dot-dirs and symlinks. Stops after `cap` files.
 */
export function walkFiles(root: string, cap: number = FOLDER_FILE_CAP): WalkResult {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      break;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, ent.name);
      let isSymlink = ent.isSymbolicLink();
      if (!isSymlink) {
        try {
          isSymlink = lstatSync(full).isSymbolicLink();
        } catch {
          continue;
        }
      }
      if (isSymlink) {
        continue;
      }
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        if (files.length >= cap) {
          return { files, truncated: true };
        }
        files.push(full);
      }
    }
  }
  return { files, truncated: false };
}
