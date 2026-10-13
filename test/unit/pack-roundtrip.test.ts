import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashEmbedder } from "../../src/ingest/embed.js";
import { PackError } from "../../src/packs/schema.js";
import { wipeDatabaseFile } from "../../src/packs/wipe.js";
import { createAppContext } from "../../src/server/index.js";
import { fakeYoutubeClient } from "../helpers/fake-youtube.js";
import { writeFixtureSite } from "../helpers/fixture-site.js";
import { serveDirectory } from "../helpers/static-server.js";

describe("pack export → wipe → add-pack → search", () => {
  const temps: string[] = [];
  const closers: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a public website + YouTube playlist pack", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-pack-rt-"));
    temps.push(home);
    const siteDir = join(home, "site");
    await writeFixtureSite(siteDir);
    const server = await serveDirectory(siteDir);
    closers.push(() => server.close());

    const youtube = fakeYoutubeClient();
    const embedder = hashEmbedder();

    const ctx1 = createAppContext({
      dbPath: join(home, "cc.db"),
      homeDir: home,
      embedder,
      youtube,
      crawlDelayMs: 0,
      allowPrivateNetwork: true,
    });
    closers.push(() => {
      try {
        ctx1.opened.db.close();
      } catch {
        // already closed after wipe
      }
    });

    ctx1.repo.addCourse({ title: "EECS 3760", term: "F26", course_id: "eecs3760" });
    const web = ctx1.repo.insertSource({
      id: "src-web",
      course_id: "eecs3760",
      kind: "website",
      uri: `${server.baseUrl}/`,
      config_json: JSON.stringify({ max_depth: 3, max_pages: 40 }),
    });
    ctx1.queue.submit(web.id);
    const yt = ctx1.repo.insertSource({
      id: "src-yt",
      course_id: "eecs3760",
      kind: "youtube",
      uri: "https://www.youtube.com/playlist?list=PLtestplaylist1xx",
    });
    ctx1.queue.submit(yt.id);
    await ctx1.queue.waitForIdle();

    const before = ctx1.repo.listCourses()[0];
    expect(before?.chunk_count).toBeGreaterThan(0);

    const exported = ctx1.packs.exportPack("eecs3760");
    expect(exported.manifest.sources.some((s) => s.kind === "website")).toBe(true);
    expect(exported.manifest.sources.some((s) => s.kind === "youtube")).toBe(true);
    expect(exported.manifest.sources.every((s) => /^https?:\/\//.test(s.url))).toBe(true);

    const packPath = join(home, "roundtrip.json");
    writeFileSync(
      packPath,
      JSON.stringify(
        {
          ...exported.manifest,
          id: "roundtrip",
          topics: [
            {
              lecture: 7,
              title: "Pumping lemma",
              topics: ["Pumping lemma", "Nonregular languages"],
            },
          ],
        },
        null,
        2,
      ),
    );

    ctx1.opened.db.close();
    const wiped = wipeDatabaseFile(home);
    expect(wiped.removed).toBe(true);

    const ctx2 = createAppContext({
      dbPath: join(home, "cc.db"),
      homeDir: home,
      embedder,
      youtube,
      crawlDelayMs: 0,
      allowPrivateNetwork: true,
    });
    closers.push(() => ctx2.opened.db.close());

    expect(ctx2.repo.listCourses()).toEqual([]);
    const added = await ctx2.packs.addPack(packPath, { course_id: "eecs3760" });
    expect(added.pack_id).toBe("roundtrip");
    expect(added.job_ids.length).toBeGreaterThanOrEqual(2);
    await ctx2.queue.waitForIdle();

    const topics = ctx2.repo.listTopics("eecs3760");
    expect(topics.some((t) => t.name === "Pumping lemma" && t.origin === "pack")).toBe(true);
    expect(topics.some((t) => t.name === "Nonregular languages" && t.origin === "pack")).toBe(true);

    const pumping = topics.find((t) => t.name === "Pumping lemma");
    expect(pumping && ctx2.repo.listChunksForTopic(pumping.id).length).toBeGreaterThan(0);

    const found = await ctx2.search.search({
      query: "pumping lemma a to the n b to the n is not regular",
      course_id: "eecs3760",
      k: 5,
    });
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results[0]?.text).toMatch(/pumping lemma|not regular|a\^n b\^n/i);
    console.log(
      "pack roundtrip search",
      JSON.stringify(
        found.results.map((r) => ({
          score: r.score,
          label: r.citation.label,
          text: r.text.slice(0, 80),
        })),
        null,
        2,
      ),
    );
  }, 180_000);

  it("installs a fixture pack against the local site and applies the topic map", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-pack-add-"));
    temps.push(home);
    const siteDir = join(home, "site");
    await writeFixtureSite(siteDir);
    const server = await serveDirectory(siteDir);
    closers.push(() => server.close());

    mkdirSync(join(home, "packs"), { recursive: true });
    const packPath = join(home, "packs", "mini.json");
    writeFileSync(
      packPath,
      JSON.stringify({
        schema: 1,
        id: "mini",
        name: "Mini Automata Fixture",
        institution: "CourseCopilot Fixtures",
        term: "F26",
        version: "1.0.0",
        sources: [
          { kind: "website", url: `${server.baseUrl}/`, max_depth: 3, max_pages: 40 },
          { kind: "youtube", url: "https://www.youtube.com/playlist?list=PLtestplaylist1xx" },
        ],
        topics: [
          { lecture: 7, title: "Pumping lemma", topics: ["Pumping lemma", "Nonregular languages"] },
        ],
      }),
    );

    const ctx = createAppContext({
      dbPath: join(home, "cc.db"),
      homeDir: home,
      embedder: hashEmbedder(),
      youtube: fakeYoutubeClient(),
      crawlDelayMs: 0,
    });
    closers.push(() => ctx.opened.db.close());

    const result = await ctx.packs.addPack(packPath);
    expect(result.course_id).toBe("mini");
    await ctx.queue.waitForIdle();
    const jobs = ctx.repo.listIngestStatus({ course_id: "mini" });
    expect(jobs.every((j) => j.state === "done" || j.state === "partial")).toBe(true);
    expect(ctx.repo.listTopics("mini").filter((t) => t.origin === "pack").length).toBe(2);

    const listed = await ctx.packs.listPacks({ installed_only: true });
    expect(listed.packs).toEqual([
      expect.objectContaining({ id: "mini", installed: true, name: "Mini Automata Fixture" }),
    ]);

    await expect(ctx.packs.addPack(packPath)).rejects.toThrow(PackError);
  }, 180_000);
});
