import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "db"), { recursive: true });
copyFileSync(join(root, "src", "db", "schema.sql"), join(root, "dist", "db", "schema.sql"));
