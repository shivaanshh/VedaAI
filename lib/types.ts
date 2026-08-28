/**
 * Domain model. Shared by the browser, the API layer and the services — this
 * file is deliberately free of imports so both sides can hold the same shapes.
 *
 * One decision drives most of it: a Box is stored in PERCENTAGES of the page it
 * belongs to, never in pixels. The same page is sent to the model at one scale
 * and drawn on screen at another, fluid one, so any pixel value would be wrong
 * the moment the window resizes. Percentages survive both.
 */

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export type PageKind = "question" | "answer";

/**
 * A page freshly rendered in the browser, before it has been stored.
 *
 * `dataUrl` holds the only rasterisation that will ever happen. It is uploaded
 * verbatim and served back verbatim, so the pixels the model reasons about and
 * the pixels the teacher looks at are the same bytes.
 */
export interface RenderedPage {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
  source: string;
}

/** A stored page, as recorded alongside the assessment. */
export interface PageMeta {
  index: number;
  width: number;
  height: number;
  /** Original filename, shown under the page in the viewer. */
  source: string;
  bytes: number;
}

/**
 * A page ready to display. `url` is either an API path for a stored page or a
 * data URL for one still in the browser, so the viewer never needs to know
 * which stage it is looking at.
 */
export interface PageRef {
  index: number;
  width: number;
  height: number;
  source: string;
  url: string;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/** A rectangle on a page, expressed in percent (0–100) of page width/height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Part of an answer living on one page. An answer may have several. */
export interface Region {
  page: number;
  box: Box;
}

export interface Question {
  id: string;
  /**
   * The number exactly as printed: "11(a)", "Q.4", "17 (iii)".
   * Never normalised for display — the requirement is to preserve original
   * numbering.
   */
  number: string;
  /** Match key derived from `number`. See lib/normalize.ts. */
  canonical: string;
  text: string;
  /** Marks allocated, when the paper prints them. */
  marks: number | null;
  /** Page of the QUESTION PAPER this was printed on. */
  page: number;
  /** Position in printed order, 0-based. Authoritative for list ordering. */
  order: number;
}

/**
 * A contiguous chunk of student writing.
 *
 * Deliberately not called an "Answer": at extraction time we do not yet know
 * which question it belongs to, or whether it belongs to any. Naming it a block
 * keeps that ignorance honest until the mapping stage resolves it.
 */
export interface AnswerBlock {
  id: string;
  /** What the student wrote as a label — "5b)", "Q.11 a" — or null. */
  writtenLabel: string | null;
  canonical: string | null;
  transcription: string;
  /** Always an array. Multi-page answers are the normal case, not an exception. */
  regions: Region[];
  order: number;
}

/* ------------------------------------------------------------------ */
/* Mapping and grading                                                 */
/* ------------------------------------------------------------------ */

export type MatchMethod = "label" | "semantic" | "none";

export interface Mapping {
  questionId: string;
  answerBlockId: string | null;
  /** 0–1. Label matches are 1. Semantic matches carry the model's confidence. */
  confidence: number;
  method: MatchMethod;
}

export type Verdict = "correct" | "partial" | "incorrect" | "unanswered";

export interface Grade {
  questionId: string;
  awarded: number | null;
  max: number | null;
  verdict: Verdict;
  feedback: string;
}

/** The analytical result, independent of how it was stored or produced. */
export interface Assessment {
  questions: Question[];
  blocks: AnswerBlock[];
  mappings: Mapping[];
  grades: Grade[];
  /** Blocks that matched no question — the student answered something else. */
  orphanBlockIds: string[];
  summary: string | null;
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

/**
 * Work is done one batch per request rather than in a single long call.
 *
 * Serverless functions are capped at 60s and a multi-page script needs far more
 * than that across all stages. Persisting a cursor between steps keeps every
 * individual request short, makes the progress bar reflect work that genuinely
 * finished, and means a reload mid-run resumes instead of starting over.
 */
export type JobStep =
  | "uploading"
  | "questions"
  | "answers"
  | "mapping"
  | "grading"
  | "done"
  | "failed";

export interface JobState {
  step: JobStep;
  /** Batches completed within the current step. */
  cursor: number;
  /** Batches the current step requires. */
  total: number;
  /** What is happening right now, in the teacher's language. */
  detail: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * ISO time until which a worker claims this run. Present so that two callers
   * racing on the same assessment cannot both process the same batch.
   */
  leaseUntil: string | null;
  /**
   * The step that was running when the job failed, so a retry resumes there
   * instead of discarding everything extracted before the failure.
   */
  failedStep: JobStep | null;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/**
 * How a run is filed.
 *
 * Both are optional and both are typed by the teacher — there is no account to
 * read them from, because the brief rules out authentication. They exist
 * because one run on its own answers "how did this script do", and a teacher
 * marking a class needs "how is this student doing" and "how did the class find
 * this paper". Those two questions are the whole of My Classroom and
 * Assignments, and neither can be answered without knowing whose script this is
 * and which paper it was marked against.
 *
 * Absent on records written before these fields existed, so every reader
 * normalises through `?? null` rather than assuming the key is there.
 */
export interface Filing {
  /** Whose script this is. Null until the teacher says. */
  student: string | null;
  /** The paper it was marked against — the assignment it belongs to. */
  paper: string | null;
}

/** Everything kept about one run. This is the unit of history. */
export interface AssessmentRecord extends Assessment, Filing {
  id: string;
  /** Derived from the uploaded filename; the teacher can rename it. */
  title: string;
  createdAt: string;
  updatedAt: string;
  job: JobState;
  questionPages: PageMeta[];
  answerPages: PageMeta[];
}

/**
 * The reduced shape the history list needs — never carries page data.
 *
 * Carries the filing too, so grouping a term's worth of runs by student or by
 * paper costs one list call rather than one full record read per run.
 */
export interface AssessmentSummary extends Filing {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  step: JobStep;
  error: string | null;
  questionCount: number;
  answeredCount: number;
  unansweredCount: number;
  orphanCount: number;
  awarded: number;
  outOf: number;
  answerPageCount: number;
}
