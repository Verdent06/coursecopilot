#!/usr/bin/env npx tsx
/**
 * Validate every packs/<id>.json against the runtime schema (and JSON Schema)
 * and confirm packs/index.json is generated from those files.
 */
import { readFileSync } from "node:fs";
import { assertIndexInSync, loadStarterPacks, packSchemaPath } from "../src/packs/catalog.js";
import { parsePackDocument, rejectEmbeddedContent } from "../src/packs/schema.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const loaded = loadStarterPacks();
if (loaded.length === 0) {
  fail("No pack manifests found under packs/.");
}

const schemaPath = packSchemaPath();
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
  required?: string[];
  $defs?: { source?: { properties?: { kind?: { enum?: string[] } } } };
};
const required = schema.required ?? ["schema", "id", "name", "version", "sources"];
const sourceKinds = new Set(schema.$defs?.source?.properties?.kind?.enum ?? []);

for (const pack of loaded) {
  rejectEmbeddedContent(JSON.parse(readFileSync(pack.path, "utf8")));
  parsePackDocument(readFileSync(pack.path, "utf8"), pack.filename);
  const raw = JSON.parse(readFileSync(pack.path, "utf8")) as Record<string, unknown>;
  for (const key of required) {
    if (!(key in raw)) {
      fail(`${pack.filename}: missing required schema property "${key}"`);
    }
  }
  if (sourceKinds.size > 0) {
    const sources = Array.isArray(raw.sources) ? raw.sources : [];
    for (const source of sources) {
      if (!source || typeof source !== "object") {
        continue;
      }
      const kind = (source as { kind?: string }).kind;
      if (kind && !sourceKinds.has(kind)) {
        fail(`${pack.filename}: source kind "${kind}" is not in pack.schema.json`);
      }
    }
  }
}

try {
  assertIndexInSync();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

process.stdout.write(`Validated ${loaded.length} pack(s) against packs/schema/pack.schema.json.\n`);
