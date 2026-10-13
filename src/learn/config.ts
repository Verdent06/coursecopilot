/** Learning-layer knobs (spec §11). Tunable; not research-validated. */

/** Beta prior α, β for a new (course, topic). */
export const MASTERY_PRIOR_ALPHA = 1;
export const MASTERY_PRIOR_BETA = 1;

/** Forgetting half-life in days: α' = 1 + (α−1)·2^(−d/H). */
export const HALF_LIFE_DAYS = 10;

/** Quiz-item weight by difficulty 1..3. */
export const DIFFICULTY_WEIGHT: Record<1 | 2 | 3, number> = {
  1: 0.7,
  2: 1.0,
  3: 1.3,
};

/** Self-report confidence treated as "high" (overconfidence penalty). */
export const HIGH_CONFIDENCE = 3;

/** Multiply item weight when high confidence and the answer is wrong. */
export const OVERCONFIDENCE_MULTIPLIER = 1.2;

/** Coefficient on √(Beta variance) in the weakness score. */
export const WEAKNESS_VARIANCE_COEF = 0.5;

/** Added to weakness when n_attempts = 0. */
export const NEVER_ATTEMPTED_BONUS = 0.2;

/** Multiply weakness when an upcoming exam lists the topic. */
export const EXAM_TOPIC_WEIGHT = 1.5;

/** Default exam-weight multiplier when the topic is not on an upcoming exam. */
export const DEFAULT_EXAM_WEIGHT = 1.0;

/** Days to plan for when no exam date is set. */
export const DEFAULT_PLAN_DAYS = 7;

/** Default study minutes per day. */
export const DEFAULT_MINUTES_PER_DAY = 60;

/** Minimum minutes assigned to each chosen plan topic. */
export const MIN_MINUTES_PER_TOPIC = 15;

/** Suggested source chunks per topic (weak spots, plan, quiz item). */
export const SUGGESTED_CHUNKS = 2;

/** Default generate_quiz_context n. */
export const DEFAULT_QUIZ_N = 5;

/** Max generate_quiz_context n. */
export const MAX_QUIZ_N = 20;

/** Default get_weak_spots limit. */
export const DEFAULT_WEAK_LIMIT = 5;

/** Versioned quiz-writing instructions returned by generate_quiz_context. */
export const QUIZ_INSTRUCTIONS_VERSION = 1;

export function quizInstructions(n: number, difficulty?: number): string {
  const diff = difficulty == null ? "" : ` Target difficulty ${difficulty} of 3 (1=easy, 3=hard).`;
  return (
    `Write ${n} questions using ONLY the provided chunks. Each question must cite its chunk_id(s). ` +
    "Mix multiple-choice and short-answer. Ask one at a time; after the user answers, grade it, " +
    "show the citation, and when the quiz ends call record_quiz_attempt with all items." +
    diff
  );
}
