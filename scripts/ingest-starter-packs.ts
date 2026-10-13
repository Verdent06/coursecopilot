#!/usr/bin/env npx tsx
/**
 * Test-ingest every starter pack from a local path. Writes chunk counts as JSON.
 *
 * Usage: npx tsx scripts/ingest-starter-packs.ts [--out path] [--only id]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadStarterPacks } from "../src/packs/catalog.js";
import { createAppContext } from "../src/server/index.js";

const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : join(tmpdir(), "coursecopilot-pack-ingest.json");

type PackIngestResult = {
  id: string;
  course_id: string;
  chunks: number;
  sources: number;
  docs: number;
  jobs: Array<{ job_id: string; state: string; message: string; chunks: number; docs: number }>;
  skipped: Array<{ url: string; reason: string }>;
  error?: string;
};

process.env.COURSECOPILOT_DISABLE_EMBEDDINGS ??= "1";
process.env.COURSECOPILOT_CRAWL_DELAY_MS ??= "150";

const packs = loadStarterPacks().filter((p) => !only || p.manifest.id === only);
if (packs.length === 0) {
  process.stderr.write("No packs to ingest.\n");
  process.exit(1);
}

const results: PackIngestResult[] = [];

for (const pack of packs) {
  process.stderr.write(`\n=== ingest ${pack.manifest.id} ===\n`);
  const home = mkdtempSync(join(tmpdir(), `cc-pack-${pack.manifest.id}-`));
  const ctx = createAppContext({
    dbPath: join(home, "cc.db"),
    homeDir: home,
    allowLocalPaths: true,
    allowPrivateNetwork: true,
    crawlDelayMs: Number(process.env.COURSECOPILOT_CRAWL_DELAY_MS) || 150,
  });
  try {
    const added = await ctx.packs.addPack(pack.path);
    await ctx.queue.waitForIdle();
    const jobs = ctx.repo.listIngestStatus({ course_id: added.course_id });
    const course = ctx.repo.listCourses().find((c) => c.course_id === added.course_id);
    const docs = ctx.repo.listDocumentsForCourse(added.course_id);
    const row: PackIngestResult = {
      id: pack.manifest.id,
      course_id: added.course_id,
      chunks: course?.chunk_count ?? 0,
      sources: course?.source_count ?? 0,
      docs: docs.length,
      jobs: jobs.map((j) => ({
        job_id: j.job_id,
        state: j.state,
        message: j.message,
        chunks: j.chunks,
        docs: j.docs,
      })),
      skipped: added.skipped,
    };
    results.push(row);
    process.stderr.write(
      `  ${row.id}: ${row.chunks} chunks, ${row.docs} docs, ${row.sources} sources\n`,
    );
    for (const job of row.jobs) {
      process.stderr.write(`    ${job.state} ${job.message}\n`);
    }
    for (const skip of row.skipped) {
      process.stderr.write(`    skipped ${skip.url}: ${skip.reason}\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      id: pack.manifest.id,
      course_id: "",
      chunks: 0,
      sources: 0,
      docs: 0,
      jobs: [],
      skipped: [],
      error: message,
    });
    process.stderr.write(`  FAILED ${pack.manifest.id}: ${message}\n`);
  } finally {
    ctx.opened.db.close();
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${outPath}\n`);
const failed = results.filter((r) => r.error || r.chunks === 0);
if (failed.length > 0) {
  process.stderr.write(
    `${failed.length} pack(s) produced 0 chunks or errored: ${failed.map((f) => f.id).join(", ")}\n`,
  );
  process.exitCode = 1;
}
