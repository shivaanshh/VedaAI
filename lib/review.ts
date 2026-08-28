import { findOrphans } from "./mapping";

import type { AnswerBlock, Grade, Mapping, Question, Review, Verdict } from "./types";

/** The parts of a record this module needs. Kept narrow so it stays testable. */
export interface Reviewable {
  questions: Question[];
  blocks: AnswerBlock[];
  mappings: Mapping[];
  grades: Grade[];
  reviews?: Review[] | null;
}

export interface Resolved {
  grades: Grade[];
  mappings: Mapping[];
  orphanBlockIds: string[];
}

export function reviewIndex(reviews: Review[] | null | undefined): Map<string, Review> {
  return new Map((reviews ?? []).map((r) => [r.questionId, r]));
}

/**
 * The verdict a mark implies.
 *
 * Recomputed rather than carried over, because the model's word for a mark it
 * no longer holds is wrong. Raising 0 to full marks and leaving the label on
 * "incorrect" would put a red chip on a right answer.
 */
export function verdictFor(
  awarded: number | null,
  max: number | null,
  answered: boolean
): Verdict {
  // A teacher can award marks to a question the matcher found no answer for —
  // they can see the sheet. Their mark decides, not the matcher.
  if (!answered && (awarded ?? 0) <= 0) return "unanswered";
  if (awarded === null || max === null || max <= 0) return "partial";
  if (awarded >= max) return "correct";
  if (awarded > 0) return "partial";
  return "incorrect";
}

/**
 * The assessment as it stands after every teacher correction.
 *
 * Every consumer that adds up marks goes through here — the history summary,
 * the per-question exam board, and both rails. An override that reached the
 * screen but not the class average would be worse than no override at all,
 * because the two numbers would disagree and neither would be wrong on its
 * face.
 */
export function resolve(r: Reviewable): Resolved {
  const reviews = reviewIndex(r.reviews);
  if (reviews.size === 0) {
    return { grades: r.grades, mappings: r.mappings, orphanBlockIds: findOrphans(r.blocks, r.mappings) };
  }

  const blockIds = new Set(r.blocks.map((b) => b.id));
  const gradeFor = new Map(r.grades.map((g) => [g.questionId, g]));
  const mappingFor = new Map(r.mappings.map((m) => [m.questionId, m]));

  const mappings: Mapping[] = [];
  const grades: Grade[] = [];

  for (const q of r.questions) {
    const review = reviews.get(q.id);
    const original = mappingFor.get(q.id) ?? null;

    /* ---- mapping ---- */

    let mapping: Mapping | null = original;

    if (review && review.answerBlockId !== undefined) {
      // A reassignment naming a block that no longer exists is stale rather
      // than meaningful — the run was re-extracted underneath it. Fall back to
      // the matcher instead of pointing a question at nothing.
      const target =
        review.answerBlockId === null || blockIds.has(review.answerBlockId)
          ? review.answerBlockId
          : (original?.answerBlockId ?? null);

      mapping = {
        questionId: q.id,
        answerBlockId: target,
        // A human looked at it. There is nothing left to be uncertain about,
        // so the "matched by content — worth a glance" hint correctly stops
        // appearing on rows that have already had the glance.
        confidence: 1,
        method: target === null ? "none" : "teacher",
      };
    }

    if (mapping) mappings.push(mapping);

    /* ---- grade ---- */

    const base = gradeFor.get(q.id) ?? null;
    if (!base && !review) continue;

    const answered = Boolean(mapping?.answerBlockId);
    const max = base?.max ?? q.marks ?? null;

    let awarded = base?.awarded ?? null;
    if (review?.awarded !== null && review?.awarded !== undefined) {
      awarded = clamp(review.awarded, max);
    } else if (review && review.answerBlockId === null && awarded !== null) {
      // The teacher says nothing answers this. Marks awarded for an answer
      // they just detached cannot stand.
      awarded = 0;
    }

    grades.push({
      questionId: q.id,
      awarded,
      max,
      verdict: verdictFor(awarded, max, answered),
      feedback: base?.feedback ?? "",
    });
  }

  // Questions the run never produced a mapping for still hold their place; any
  // mapping for a question no longer on the paper is dropped with it.
  return { grades, mappings, orphanBlockIds: findOrphans(r.blocks, mappings) };
}

/**
 * A mark within the bounds of the question.
 *
 * Guarded here as well as on write, because a stored value that predates a
 * re-extraction can be out of range through nobody's fault — the paper now
 * says the question is worth 4 where it used to say 6.
 */
function clamp(value: number, max: number | null): number {
  const n = Number.isFinite(value) ? value : 0;
  const lower = Math.max(0, n);
  return max !== null && max > 0 ? Math.min(lower, max) : lower;
}

/** Whether a review actually says anything. An empty one should be deleted, not stored. */
export function isEmptyReview(r: Pick<Review, "awarded" | "note" | "answerBlockId">): boolean {
  return r.awarded === null && !r.note && r.answerBlockId === undefined;
}
