import { generateJSON, textPart } from "../ai/gemini";
import { GRADING_SCHEMA, GRADING_SYSTEM } from "../ai/prompts";
import type { AnswerBlock, Grade, Mapping, Question } from "@/lib/types";

/**
 * Marking, feedback, and one overall note on the script.
 *
 * Two rules matter more than the prompt does. The paper's own printed mark
 * allocation always outranks the model's guess at it — a question worth 2 marks
 * cannot be scored out of 5 because the model assumed otherwise. And because
 * every answer reaching this stage came through handwriting recognition, an
 * answer that looks wrong in a way a misread character would explain is marked
 * generously and flagged: the student should not lose marks for the OCR.
 */

export interface GradingResult {
  grades: Grade[];
  summary: string;
}

export async function gradeAssessment(
  questions: Question[],
  blocks: AnswerBlock[],
  mappings: Mapping[]
): Promise<GradingResult> {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const pairs = mappings
    .filter((m) => m.answerBlockId)
    .map((m) => {
      const q = questionById.get(m.questionId);
      const b = blockById.get(m.answerBlockId!);
      if (!q || !b) return null;
      return {
        questionId: q.id,
        number: q.number,
        question: q.text,
        marks: q.marks,
        answer: b.transcription,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const answeredIds = new Set(mappings.filter((m) => m.answerBlockId).map((m) => m.questionId));
  const unansweredQuestions = questions.filter((q) => !answeredIds.has(q.id));
  const unanswered = unansweredQuestions.map((q) => q.number);

  /**
   * A question nobody answered is still worth its printed marks, so it is
   * graded here rather than omitted.
   *
   * Every total in the product — both rails, the history list — is a sum over
   * this array. Leaving the gaps out of it reported a script that skipped a
   * 3-mark question as a flawless 7 out of 7: flattering, and wrong in the one
   * direction a teacher scanning the list would never think to check.
   *
   * The model is not asked for these. There is nothing to read, the verdict is
   * settled before any marking happens, and an unattempted question should not
   * cost a token or a chance to hallucinate credit.
   */
  const zeroGrades: Grade[] = unansweredQuestions.map((q) => ({
    questionId: q.id,
    awarded: 0,
    // Same fallback rule 2 of the prompt gives the model for an unmarked paper,
    // so answered and unanswered questions land in one comparable denominator.
    max: q.marks ?? 1,
    verdict: "unanswered",
    feedback: "",
  }));

  if (!pairs.length) {
    return {
      grades: zeroGrades,
      summary: unanswered.length
        ? "No answers could be matched to the paper. Every question is currently marked unanswered — worth checking that the right answer sheet was uploaded."
        : "There is nothing to mark yet.",
    };
  }

  const body = pairs
    .map(
      (p) =>
        `[${p.questionId}] ${p.number}${p.marks !== null ? ` (${p.marks} marks)` : ""}\n` +
        `Q: ${p.question}\n` +
        `A: ${p.answer || "(blank)"}`
    )
    .join("\n\n");

  const gaps = unanswered.length
    ? `Left unanswered: ${unanswered.join(", ")}.`
    : "The student attempted every question.";

  const result = await generateJSON<{
    grades: Array<{
      questionId: string;
      awarded: number;
      max: number;
      verdict: Grade["verdict"];
      feedback: string;
    }>;
    summary: string;
  }>({
    system: GRADING_SYSTEM,
    parts: [
      textPart(`ANSWERS TO MARK\n\n${body}`),
      textPart(gaps),
      textPart("Mark each answer using its bracketed id, then write the summary."),
    ],
    schema: GRADING_SCHEMA as unknown as Record<string, unknown>,
    // A little warmth here: feedback written at zero reads like a form letter.
    temperature: 0.3,
  });

  const printedMarks = new Map(pairs.map((p) => [p.questionId, p.marks]));

  const marked: Grade[] = (result.grades ?? [])
    .filter((g) => printedMarks.has(g?.questionId))
    .map((g) => {
      const printed = printedMarks.get(g.questionId);
      const max = printed ?? (Number.isFinite(g.max) ? g.max : 1);
      const awarded = Math.min(max, Math.max(0, Number(g.awarded) || 0));
      return {
        questionId: g.questionId,
        awarded,
        max,
        verdict: g.verdict,
        feedback: String(g.feedback ?? "").trim(),
      };
    });

  // Printed order, so the stored record reads down the paper the way the paper
  // does. Nothing displays off this ordering — both rails look grades up by id
  // — but the record is also the thing a human opens to check the run.
  const rank = new Map(questions.map((q) => [q.id, q.order]));
  const grades = [...marked, ...zeroGrades].sort(
    (a, b) => (rank.get(a.questionId) ?? 0) - (rank.get(b.questionId) ?? 0)
  );

  return { grades, summary: String(result.summary ?? "").trim() };
}
