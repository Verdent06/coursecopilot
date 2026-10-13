import type { Citation } from "../retrieve/citation.js";
import { DEFAULT_PLAN_DAYS, MIN_MINUTES_PER_TOPIC } from "./config.js";

export type PlanActivity = "review" | "quiz" | "practice";

export type PlanSession = {
  topic: string;
  activity: PlanActivity;
  minutes: number;
  chunks: Citation[];
};

export type PlanDay = {
  date: string;
  sessions: PlanSession[];
};

export type StudyPlan = {
  days: PlanDay[];
  rationale: string;
};

export type PlanTopic = {
  name: string;
  weakness: number;
  chunks: Citation[];
};

const MS_PER_DAY = 86_400_000;

export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Calendar days from `now`'s UTC date to `examDate` (YYYY-MM-DD). */
export function daysUntilExam(examDate: string, now: Date): number {
  const exam = Date.parse(`${examDate}T00:00:00Z`);
  const today = Date.parse(`${utcDateString(now)}T00:00:00Z`);
  if (Number.isNaN(exam) || Number.isNaN(today)) {
    return DEFAULT_PLAN_DAYS;
  }
  return Math.round((exam - today) / MS_PER_DAY);
}

/**
 * Deterministic study plan (spec §11).
 *
 * D = days until the exam (default 7). Total minutes = minutes_per_day × D,
 * split across the weakest topics (min 15 min each). Weakest first. Each
 * topic gets review → quiz on a primary day, spaced review on day ⌈D/2⌉ and
 * day D−1, and day D is a mixed exam_sim (`practice`).
 */
export function buildStudyPlan(input: {
  topics: PlanTopic[];
  examName?: string;
  examDate?: string | null;
  days?: number;
  minutesPerDay: number;
  now: Date;
}): StudyPlan {
  const minutesPerDay = Math.max(1, Math.floor(input.minutesPerDay));
  let D: number;
  if (input.days != null) {
    D = Math.max(1, Math.floor(input.days));
  } else if (input.examDate) {
    D = Math.max(1, daysUntilExam(input.examDate, input.now));
  } else {
    D = DEFAULT_PLAN_DAYS;
  }

  const ranked = [...input.topics].sort(
    (a, b) => b.weakness - a.weakness || a.name.localeCompare(b.name),
  );
  const totalMinutes = minutesPerDay * D;
  const examMinutes = D > 1 ? minutesPerDay : Math.max(1, Math.round(minutesPerDay * 0.25));
  const topicPool = Math.max(MIN_MINUTES_PER_TOPIC, totalMinutes - examMinutes);
  const k = Math.min(ranked.length, Math.max(1, Math.floor(topicPool / MIN_MINUTES_PER_TOPIC)));
  const chosen = ranked.slice(0, k);
  const weights = chosen.map((t) => Math.max(0, t.weakness));
  const topicMinutes = allocateProportional(weights, topicPool, MIN_MINUTES_PER_TOPIC);

  const start = utcDateString(input.now);
  const days: PlanDay[] = [];
  for (let i = 0; i < D; i++) {
    days.push({ date: addUtcDays(start, i), sessions: [] });
  }

  const workingCount = D > 1 ? D - 1 : 1;
  const repeatDays = new Set<number>();
  if (D >= 2) {
    repeatDays.add(Math.ceil(D / 2));
    if (D - 1 >= 1) {
      repeatDays.add(D - 1);
    }
  }

  chosen.forEach((topic, idx) => {
    const primaryDay = (idx % workingCount) + 1;
    const sessionDays = new Set<number>([primaryDay]);
    for (const d of repeatDays) {
      if (d !== D || D === 1) {
        sessionDays.add(d);
      }
    }
    const orderedDays = [...sessionDays].filter((d) => d >= 1 && d <= (D > 1 ? D - 1 : 1)).sort();
    const slots: Array<{ day: number; activity: PlanActivity }> = [];
    for (const d of orderedDays) {
      if (d === primaryDay) {
        slots.push({ day: d, activity: "review" });
        slots.push({ day: d, activity: "quiz" });
      } else {
        slots.push({ day: d, activity: "review" });
      }
    }
    if (slots.length === 0) {
      slots.push({ day: 1, activity: "review" });
    }
    const split = splitMinutes(topicMinutes[idx] ?? MIN_MINUTES_PER_TOPIC, slots.length);
    slots.forEach((slot, s) => {
      const day = days[slot.day - 1];
      if (!day) {
        return;
      }
      day.sessions.push({
        topic: topic.name,
        activity: slot.activity,
        minutes: split[s] ?? 0,
        chunks: topic.chunks,
      });
    });
  });

  const last = days[D - 1];
  if (last) {
    const examSplit = splitMinutes(examMinutes, Math.max(1, chosen.length));
    if (chosen.length === 0) {
      last.sessions.push({
        topic: "mixed",
        activity: "practice",
        minutes: examMinutes,
        chunks: [],
      });
    } else if (D === 1) {
      last.sessions.push({
        topic: "mixed",
        activity: "practice",
        minutes: examMinutes,
        chunks: chosen.flatMap((t) => t.chunks).slice(0, 8),
      });
    } else {
      last.sessions.push({
        topic: "mixed",
        activity: "practice",
        minutes: examSplit.reduce((a, b) => a + b, 0),
        chunks: chosen.flatMap((t) => t.chunks).slice(0, 8),
      });
    }
  }

  for (const day of days) {
    day.sessions.sort(
      (a, b) =>
        activityOrder(a.activity) - activityOrder(b.activity) || a.topic.localeCompare(b.topic),
    );
  }

  const rationale = buildRationale({
    D,
    examName: input.examName,
    examDate: input.examDate,
    chosen,
    topicMinutes,
    minutesPerDay,
  });

  return { days, rationale };
}

export function allocateProportional(weights: number[], total: number, minEach: number): number[] {
  const n = weights.length;
  if (n === 0) {
    return [];
  }
  const floorTotal = minEach * n;
  if (total <= floorTotal) {
    const out = Array.from({ length: n }, () => minEach);
    return out;
  }
  const remaining = total - floorTotal;
  const sumW = weights.reduce((a, b) => a + b, 0) || n;
  const raw = weights.map((w) => (remaining * w) / sumW);
  const floors = raw.map((r) => Math.floor(r));
  let leftover = remaining - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.map((f) => f + minEach);
  for (const item of order) {
    if (leftover <= 0) {
      break;
    }
    const cur = out[item.i];
    if (cur == null) {
      continue;
    }
    out[item.i] = cur + 1;
    leftover -= 1;
  }
  return out;
}

function splitMinutes(total: number, parts: number): number[] {
  if (parts <= 1) {
    return [total];
  }
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

function activityOrder(activity: PlanActivity): number {
  if (activity === "review") {
    return 0;
  }
  if (activity === "quiz") {
    return 1;
  }
  return 2;
}

function buildRationale(input: {
  D: number;
  examName?: string;
  examDate?: string | null;
  chosen: PlanTopic[];
  topicMinutes: number[];
  minutesPerDay: number;
}): string {
  const exam =
    input.examName && input.examDate
      ? `${input.examName} on ${input.examDate}`
      : input.examDate
        ? `exam on ${input.examDate}`
        : "no exam set (planning 7 days; call set_exam to target a date — Canvas assignments named Midterm/Exam/Final are suggested after ingest, never auto-set)";
  const ranking = input.chosen
    .map(
      (t, i) => `${t.name} (${input.topicMinutes[i] ?? 0} min, weakness ${t.weakness.toFixed(3)})`,
    )
    .join("; ");
  return (
    `Plan covers ${input.D} day(s) at ${input.minutesPerDay} min/day for ${exam}. ` +
    `Topics ranked by weakness (forgetting Beta mastery × exam listing): ${ranking || "none"}. ` +
    "Each topic is review then quiz, with spaced repeats on day " +
    `⌈D/2⌉ and day D−1; the last day is a mixed exam_sim.`
  );
}
