import type { AssessmentSummary } from "./types";

/**
 * Turning a flat history into the two views a teacher actually asks for.
 *
 * My Classroom and Assignments differ only in what they group on — a student or
 * a paper — so the reduction lives here once and each page supplies the key.
 * That also guarantees the two pages agree: a percentage on a student's row and
 * the same run's contribution to a paper's average come from one function.
 *
 * Only finished runs count towards any total. A run that stopped half way has a
 * real question count and a real mark of zero, and letting either into an
 * average would report a crash as a bad result.
 */

export interface Group {
  /** The student's name, or the paper's. */
  key: string;
  runs: AssessmentSummary[];
  /** Finished runs only — the ones every number below is computed from. */
  marked: number;
  /** Runs still going or stopped, surfaced so a group is never quietly short. */
  pending: number;
  questions: number;
  answered: number;
  unanswered: number;
  orphans: number;
  awarded: number;
  outOf: number;
  /** 0–1, or null when nothing carried marks. */
  score: number | null;
  /** Most recent activity in the group, ISO. Drives the ordering. */
  lastAt: string;
}

export type GroupField = "student" | "paper";

/**
 * Groups runs on one filing field.
 *
 * Runs with nothing in that field are returned separately rather than bundled
 * under an invented heading, because "unfiled" is an instruction to the teacher
 * — name these and they join a group — and a group called "Unknown" reads as a
 * student who exists.
 */
export function groupBy(
  items: AssessmentSummary[],
  field: GroupField
): { groups: Group[]; unfiled: AssessmentSummary[] } {
  const buckets = new Map<string, AssessmentSummary[]>();
  const unfiled: AssessmentSummary[] = [];

  for (const item of items) {
    const raw = item[field];
    const key = typeof raw === "string" ? raw.trim() : "";

    if (!key) {
      unfiled.push(item);
      continue;
    }

    // Keyed case-insensitively so "aarav sharma" and "Aarav Sharma" are one
    // student, but the first spelling seen is what gets displayed.
    const bucketKey = key.toLowerCase();
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(item);
    else buckets.set(bucketKey, [item]);
  }

  const groups = [...buckets.values()].map((bucket) => summariseGroup(bucket, field));

  // Most recently touched first: a teacher coming back mid-marking wants the
  // class they are in the middle of, not the alphabetically luckiest one.
  groups.sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  return { groups, unfiled };
}

function summariseGroup(runs: AssessmentSummary[], field: GroupField): Group {
  const ordered = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = ordered.filter((r) => r.step === "done");

  const outOf = done.reduce((n, r) => n + r.outOf, 0);
  const awarded = done.reduce((n, r) => n + r.awarded, 0);

  return {
    // Read off the field being grouped on, never off whichever is set: a paper
    // group whose runs also name students must still be titled by its paper.
    key: (ordered[0][field] ?? "").trim(),
    runs: ordered,
    marked: done.length,
    pending: ordered.length - done.length,
    questions: done.reduce((n, r) => n + r.questionCount, 0),
    answered: done.reduce((n, r) => n + r.answeredCount, 0),
    unanswered: done.reduce((n, r) => n + r.unansweredCount, 0),
    orphans: done.reduce((n, r) => n + r.orphanCount, 0),
    awarded,
    outOf,
    score: outOf > 0 ? awarded / outOf : null,
    lastAt: ordered[0].createdAt,
  };
}

/** "68%" — or a dash when nothing in the group carried marks. */
export function percent(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
