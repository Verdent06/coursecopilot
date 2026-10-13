import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default async function setup(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (
    !existsSync(join(root, "dist", "cli.js")) ||
    !existsSync(join(root, "dist", "ingest", "embed-worker.js"))
  ) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
  if (process.env.COURSECOPILOT_DISABLE_EMBEDDINGS === "1") {
    return;
  }
  try {
    const { createDefaultEmbedder } = await import("../src/ingest/embed.ts");
    await createDefaultEmbedder().ready();
  } catch {
    // Offline or ONNX unavailable: unit tests use a stub; e2e degrades to FTS.
  }
}
