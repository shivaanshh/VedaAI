import type {
  AssessmentRecord,
  AssessmentSummary,
  PageKind,
} from "@/lib/types";

/**
 * The storage contract.
 *
 * Two implementations satisfy it: a filesystem driver so the app runs with no
 * infrastructure at all, and a Postgres driver for deployment. Everything above
 * this line — services, routes, UI — is written against the interface and has
 * no idea which one it is talking to.
 */

export interface StoredImage {
  mime: string;
  bytes: Buffer;
}

export interface Repository {
  /** Shown on the history screen so it is never a mystery where data lives. */
  readonly name: string;
  /**
   * Whether data outlives this process. The filesystem driver is not durable on
   * a serverless host, and the UI says so rather than quietly losing history.
   */
  readonly durable: boolean;

  init(): Promise<void>;

  create(record: AssessmentRecord): Promise<AssessmentRecord>;
  get(id: string): Promise<AssessmentRecord | null>;
  update(id: string, patch: Partial<AssessmentRecord>): Promise<AssessmentRecord>;
  list(limit: number): Promise<AssessmentSummary[]>;
  remove(id: string): Promise<void>;

  putPage(id: string, kind: PageKind, index: number, image: StoredImage): Promise<void>;
  getPage(id: string, kind: PageKind, index: number): Promise<StoredImage | null>;
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No assessment with id ${id}.`);
    this.name = "NotFoundError";
  }
}

/**
 * Input the caller got wrong, as opposed to something that broke here.
 *
 * The distinction is not pedantry: a malformed id in a URL used to surface as
 * a 500, which says the server is broken and invites a retry that will fail
 * exactly the same way. It is a 400 — the request is wrong and no amount of
 * repeating it will help.
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/**
 * Reduces a full record to the row the history list renders.
 *
 * Lives here rather than in either driver so both produce byte-identical
 * summaries and the list looks the same whichever one is active.
 */
export function summarise(r: AssessmentRecord): AssessmentSummary {
  const answeredCount = r.mappings.filter((m) => m.answerBlockId).length;

  return {
    id: r.id,
    title: r.title,
    // Normalised here rather than trusted, because a record stored before the
    // filing existed simply has no such key.
    student: r.student ?? null,
    paper: r.paper ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    step: r.job.step,
    error: r.job.error,
    questionCount: r.questions.length,
    answeredCount,
    unansweredCount: Math.max(0, r.questions.length - answeredCount),
    orphanCount: r.orphanBlockIds.length,
    awarded: r.grades.reduce((s, g) => s + (g.awarded ?? 0), 0),
    outOf: r.grades.reduce((s, g) => s + (g.max ?? 0), 0),
    answerPageCount: r.answerPages.length,
  };
}
