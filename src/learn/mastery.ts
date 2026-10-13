import {
  DEFAULT_EXAM_WEIGHT,
  DIFFICULTY_WEIGHT,
  EXAM_TOPIC_WEIGHT,
  HALF_LIFE_DAYS,
  HIGH_CONFIDENCE,
  MASTERY_PRIOR_ALPHA,
  MASTERY_PRIOR_BETA,
  NEVER_ATTEMPTED_BONUS,
  OVERCONFIDENCE_MULTIPLIER,
  WEAKNESS_VARIANCE_COEF,
} from "./config.js";

export type MasteryState = {
  alpha: number;
  beta: number;
  n_attempts: number;
  last_seen_at: string | null;
};

export type QuizEvidence = {
  correct: boolean;
  partial_credit?: number;
  difficulty?: number;
  confidence?: number;
};

const MS_PER_DAY = 86_400_000;

export function emptyMastery(): MasteryState {
  return {
    alpha: MASTERY_PRIOR_ALPHA,
    beta: MASTERY_PRIOR_BETA,
    n_attempts: 0,
    last_seen_at: null,
  };
}

/** Elapsed days since last_seen_at (fractional). 0 when never seen. */
export function daysSince(lastSeenAt: string | null, now: Date): number {
  if (!lastSeenAt) {
    return 0;
  }
  const then = Date.parse(lastSeenAt);
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.max(0, (now.getTime() - then) / MS_PER_DAY);
}

/**
 * Decay α, β toward the Beta(1,1) prior with half-life H (spec §11).
 * α' = 1 + (α−1)·2^(−d/H)
 */
export function decayTowardPrior(
  state: MasteryState,
  now: Date,
  halfLifeDays: number = HALF_LIFE_DAYS,
): { alpha: number; beta: number } {
  const d = daysSince(state.last_seen_at, now);
  if (d === 0 || halfLifeDays <= 0) {
    return { alpha: state.alpha, beta: state.beta };
  }
  const factor = 2 ** (-d / halfLifeDays);
  return {
    alpha: MASTERY_PRIOR_ALPHA + (state.alpha - MASTERY_PRIOR_ALPHA) * factor,
    beta: MASTERY_PRIOR_BETA + (state.beta - MASTERY_PRIOR_BETA) * factor,
  };
}

export function masteryMean(alpha: number, beta: number): number {
  const s = alpha + beta;
  return s === 0 ? 0.5 : alpha / s;
}

/** Beta distribution variance: αβ / [(α+β)² (α+β+1)]. */
export function betaVariance(alpha: number, beta: number): number {
  const s = alpha + beta;
  if (s <= 0) {
    return 0;
  }
  return (alpha * beta) / (s * s * (s + 1));
}

export function itemScore(item: QuizEvidence): number {
  if (item.partial_credit != null) {
    return clamp01(item.partial_credit);
  }
  return item.correct ? 1 : 0;
}

export function itemWeight(item: QuizEvidence): number {
  const diff = item.difficulty === 1 || item.difficulty === 3 ? item.difficulty : 2;
  let w = DIFFICULTY_WEIGHT[diff];
  const s = itemScore(item);
  if ((item.confidence ?? 0) >= HIGH_CONFIDENCE && s === 0) {
    w *= OVERCONFIDENCE_MULTIPLIER;
  }
  return w;
}

/** Decay then apply one quiz item. Persisted last_seen_at becomes `now`. */
export function applyQuizItem(state: MasteryState, item: QuizEvidence, now: Date): MasteryState {
  const decayed = decayTowardPrior(state, now);
  const s = itemScore(item);
  const w = itemWeight(item);
  return {
    alpha: decayed.alpha + w * s,
    beta: decayed.beta + w * (1 - s),
    n_attempts: state.n_attempts + 1,
    last_seen_at: now.toISOString(),
  };
}

/**
 * Weakness = (1 − mastery) + 0.5·√variance + 0.2·[never attempted]
 * then × 1.5 if an upcoming exam lists the topic.
 */
export function weaknessScore(input: {
  alpha: number;
  beta: number;
  n_attempts: number;
  examListed?: boolean;
}): number {
  const mean = masteryMean(input.alpha, input.beta);
  const variance = betaVariance(input.alpha, input.beta);
  const never = input.n_attempts === 0 ? NEVER_ATTEMPTED_BONUS : 0;
  const raw = 1 - mean + WEAKNESS_VARIANCE_COEF * Math.sqrt(Math.max(0, variance)) + never;
  const examWeight = input.examListed ? EXAM_TOPIC_WEIGHT : DEFAULT_EXAM_WEIGHT;
  return raw * examWeight;
}

export function readMastery(
  state: MasteryState,
  now: Date,
): {
  alpha: number;
  beta: number;
  mastery: number;
  uncertainty: number;
  n_attempts: number;
  last_seen_days: number | null;
} {
  const decayed = decayTowardPrior(state, now);
  return {
    alpha: decayed.alpha,
    beta: decayed.beta,
    mastery: masteryMean(decayed.alpha, decayed.beta),
    uncertainty: betaVariance(decayed.alpha, decayed.beta),
    n_attempts: state.n_attempts,
    last_seen_days: state.last_seen_at == null ? null : daysSince(state.last_seen_at, now),
  };
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}
