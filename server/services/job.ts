import { repo } from "../db";
import { extractAnswers, extractQuestions, type PageInput } from "./extraction";
import { gradeAssessment } from "./grading";
import { matchAnswers } from "./matching";
import { requireAssessment } from "./assessments";
import { batchCount, batchRange, isTerminal, leaseHeld, LEASE_MS } from "@/lib/job";
import { withLock } from "./lock";
import { canonicalize } from "@/lib/normalize";
import type {
  AnswerBlock,
  AssessmentRecord,
  JobState,
  PageKind,
  PageMeta,
  Question,
} from "@/lib/types";

/**
 * The state machine that walks a run from uploaded pages to a marked script.
 *
 * One call does one unit of work and persists the result. That shape is forced
 * by the 60-second serverless ceiling — a full script needs several minutes of
 * model time — but it pays for itself three times over: progress reflects work
 * that actually completed, a dropped connection costs one batch instead of the
 * whole run, and reloading the page resumes rather than restarting.
 */

export async function advance(id: string): Promise<AssessmentRecord> {
  return withLock(id, () => advanceOnce(id));
}

async function advanceOnce(id: string): Promise<AssessmentRecord> {
  const record = await requireAssessment(id);

  if (isTerminal(record.job.step)) return record;

  // Someone else is mid-batch. Hand back the current state unchanged; the
  // client sees no movement and waits rather than starting a duplicate call.
  if (leaseHeld(record.job)) return record;

  // Claim the run before doing anything slow. The claim is a single write, so
  // the window in which two instances could both claim it is milliseconds
  // wide rather than the twenty-odd seconds a model call takes.
  await repo().update(id, {
    job: { ...record.job, leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() },
  });

  try {
    switch (record.job.step) {
      case "uploading":
        return await beginExtraction(record);
      case "questions":
        return await questionBatch(record);
      case "answers":
        return await answerBatch(record);
      case "mapping":
        return await mappingStep(record);
      case "grading":
        return await gradingStep(record);
      default:
        return record;
    }
  } catch (err) {
    return fail(record, (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

async function beginExtraction(record: AssessmentRecord): Promise<AssessmentRecord> {
  if (!record.questionPages.length) {
    return fail(record, "The question paper produced no readable pages.");
  }
  if (!record.answerPages.length) {
    return fail(record, "The answer sheet produced no readable pages.");
  }

  return save(record.id, {
    job: {
      ...record.job,
      step: "questions",
      cursor: 0,
      total: batchCount(record.questionPages.length),
      detail: "Finding questions",
      startedAt: new Date().toISOString(),
    },
  });
}

async function questionBatch(record: AssessmentRecord): Promise<AssessmentRecord> {
  const pages = await loadBatch(record, "question", record.job.cursor);
  const raw = await extractQuestions(pages);

  // Batches run in page order and results are appended, so the array is already
  // in printed order. `order` freezes that, and nothing downstream re-sorts.
  const base = record.questions.length;
  const questions: Question[] = [
    ...record.questions,
    ...raw.map((q, i) => ({
      id: `q${base + i}`,
      number: q.number,
      canonical: canonicalize(q.number),
      text: q.text,
      marks: q.marks,
      page: q.page,
      order: base + i,
    })),
  ];

  const cursor = record.job.cursor + 1;
  const done = cursor >= record.job.total;

  if (done && !questions.length) {
    return fail(
      record,
      "No questions were found in the question paper. If the scan is faint or rotated, try a clearer copy."
    );
  }

  return save(record.id, {
    questions,
    job: done
      ? {
          ...record.job,
          step: "answers",
          cursor: 0,
          total: batchCount(record.answerPages.length),
          detail: "Reading handwriting",
        }
      : {
          ...record.job,
          cursor,
          detail: `${questions.length} question${questions.length === 1 ? "" : "s"} so far`,
        },
  });
}

async function answerBatch(record: AssessmentRecord): Promise<AssessmentRecord> {
  const pages = await loadBatch(record, "answer", record.job.cursor);
  const raw = await extractAnswers(pages, record.job.cursor > 0);

  /**
   * An answer running past the end of a batch is the one multi-page case the
   * model cannot solve alone: within a batch it sees both halves and returns
   * one block with two regions, but across the boundary the second half arrives
   * in a later request that never saw the first. Left alone it becomes a
   * labelless block that matches nothing and surfaces as unmatched writing.
   *
   * This is the only place the seam is visible, so it is joined here — the tail
   * folds into the block it continues, keeping the answer whole and lighting
   * both pages up on one click.
   */
  const kept = [...raw];
  const carried = record.blocks.length ? record.blocks[record.blocks.length - 1] : null;
  // With nothing to join onto — an earlier batch that yielded no blocks at all
  // — the tail is kept as a block of its own rather than dropped on the floor.
  const tail = carried && kept[0]?.continuesPrevious ? kept.shift() ?? null : null;

  const existing = record.blocks.map((b) =>
    carried && tail && b.id === carried.id
      ? {
          ...b,
          regions: [...b.regions, ...tail.regions],
          transcription: `${b.transcription.trim()}\n${tail.transcription.trim()}`.trim(),
        }
      : b
  );

  const base = existing.length;
  const blocks: AnswerBlock[] = [
    ...existing,
    ...kept.map((b, i) => ({
      id: `b${base + i}`,
      writtenLabel: b.writtenLabel,
      canonical: canonicalize(b.writtenLabel) || null,
      transcription: b.transcription,
      regions: b.regions,
      order: base + i,
    })),
  ];

  const cursor = record.job.cursor + 1;
  const done = cursor >= record.job.total;

  return save(record.id, {
    blocks,
    job: done
      ? {
          ...record.job,
          step: "mapping",
          cursor: 0,
          total: 1,
          detail: "Matching answers to questions",
        }
      : {
          ...record.job,
          cursor,
          detail: `${blocks.length} answer block${blocks.length === 1 ? "" : "s"} so far`,
        },
  });
}

async function mappingStep(record: AssessmentRecord): Promise<AssessmentRecord> {
  const { blocks, mappings, orphanBlockIds, byLabel, bySemantic } = await matchAnswers(
    record.questions,
    record.blocks
  );

  const matched = mappings.filter((m) => m.answerBlockId).length;

  return save(record.id, {
    blocks,
    mappings,
    orphanBlockIds,
    job: {
      ...record.job,
      step: "grading",
      cursor: 0,
      total: 1,
      detail:
        bySemantic > 0
          ? `${byLabel} matched by label, ${bySemantic} by content`
          : `${matched} of ${record.questions.length} questions answered`,
    },
  });
}

async function gradingStep(record: AssessmentRecord): Promise<AssessmentRecord> {
  const finishedAt = new Date().toISOString();

  try {
    // Called even when nothing matched. It makes no model call in that case,
    // and it is the one place that knows an unanswered question still scores
    // zero out of its printed marks — short-circuiting past it here is what
    // once let a script with nothing on it report 0 out of 0.
    const { grades, summary } = await gradeAssessment(
      record.questions,
      record.blocks,
      record.mappings
    );

    // Counted off the verdict, not off grades.length: every question carries a
    // grade now, so the array length is the size of the paper rather than the
    // amount of marking done.
    const marked = grades.filter((g) => g.verdict !== "unanswered").length;

    return save(record.id, {
      grades,
      summary,
      job: {
        ...record.job,
        step: "done",
        cursor: 1,
        detail: marked
          ? `${marked} answer${marked === 1 ? "" : "s"} marked`
          : "Nothing to mark",
        finishedAt,
      },
    });
  } catch (err) {
    // Marking is the last stage and the least essential one. Losing it must not
    // cost the teacher the extraction and mapping that already succeeded, so
    // this failure is reported in the summary rather than failing the run.
    return save(record.id, {
      summary: `Marking could not be completed: ${(err as Error).message}`,
      job: {
        ...record.job,
        step: "done",
        cursor: 1,
        detail: "Finished without marks",
        finishedAt,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function loadBatch(
  record: AssessmentRecord,
  kind: PageKind,
  cursor: number
): Promise<PageInput[]> {
  const metas: PageMeta[] = kind === "question" ? record.questionPages : record.answerPages;
  const { from, to } = batchRange(cursor, metas.length);
  const slice = metas.slice(from, to);

  const loaded = await Promise.all(
    slice.map(async (meta) => {
      const stored = await repo().getPage(record.id, kind, meta.index);
      if (!stored) return null;
      return {
        index: meta.index,
        image: { mimeType: stored.mime, data: stored.bytes.toString("base64") },
      };
    })
  );

  const pages = loaded.filter((p): p is PageInput => p !== null);

  if (!pages.length) {
    throw new Error(
      `Page images for ${kind} batch ${cursor + 1} are missing from storage. The run cannot continue.`
    );
  }

  return pages;
}

/**
 * Every write that carries a job also releases the claim, so a step cannot
 * finish and leave the run locked behind it.
 */
function save(id: string, patch: Partial<AssessmentRecord>): Promise<AssessmentRecord> {
  const normalised = patch.job ? { ...patch, job: { ...patch.job, leaseUntil: null } } : patch;
  return repo().update(id, normalised);
}

function fail(record: AssessmentRecord, message: string): Promise<AssessmentRecord> {
  const job: JobState = {
    ...record.job,
    step: "failed",
    // Remembered so a retry picks up at the batch that failed. A rate limit
    // three pages into a script should cost those three pages, not all of them.
    failedStep: record.job.step,
    error: message,
    detail: "Stopped",
    finishedAt: new Date().toISOString(),
  };
  return save(record.id, { job });
}

/**
 * Clears a failure and puts the run back on the step it died on.
 *
 * Everything extracted before the failure is still in the record, so the retry
 * resumes rather than restarting — which matters most for the failure that
 * actually happens, a free-tier rate limit part way through a long paper.
 */
export async function retry(id: string): Promise<AssessmentRecord> {
  return withLock(id, async () => {
    const record = await requireAssessment(id);
    if (record.job.step !== "failed") return record;

    return save(id, {
      job: {
        ...record.job,
        step: record.job.failedStep ?? "uploading",
        failedStep: null,
        error: null,
        detail: "Resuming",
        finishedAt: null,
      },
    });
  });
}
