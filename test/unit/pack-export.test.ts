import { describe, expect, it } from "vitest";
import { exportPackFromCourse } from "../../src/packs/export.js";
import { nowIso } from "../../src/util/time.js";
import { openMemory } from "../helpers/memory-db.js";

describe("export-pack filters", () => {
  it("keeps website/youtube/http transcripts and drops canvas, leccap, and local files", () => {
    const { repo } = openMemory();
    repo.addCourse({ title: "EECS 376", term: "F26", course_id: "eecs376-f26" });
    repo.insertSource({
      id: "s-web",
      course_id: "eecs376-f26",
      kind: "website",
      uri: "https://eecs376.org/",
      status: "done",
    });
    repo.insertSource({
      id: "s-yt",
      course_id: "eecs376-f26",
      kind: "youtube",
      uri: "https://www.youtube.com/playlist?list=PLpublic",
      status: "done",
    });
    repo.insertSource({
      id: "s-vtt",
      course_id: "eecs376-f26",
      kind: "transcript",
      uri: "https://example.edu/lec.vtt",
      status: "done",
    });
    repo.insertSource({
      id: "s-canvas",
      course_id: "eecs376-f26",
      kind: "canvas",
      uri: "canvas://course/123",
      status: "done",
    });
    repo.insertSource({
      id: "s-leccap",
      course_id: "eecs376-f26",
      kind: "website",
      uri: "https://leccap.engin.umich.edu/leccap/viewer/r/abc",
      status: "done",
    });
    repo.insertSource({
      id: "s-file",
      course_id: "eecs376-f26",
      kind: "file",
      uri: "/tmp/notes.pdf",
      status: "done",
    });
    repo.upsertTopic({
      id: "t1",
      course_id: "eecs376-f26",
      name: "Pumping lemma",
      origin: "pack",
    });
    repo.upsertPack({
      id: "eecs376-f26",
      course_id: "eecs376-f26",
      version: "1.0.0",
      origin: "path",
      manifest_json: JSON.stringify({
        schema: 1,
        id: "eecs376-f26",
        name: "EECS 376",
        institution: "UMich",
        version: "1.0.0",
        sources: [],
        topics: [{ lecture: 7, title: "Pumping lemma", topics: ["Pumping lemma"] }],
      }),
      installed_at: nowIso(),
    });

    const { manifest, warnings } = exportPackFromCourse(repo, "eecs376-f26");
    expect(manifest.sources.map((s) => s.kind).sort()).toEqual([
      "transcript",
      "website",
      "youtube",
    ]);
    expect(manifest.sources.some((s) => /leccap|canvas|tmp/.test(s.url))).toBe(false);
    expect(manifest.connect_yourself?.map((c) => c.kind).sort()).toEqual([
      "canvas",
      "lecture_capture",
      "local_files",
    ]);
    expect(manifest.connect_yourself?.some((c) => /token/i.test(c.message))).toBe(true);
    expect(manifest.connect_yourself?.some((c) => /VTT|transcript/i.test(c.message))).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(manifest.topics?.[0]?.topics).toContain("Pumping lemma");
    expect(JSON.stringify(manifest)).not.toMatch(/pumping lemma proof/i);
  });

  it("refuses to export a course that only has gated/local sources", () => {
    const { repo } = openMemory();
    repo.addCourse({ title: "Private", course_id: "priv" });
    repo.insertSource({
      id: "s1",
      course_id: "priv",
      kind: "canvas",
      uri: "canvas://course/1",
    });
    expect(() => exportPackFromCourse(repo, "priv")).toThrow(/no exportable/i);
  });
});
