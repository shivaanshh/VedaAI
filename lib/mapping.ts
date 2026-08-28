import type { AnswerBlock, Mapping, Question } from "./types";
import { fuzzyCanonical } from "./normalize";

/**
 * Stage one of mapping: exact, cheap, and completely order-independent.
 *
 * Because both sides are reduced to a canonical key, a student who answers
 * question 7 before question 3 needs no special handling — the keys match
 * wherever they sit on the page. "Handle questions answered out of order" is
 * satisfied by never depending on order in the first place.
 *
 * Only what this pass cannot resolve is sent to the model.
 */

export interface LabelPassResult {
  mappings: Mapping[];
  unmatchedQuestions: Question[];
  unmatchedBlocks: AnswerBlock[];
}

/**
 * A student who writes "5" in two places is answering question 5 twice —
 * once, with an interruption. Merging them keeps the answer whole and lets
 * both regions light up together when the teacher clicks question 5.
 */
export function coalesceBlocks(blocks: AnswerBlock[]): AnswerBlock[] {
  const byKey = new Map<string, AnswerBlock>();
  const out: AnswerBlock[] = [];

  for (const block of blocks) {
    const key = block.canonical;

    if (!key) {
      // Unlabelled blocks are never merged; we have no evidence they belong
      // together, and the semantic pass may assign them to different questions.
      out.push(clone(block));
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      // Merge into a copy, never the caller's object: the record these came
      // from is persisted, and a re-run of this step must see the same input.
      const copy = clone(block);
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }

    existing.regions = [...existing.regions, ...block.regions];
    existing.transcription = `${existing.transcription.trim()}\n${block.transcription.trim()}`;
  }

  return out;
}

export function labelPass(
  questions: Question[],
  blocks: AnswerBlock[]
): LabelPassResult {
  const mappings: Mapping[] = [];
  const claimedBlocks = new Set<string>();
  const answeredQuestions = new Set<string>();

  const blocksByExact = new Map<string, AnswerBlock[]>();
  const blocksByFuzzy = new Map<string, AnswerBlock[]>();

  for (const block of blocks) {
    if (!block.canonical) continue;
    push(blocksByExact, block.canonical, block);
    push(blocksByFuzzy, fuzzyCanonical(block.writtenLabel), block);
  }

  // Pass 1a — exact key equality.
  for (const q of questions) {
    const candidate = firstFree(blocksByExact.get(q.canonical), claimedBlocks);
    if (!candidate) continue;

    mappings.push({
      questionId: q.id,
      answerBlockId: candidate.id,
      confidence: 1,
      method: "label",
    });
    claimedBlocks.add(candidate.id);
    answeredQuestions.add(q.id);
  }

  // Pass 1b — repair digits that handwriting recognition turned into letters,
  // so a student's "ll(a)" still finds question "11 (a)".
  for (const q of questions) {
    if (answeredQuestions.has(q.id)) continue;

    const key = fuzzyCanonical(q.number);
    const candidate = firstFree(blocksByFuzzy.get(key), claimedBlocks);
    if (!candidate) continue;

    mappings.push({
      questionId: q.id,
      answerBlockId: candidate.id,
      // Not a certainty — a character was repaired to get here.
      confidence: 0.9,
      method: "label",
    });
    claimedBlocks.add(candidate.id);
    answeredQuestions.add(q.id);
  }

  return {
    mappings,
    unmatchedQuestions: questions.filter((q) => !answeredQuestions.has(q.id)),
    unmatchedBlocks: blocks.filter((b) => !claimedBlocks.has(b.id)),
  };
}

/** Applies the model's proposals on top of the label pass, enforcing 1:1. */
export function mergeSemantic(
  base: Mapping[],
  proposals: Array<{ questionId: string; blockId: string; confidence: number }>,
  validQuestionIds: Set<string>,
  validBlockIds: Set<string>
): Mapping[] {
  const takenQuestions = new Set(base.map((m) => m.questionId));
  const takenBlocks = new Set(
    base.map((m) => m.answerBlockId).filter((id): id is string => Boolean(id))
  );

  const merged = [...base];

  // Strongest proposals win the contested slots.
  const sorted = [...proposals].sort((a, b) => b.confidence - a.confidence);

  for (const p of sorted) {
    if (!validQuestionIds.has(p.questionId)) continue;
    if (!validBlockIds.has(p.blockId)) continue;
    if (takenQuestions.has(p.questionId)) continue;
    if (takenBlocks.has(p.blockId)) continue;

    merged.push({
      questionId: p.questionId,
      answerBlockId: p.blockId,
      confidence: clamp01(p.confidence),
      method: "semantic",
    });
    takenQuestions.add(p.questionId);
    takenBlocks.add(p.blockId);
  }

  return merged;
}

/** Blocks nothing claimed — the student answered something not on the paper. */
export function findOrphans(blocks: AnswerBlock[], mappings: Mapping[]): string[] {
  const claimed = new Set(
    mappings.map((m) => m.answerBlockId).filter((id): id is string => Boolean(id))
  );
  return blocks.filter((b) => !claimed.has(b.id)).map((b) => b.id);
}

/* ---------------------------- helpers ---------------------------- */

function clone(block: AnswerBlock): AnswerBlock {
  return { ...block, regions: block.regions.map((r) => ({ ...r, box: { ...r.box } })) };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function firstFree(
  candidates: AnswerBlock[] | undefined,
  claimed: Set<string>
): AnswerBlock | null {
  if (!candidates) return null;
  return candidates.find((b) => !claimed.has(b.id)) ?? null;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
