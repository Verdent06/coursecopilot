#!/usr/bin/env node
/**
 * CI guard: CourseCopilot never calls an LLM. Fail if banned SDKs appear in deps.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BANNED = ["openai", "@anthropic-ai/sdk", "@google/genai", "anthropic"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };

const hits = BANNED.filter((name) => Object.hasOwn(deps, name));
if (hits.length > 0) {
  console.error(`Forbidden LLM SDK(s) in package.json: ${hits.join(", ")}`);
  process.exit(1);
}

let lock = "";
try {
  lock = readFileSync(join(root, "package-lock.json"), "utf8");
} catch {
  // lockfile absent (e.g. mid-install)
}
for (const name of BANNED) {
  if (lock.includes(`"node_modules/${name}"`)) {
    console.error(`Forbidden LLM SDK in package-lock.json: ${name}`);
    process.exit(1);
  }
}

console.log("No LLM SDKs in dependencies.");
