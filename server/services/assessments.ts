import { randomUUID } from "node:crypto";
import { repo, BadRequestError, NotFoundError } from "../db";
import { freshJob } from "@/lib/job";
import type {
  AssessmentRecord,
  AssessmentSummary,
  PageKind,
  PageMeta,
  RenderedPage,
  Review,
} from "@/lib/types";

/**
 * Assessment lifecycle: create, store pages, read, rename, delete.
 *
 * The AI stages live in job.ts; this module owns everything that is true of a
 * run regardless of how far it got, which is what makes an interrupted run
 * still a first-class row in the history list rather than a dangling record.
 */

const MAX_TITLE = 120;
const MAX_LIST = 100;

/** Short enough to read in a URL, wide enough not to collide. */
function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function cleanTitle(raw: unknown): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_TITLE) : "Untitled script";
}

/**
 * A filing field, or null.
 *
 * Distinct from `cleanTitle` because blank has a meaning here: a run nobody has
 * filed yet is not the same as a run filed under the empty string, and My
 * Classroom has to be able to tell those apart to offer to file it.
 */
export function cleanFiling(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_TITLE) : null;
}

export interface NewAssessment {
  title?: unknown;
  student?: unknown;
  paper?: unknown;
}

export async function createAssessment(input: NewAssessment = {}): Promise<AssessmentRecord> {
  const now = new Date().toISOString();

  const record: AssessmentRecord = {
    id: newId(),
    title: cleanTitle(input.title),
    student: cleanFiling(input.student),
    paper: cleanFiling(input.paper),
    createdAt: now,
    updatedAt: now,
    job: freshJob(),
    questionPages: [],
    answerPages: [],
    questions: [],
    blocks: [],
    mappings: [],
    grades: [],
    orphanBlockIds: [],
    summary: null,
  };

  await repo().init();
  return repo().create(record);
}

export async function getAssessment(id: string): Promise<AssessmentRecord | null> {
  await repo().init();
  return repo().get(id);
}

export async function requireAssessment(id: string): Promise<AssessmentRecord> {
  const record = await getAssessment(id);
  if (!record) throw new NotFoundError(id);
  return record;
}

export async function listAssessments(limit = 50): Promise<AssessmentSummary[]> {
  await repo().init();
  return repo().list(Math.min(MAX_LIST, Math.max(1, limit)));
}

/**
 * Edits the things about a run that a teacher owns rather than the model:
 * what it is called, whose it is, and which paper it belongs to.
 *
 * Every field is optional and an omitted one is left alone, so filing a script
 * under a student from My Classroom cannot silently blank a title set from the
 * workspace. Passing an explicit empty string is how a field is cleared.
 */
export async function updateDetails(
  id: string,
  input: { title?: unknown; student?: unknown; paper?: unknown }
): Promise<AssessmentRecord> {
  await repo().init();

  const patch: Partial<AssessmentRecord> = {};
  if (input.title !== undefined) patch.title = cleanTitle(input.title);
  if (input.student !== undefined) patch.student = cleanFiling(input.student);
  if (input.paper !== undefined) patch.paper = cleanFiling(input.paper);

  // An update with nothing in it would still bump updatedAt and reorder the
  // history list for no reason.
  if (Object.keys(patch).length === 0) return requireAssessment(id);

  return repo().update(id, patch);
}

/**
 * Records a teacher's correction to one question, or removes it.
 *
 * The model's grade and mapping are left exactly as they were. This only adds
 * the teacher's word beside them, which is what lets the workspace show both
 * and lets "revert" be a deletion rather than a guess at what the model
 * originally said.
 *
 * Validated against the record rather than trusted: a mark above what the
 * question is worth, or a reassignment naming a block that is not on this
 * sheet, is a bug in the caller and is refused here rather than stored and
 * quietly repaired on every subsequent read.
 */
export interface ReviewInput {
  questionId: unknown;
  awarded?: unknown;
  note?: unknown;
  answerBlockId?: unknown;
}

const MAX_NOTE = 600;

export async function saveReview(id: string, input: ReviewInput): Promise<AssessmentRecord> {
  await repo().init();
  const record = await requireAssessment(id);

  const questionId = String(input.questionId ?? "");
  const question = record.questions.find((q) => q.id === questionId);
  if (!question) throw new BadRequestError("That question is not on this paper.");

  const grade = record.grades.find((g) => g.questionId === questionId) ?? null;
  const max = grade?.max ?? question.marks ?? null;

  /* ---- the mark ---- */

  let awarded: number | null = null;
  if (input.awarded !== undefined && input.awarded !== null && input.awarded !== "") {
    const n = Number(input.awarded);
    if (!Number.isFinite(n)) throw new BadRequestError("That mark is not a number.");
    if (n < 0) throw new BadRequestError("A mark cannot be negative.");
    if (max !== null && max > 0 && n > max) {
      throw new BadRequestError(`This question is worth ${max}, so ${n} is more than it carries.`);
    }
    // Halves are how marking actually works; anything finer is a slip.
    awarded = Math.round(n * 2) / 2;
  }

  /* ---- the note ---- */

  const note = cleanNote(input.note);

  /* ---- the reassignment ---- */

  let answerBlockId: string | null | undefined;
  if ("answerBlockId" in input && input.answerBlockId !== undefined) {
    if (input.answerBlockId === null || input.answerBlockId === "") {
      answerBlockId = null;
    } else {
      const blockId = String(input.answerBlockId);
      if (!record.blocks.some((b) => b.id === blockId)) {
        throw new BadRequestError("That answer is not on this sheet.");
      }
      answerBlockId = blockId;
    }
  }

  const others = (record.reviews ?? []).filter((r) => r.questionId !== questionId);

  // A review that says nothing is a revert, not a record. Storing one would put
  // an "edited by you" badge on a row the teacher only opened and closed.
  if (awarded === null && note === null && answerBlockId === undefined) {
    return repo().update(id, { reviews: others });
  }

  const review: Review = {
    questionId,
    awarded,
    note,
    ...(answerBlockId !== undefined ? { answerBlockId } : {}),
    at: new Date().toISOString(),
  };

  return repo().update(id, { reviews: [...others, review] });
}

/** Drops one correction, handing the question back to the model's own verdict. */
export async function clearReview(id: string, questionId: string): Promise<AssessmentRecord> {
  await repo().init();
  const record = await requireAssessment(id);

  const remaining = (record.reviews ?? []).filter((r) => r.questionId !== questionId);
  if (remaining.length === (record.reviews ?? []).length) return record;

  return repo().update(id, { reviews: remaining });
}

function cleanNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/[ \t]+/g, " ").trim();
  return t ? t.slice(0, MAX_NOTE) : null;
}

export async function deleteAssessment(id: string): Promise<void> {
  await repo().init();
  await repo().remove(id);
}

/**
 * Stores a batch of rendered pages.
 *
 * The bytes go in untouched. This is the load-bearing decision of the whole
 * product: the browser rasterises each page exactly once, and that single
 * rasterisation is what gets stored, what the model is shown, and what the
 * teacher looks at. Re-encoding here — even losslessly — would risk the model
 * and the screen disagreeing about where a pixel is, and every bounding box
 * depends on them agreeing.
 */
export async function storePages(
  id: string,
  kind: PageKind,
  pages: RenderedPage[]
): Promise<AssessmentRecord> {
  await repo().init();
  const record = await requireAssessment(id);

  const added: PageMeta[] = [];

  for (const page of pages) {
    const { mime, bytes } = decodeDataUrl(page.dataUrl);
    await repo().putPage(id, kind, page.index, { mime, bytes });

    added.push({
      index: page.index,
      width: Math.max(1, Math.round(page.width)),
      height: Math.max(1, Math.round(page.height)),
      source: String(page.source ?? "").slice(0, 200),
      bytes: bytes.length,
    });
  }

  const field = kind === "question" ? "questionPages" : "answerPages";

  // Re-uploading a page replaces its entry rather than duplicating it, so a
  // retried batch after a dropped connection is harmless.
  const byIndex = new Map(record[field].map((p) => [p.index, p]));
  for (const p of added) byIndex.set(p.index, p);

  const merged = [...byIndex.values()].sort((a, b) => a.index - b.index);

  return repo().update(id, { [field]: merged } as Partial<AssessmentRecord>);
}

export async function readPage(id: string, kind: PageKind, index: number) {
  await repo().init();
  return repo().getPage(id, kind, index);
}

const DATA_URL = /^data:([\w.+/-]+);base64,(.+)$/s;

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = DATA_URL.exec(String(dataUrl ?? ""));
  if (!match) throw new Error("Malformed page image received from the renderer.");

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("A page image arrived empty.");

  return { mime: match[1], bytes };
}
