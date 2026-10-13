import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (!existsSync(join(root, "dist", "cli.js"))) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
}
