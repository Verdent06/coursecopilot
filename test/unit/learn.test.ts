import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashEmbedder } from "../../src/ingest/embed.js";
import { ingestFileSource } from "../../src/ingest/sources/file.js";
import { extractAndAssignTopics } from "../../src/ingest/topics.js";
import { LearnService } from "../../src/learn/service.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { openMemory } from "../helpers/memory-db.js";
import { writeSampleFolder } from "../helpers/sample-files.js";

const now = () => new Date("2026-10-13T00:00:00.000Z");

describe("learning layer service", () => {
  const temps: string[] = [];
  const closers: Array<() => void> = [];

  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function seed() {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", term: "F26", course_id: "eecs376-f26" });
    const dir = mkdtempSync(join(tmpdir(), "cc-learn-"));
    temps.push(dir);
    const sample = await writeSampleFolder(dir);
    const source = repo.insertSource({
      id: "src1",
      course_id: "eecs376-f26",
      kind: "folder",
      uri: sample.dir,
    });
    await ingestFileSource({ repo, allowLocalPaths: true }, source.id);
    const embedder = hashEmbedder();
    const search = new HybridSearch(repo, embedder, opened.vecEnabled);
    const learn = new LearnService(repo, search, embedder, now);
    return { repo, learn, search };
  }

  it("set_topics + two misses on A puts A first in weak_spots and the study plan", async () => {
    const { repo, learn } = await seed();
    const chunks = repo.listChunksForCourse("eecs376-f26");
    const pumping = chunks.filter((c) => /pumping lemma|a\^n b\^n/i.test(c.text));
    const office = chunks.filter((c) => /office hours/i.test(c.text));
    expect(pumping.length).toBeGreaterThan(0);
    expect(office.length).toBeGreaterThan(0);

    const topics = await learn.setTopics({
      course_id: "eecs376-f26",
      topics: [
        { name: "Pumping lemma", chunk_ids: pumping.map((c) => c.id) },
        { name: "Office hours", chunk_ids: office.map((c) => c.id) },
      ],
    });
    expect(topics.topic_ids).toHaveLength(2);

    const quiz = await learn.generateQuizContext({
      course_id: "eecs376-f26",
      n: 3,
      focus: "all",
    });
    expect(quiz.items.length).toBe(3);
    expect(quiz.instructions).toMatch(/record_quiz_attempt/);
    expect(quiz.items.some((i) => i.chunks.length > 0)).toBe(true);
    expect(quiz.items.some((i) => i.chunks[0]?.citation.label)).toBe(true);

    const beforeSpots = await learn.getWeakSpots("eecs376-f26", 5);
    expect(beforeSpots.spots.map((s) => s.topic)).toEqual(
      expect.arrayContaining(["Pumping lemma", "Office hours"]),
    );

    const recorded = learn.recordQuizAttempt({
      course_id: "eecs376-f26",
      mode: "quiz",
      items: [
        {
          topic: "Pumping lemma",
          question: "State the pumping lemma.",
          user_answer: "idk",
          correct: false,
          difficulty: 2,
          cited_chunk_ids: pumping[0] ? [pumping[0].id] : [],
        },
        {
          topic: "Pumping lemma",
          question: "Prove a^n b^n is not regular.",
          user_answer: "it is regular",
          correct: false,
          difficulty: 2,
        },
        {
          topic: "Office hours",
          question: "When are office hours?",
          user_answer: "Tuesdays at 3pm",
          correct: true,
          difficulty: 1,
        },
      ],
    });
    expect(recorded.attempt_id).toMatch(/^qa_/);
    const pumpingDelta = recorded.mastery_delta.find(
      (d) => d.topic.toLowerCase() === "pumping lemma",
    );
    expect(pumpingDelta).toBeTruthy();
    expect(pumpingDelta?.after).toBeLessThan(pumpingDelta?.before ?? 1);

    const afterSpots = await learn.getWeakSpots("eecs376-f26", 5);
    expect(afterSpots.spots[0]?.topic.toLowerCase()).toBe("pumping lemma");
    expect(afterSpots.spots[0]?.n_attempts).toBe(2);
    expect(afterSpots.spots[0]?.suggested_chunks.length).toBeGreaterThan(0);

    repo.setExam({
      course_id: "eecs376-f26",
      name: "Midterm",
      date: "2026-10-20",
      topics: ["Pumping lemma"],
      weight: 0.25,
    });
    const plan = await learn.getStudyPlan({
      course_id: "eecs376-f26",
      exam_name: "Midterm",
      minutes_per_day: 60,
    });
    const minutes = (name: string) =>
      plan.days
        .flatMap((d) => d.sessions)
        .filter((s) => s.topic.toLowerCase() === name.toLowerCase())
        .reduce((n, s) => n + s.minutes, 0);
    expect(minutes("Pumping lemma")).toBeGreaterThan(minutes("Office hours"));
    expect(plan.days.at(-1)?.sessions.some((s) => s.activity === "practice")).toBe(true);
  });

  it("heuristic extracts Pumping Lemma from the sample folder", async () => {
    const { repo } = await seed();
    const topics = await extractAndAssignTopics(repo, "eecs376-f26", hashEmbedder());
    const names = topics.map((t) => t.name.toLowerCase());
    expect(names.some((n) => n.includes("pumping"))).toBe(true);
  });
});
