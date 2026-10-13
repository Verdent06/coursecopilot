#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURSOR_INSTALL_BADGE_SRC,
  claudeCodeOneLiner,
  cursorDeeplink,
  cursorHttpsInstallUrl,
  cursorInstallBadgeMarkdown,
  decodeCursorDeeplink,
  geminiCliOneLiner,
  PUBLISHED_STDIO_SPEC,
} from "../src/setup/command.js";

const check = process.argv.includes("--check");
const deeplink = cursorDeeplink(PUBLISHED_STDIO_SPEC);
const httpsUrl = cursorHttpsInstallUrl();
const badge = cursorInstallBadgeMarkdown();
const decoded = decodeCursorDeeplink(deeplink);

if (decoded.name !== "coursecopilot") {
  throw new Error(`deeplink name ${decoded.name}`);
}
if (
  decoded.config.command !== PUBLISHED_STDIO_SPEC.command ||
  JSON.stringify(decoded.config.args) !== JSON.stringify(PUBLISHED_STDIO_SPEC.args)
) {
  throw new Error("deeplink config does not decode to npx -y coursecopilot@latest");
}

if (check) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  if (
    !readme.includes(CURSOR_INSTALL_BADGE_SRC) ||
    !readme.includes("install-mcp?name=coursecopilot")
  ) {
    throw new Error("README is missing the Cursor install badge");
  }
  const httpsDecoded = decodeCursorDeeplink(httpsUrl);
  if (httpsDecoded.name !== decoded.name) {
    throw new Error("HTTPS install URL name mismatch");
  }
  process.stdout.write("Cursor install link OK\n");
  process.exit(0);
}

process.stdout.write(`${deeplink}\n`);
process.stdout.write(`${httpsUrl}\n`);
process.stdout.write(`${badge}\n`);
process.stdout.write(`${claudeCodeOneLiner()}\n`);
process.stdout.write(`${geminiCliOneLiner()}\n`);
