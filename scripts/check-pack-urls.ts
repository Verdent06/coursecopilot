#!/usr/bin/env npx tsx
/**
 * Non-blocking link check: HEAD (then GET) every source URL in starter packs.
 * Warns on 4xx/5xx / network errors; exit 0 unless --strict.
 */
import { loadStarterPacks } from "../src/packs/catalog.js";

const STRICT = process.argv.includes("--strict");
const UA = "CourseCopilot/0.1.0 (+https://github.com/Verdent06/coursecopilot)";

type CheckResult = {
  pack: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

async function checkUrl(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "*/*" },
        signal: AbortSignal.timeout(20_000),
      });
      if (method === "HEAD" && (res.status === 405 || res.status === 403 || res.status === 501)) {
        continue;
      }
      if (res.ok || (res.status >= 300 && res.status < 400)) {
        return { ok: true, status: res.status };
      }
      if (method === "HEAD" && res.status >= 400) {
        continue;
      }
      return { ok: false, status: res.status };
    } catch (err) {
      if (method === "HEAD") {
        continue;
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: "HEAD and GET both failed" };
}

const loaded = loadStarterPacks();
const results: CheckResult[] = [];
for (const pack of loaded) {
  for (const source of pack.manifest.sources) {
    const result = await checkUrl(source.url);
    results.push({ pack: pack.manifest.id, url: source.url, ...result });
    const mark = result.ok ? "ok" : "WARN";
    const detail = result.ok
      ? `HTTP ${result.status ?? "?"}`
      : (result.error ?? `HTTP ${result.status ?? "?"}`);
    process.stdout.write(
      `${mark}  ${pack.manifest.id}  ${source.kind}  ${source.url}  ${detail}\n`,
    );
  }
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\nChecked ${results.length} URLs; ${failed.length} warning(s).\n`);
if (failed.length > 0 && STRICT) {
  process.exit(1);
}
