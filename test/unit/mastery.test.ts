import { describe, expect, it } from "vitest";
import {
  applyQuizItem,
  betaVariance,
  decayTowardPrior,
  emptyMastery,
  itemScore,
  itemWeight,
  masteryMean,
  readMastery,
  weaknessScore,
} from "../../src/learn/mastery.js";

const now = new Date("2026-10-13T00:00:00.000Z");

describe("mastery math (spec §11 goldens)", () => {
  it("prior Beta(1,1) has mastery 0.5 and variance 1/12", () => {
    const prior = emptyMastery();
    expect(masteryMean(prior.alpha, prior.beta)).toBe(0.5);
    expect(betaVariance(prior.alpha, prior.beta)).toBeCloseTo(1 / 12, 12);
  });

  it("correct difficulty-2 updates α += 1", () => {
    const after = applyQuizItem(emptyMastery(), { correct: true, difficulty: 2 }, now);
    expect(after.alpha).toBeCloseTo(2, 12);
    expect(after.beta).toBeCloseTo(1, 12);
    expect(masteryMean(after.alpha, after.beta)).toBeCloseTo(2 / 3, 12);
    expect(after.n_attempts).toBe(1);
  });

  it("wrong difficulty-2 updates β += 1", () => {
    const after = applyQuizItem(emptyMastery(), { correct: false, difficulty: 2 }, now);
    expect(after.alpha).toBeCloseTo(1, 12);
    expect(after.beta).toBeCloseTo(2, 12);
    expect(masteryMean(after.alpha, after.beta)).toBeCloseTo(1 / 3, 12);
  });

  it("uses partial_credit when given, weighted by difficulty 3 (w=1.3)", () => {
    expect(itemScore({ correct: true, partial_credit: 0.5 })).toBe(0.5);
    expect(itemWeight({ correct: false, difficulty: 3 })).toBeCloseTo(1.3, 12);
    const after = applyQuizItem(
      emptyMastery(),
      { correct: true, partial_credit: 0.5, difficulty: 3 },
      now,
    );
    expect(after.alpha).toBeCloseTo(1 + 1.3 * 0.5, 12);
    expect(after.beta).toBeCloseTo(1 + 1.3 * 0.5, 12);
    expect(masteryMean(after.alpha, after.beta)).toBeCloseTo(0.5, 12);
  });

  it("overconfidence: high confidence + wrong multiplies weight by 1.2", () => {
    expect(itemWeight({ correct: false, difficulty: 2, confidence: 3 })).toBeCloseTo(1.2, 12);
    const after = applyQuizItem(
      emptyMastery(),
      { correct: false, difficulty: 2, confidence: 3 },
      now,
    );
    expect(after.alpha).toBeCloseTo(1, 12);
    expect(after.beta).toBeCloseTo(2.2, 12);
  });

  it("decay at half-life 10 days halves the distance to the prior", () => {
    const state = {
      alpha: 3,
      beta: 1,
      n_attempts: 4,
      last_seen_at: "2026-10-03T00:00:00.000Z",
    };
    const decayed = decayTowardPrior(state, now);
    expect(decayed.alpha).toBeCloseTo(2, 12);
    expect(decayed.beta).toBeCloseTo(1, 12);
    expect(masteryMean(decayed.alpha, decayed.beta)).toBeCloseTo(2 / 3, 12);
  });

  it("never-attempted weakness includes the 0.2 bonus; two wrongs rank higher", () => {
    const never = weaknessScore({ alpha: 1, beta: 1, n_attempts: 0 });
    expect(never).toBeCloseTo(0.5 + 0.5 * Math.sqrt(1 / 12) + 0.2, 12);

    let state = emptyMastery();
    state = applyQuizItem(state, { correct: false, difficulty: 2 }, now);
    state = applyQuizItem(state, { correct: false, difficulty: 2 }, now);
    const twoWrong = weaknessScore({
      alpha: state.alpha,
      beta: state.beta,
      n_attempts: state.n_attempts,
    });
    expect(state.alpha).toBeCloseTo(1, 12);
    expect(state.beta).toBeCloseTo(3, 12);
    expect(twoWrong).toBeGreaterThan(never);
    expect(twoWrong).toBeCloseTo(0.75 + 0.5 * Math.sqrt(0.0375), 12);
  });

  it("exam listing multiplies weakness by 1.5", () => {
    const base = weaknessScore({ alpha: 1, beta: 3, n_attempts: 2 });
    const listed = weaknessScore({ alpha: 1, beta: 3, n_attempts: 2, examListed: true });
    expect(listed).toBeCloseTo(base * 1.5, 12);
  });

  it("readMastery reports last_seen_days and applies decay without mutating n_attempts", () => {
    const state = {
      alpha: 3,
      beta: 1,
      n_attempts: 2,
      last_seen_at: "2026-10-03T00:00:00.000Z",
    };
    const read = readMastery(state, now);
    expect(read.n_attempts).toBe(2);
    expect(read.last_seen_days).toBeCloseTo(10, 8);
    expect(read.mastery).toBeCloseTo(2 / 3, 12);
  });
});
