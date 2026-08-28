import { generateJSON, textPart } from "../ai/gemini";
import { MAPPING_SCHEMA, MAPPING_SYSTEM } from "../ai/prompts";
import { coalesceBlocks, findOrphans, labelPass, mergeSemantic } from "@/lib/mapping";
import type { AnswerBlock, Mapping, Question } from "@/lib/types";

/**
 * Answer-to-question matching, cheap pass first.
 *
 * Pass one is a string comparison over canonical labels: free, exact, and
 * order-independent, so a student who answers 7 before 3 needs no special path.
 * Pass two is a model call, and only ever sees what pass one could not claim.
 * The model is never asked to re-derive something a comparison already settled.
 */

/** Long transcriptions cost tokens without adding matching signal. */
const EXCERPT = 700;

export interface MatchResult {
  mappings: Mapping[];
  orphanBlockIds: string[];
  /** How the work split, for the progress detail line. */
  byLabel: number;
  bySemantic: number;
}

export async function matchAnswers(
  questions: Question[],
  rawBlocks: AnswerBlock[]
): Promise<MatchResult & { blocks: AnswerBlock[] }> {
  // An answer split across a batch boundary arrives as two blocks carrying the
  // same label. Rejoining them here is what makes one click light up both parts.
  const blocks = coalesceBlocks(rawBlocks);

  const pass1 = labelPass(questions, blocks);
  let mappings = pass1.mappings;
  let bySemantic = 0;

  if (pass1.unmatchedQuestions.length && pass1.unmatchedBlocks.length) {
    const proposals = await proposeMatches(pass1.unmatchedQuestions, pass1.unmatchedBlocks);

    const merged = mergeSemantic(
      pass1.mappings,
      proposals,
      new Set(pass1.unmatchedQuestions.map((q) => q.id)),
      new Set(pass1.unmatchedBlocks.map((b) => b.id))
    );

    bySemantic = merged.length - pass1.mappings.length;
    mappings = merged;
  }

  return {
    blocks,
    mappings,
    orphanBlockIds: findOrphans(blocks, mappings),
    byLabel: pass1.mappings.length,
    bySemantic,
  };
}

interface Proposal {
  questionId: string;
  blockId: string;
  confidence: number;
}

async function proposeMatches(
  questions: Question[],
  blocks: AnswerBlock[]
): Promise<Proposal[]> {
  const questionList = questions.map((q) => `[${q.id}] ${q.number} — ${q.text}`).join("\n");

  const blockList = blocks
    .map(
      (b) => `[${b.id}] label: ${b.writtenLabel ?? "(none written)"}\n${excerpt(b.transcription)}`
    )
    .join("\n\n");

  const result = await generateJSON<{ matches: Proposal[] }>({
    system: MAPPING_SYSTEM,
    parts: [
      textPart(`UNANSWERED QUESTIONS\n${questionList}`),
      textPart(`UNCLAIMED ANSWER BLOCKS\n${blockList}`),
      textPart(
        "Propose pairings. Use the bracketed ids exactly. Omit anything you cannot match with reasonable evidence."
      ),
    ],
    schema: MAPPING_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.1,
  });

  const questionIds = new Set(questions.map((q) => q.id));
  const blockIds = new Set(blocks.map((b) => b.id));

  // An id the model invented would map an answer onto nothing.
  return (result.matches ?? []).filter(
    (m) => questionIds.has(m?.questionId) && blockIds.has(m?.blockId)
  );
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > EXCERPT ? `${clean.slice(0, EXCERPT)}…` : clean;
}
