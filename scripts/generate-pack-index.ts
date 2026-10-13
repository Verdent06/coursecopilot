#!/usr/bin/env npx tsx
import { writeRegistryIndexFile } from "../src/packs/catalog.js";

const { path, index } = writeRegistryIndexFile();
process.stdout.write(`Wrote ${path} (${index.packs.length} packs)\n`);
