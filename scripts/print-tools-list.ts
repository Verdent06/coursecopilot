/**
 * One-shot MCP client: spawn dist/cli.js over stdio and print tools/list.
 * Used to capture protocol proof for the PR description.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "cc-tools-list-"));

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.COURSECOPILOT_HOME = home;

const client = new Client({ name: "tools-list", version: "0.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "cli.js")],
  cwd: root,
  env,
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  process.stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
  await client.close();
} finally {
  rmSync(home, { recursive: true, force: true });
}
