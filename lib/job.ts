import type { JobState, JobStep } from "./types";

/**
 * Pure job arithmetic — batching, ordering and progress.
 *
 * Kept free of I/O so the client and the server agree on what "62% done" means
 * without either one deriving it independently, and so the state machine can be
 * tested without a database or an API key.
 */

/**
 * Pages per model request.
 *
 * Three is set by the deployment, not by taste: serverless request bodies cap
 * at 4.5 MB and base64 inflates an image by about a third, so three 1600px
 * JPEGs sit comfortably under the ceiling with room for a slow scanner.
 */
export const PAGE_BATCH = 3;

export function batchCount(pages: number): number {
  return Math.max(1, Math.ceil(pages / PAGE_BATCH));
}

/** The half-open page range a given batch covers. */
export function batchRange(cursor: number, totalPages: number): { from: number; to: number } {
  const from = Math.min(cursor * PAGE_BATCH, totalPages);
  return { from, to: Math.min(from + PAGE_BATCH, totalPages) };
}

/** Steps in the order they run. Terminal states are not part of the walk. */
export const STEP_ORDER: JobStep[] = [
  "uploading",
  "questions",
  "answers",
  "mapping",
  "grading",
];

/**
 * How much of the whole run each step accounts for.
 *
 * These are rough measurements, not guesses: reading handwriting is the slowest
 * leg by a wide margin, and mapping usually costs nothing at all because the
 * label pass resolves it without a model call.
 */
const WEIGHT: Record<string, number> = {
  uploading: 0.12,
  questions: 0.22,
  answers: 0.4,
  mapping: 0.08,
  grading: 0.18,
};

/** 0–1 across the whole run. */
export function jobProgress(job: JobState): number {
  if (job.step === "done") return 1;
  if (job.step === "failed") {
    // Freeze the bar where it stopped. The step that was running is in
    // `failedStep`, never in `step` — which by now reads "failed" and carries
    // no weight of its own, so reading it here parked every failure at the far
    // end of the bar regardless of how far the run had actually got.
    return completedWeight(job.failedStep ?? "uploading");
  }

  const within = job.total > 0 ? Math.min(1, job.cursor / job.total) : 0;
  return Math.min(0.99, completedWeight(job.step) + WEIGHT[job.step] * within);
}

function completedWeight(step: JobStep): number {
  let sum = 0;
  for (const s of STEP_ORDER) {
    if (s === step) break;
    sum += WEIGHT[s];
  }
  return sum;
}

export function isTerminal(step: JobStep): boolean {
  return step === "done" || step === "failed";
}

export function freshJob(): JobState {
  return {
    step: "uploading",
    cursor: 0,
    total: 0,
    detail: "Waiting for pages",
    error: null,
    startedAt: null,
    finishedAt: null,
    leaseUntil: null,
    failedStep: null,
  };
}

/** How long a worker may hold a run before it is considered abandoned. */
export const LEASE_MS = 90_000;

export function leaseHeld(job: JobState, now = Date.now()): boolean {
  if (!job.leaseUntil) return false;
  const until = Date.parse(job.leaseUntil);
  return Number.isFinite(until) && until > now;
}
