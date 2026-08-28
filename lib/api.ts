import type {
  AssessmentRecord,
  AssessmentSummary,
  PageKind,
  PageRef,
  RenderedPage,
} from "./types";
import type { Exam } from "./exam";

/**
 * The browser's view of the backend. Every network call the UI makes goes
 * through here, so components deal in domain objects and never in URLs, status
 * codes or JSON shapes.
 */

export interface ApiErrorShape {
  error: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      `Could not reach the server (${(err as Error).message}).`,
      0
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Partial<ApiErrorShape> & T;

  if (!res.ok) {
    throw new ApiError(payload?.error || `${url} responded ${res.status}.`, res.status);
  }
  return payload as T;
}

function postJSON<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

export interface NewRun {
  title: string;
  /** Optional. Whose script this is — the key My Classroom groups on. */
  student?: string | null;
  /** Optional. The paper it was marked against — the key Assignments groups on. */
  paper?: string | null;
}

export async function createAssessment(run: NewRun): Promise<AssessmentRecord> {
  const { assessment } = await postJSON<{ assessment: AssessmentRecord }>(
    "/api/assessments",
    run
  );
  return assessment;
}

export async function fetchAssessment(id: string): Promise<AssessmentRecord> {
  const { assessment } = await request<{ assessment: AssessmentRecord }>(
    `/api/assessments/${id}`,
    { cache: "no-store" }
  );
  return assessment;
}

export async function listAssessments(): Promise<AssessmentSummary[]> {
  const { items } = await request<{ items: AssessmentSummary[] }>("/api/assessments", {
    cache: "no-store",
  });
  return items;
}

/**
 * Per-question results for every paper, already aggregated.
 *
 * The adding-up happens on the server because the history list carries counts
 * rather than questions; doing it here would mean fetching every full record
 * over the network to reach numbers the server already has on disk.
 */
export async function listExams(): Promise<Exam[]> {
  const { exams } = await request<{ exams: Exam[] }>("/api/exams", { cache: "no-store" });
  return exams;
}

/**
 * Edits title and filing. Only the keys passed are sent, and only the keys sent
 * are changed — so filing a run under a student never disturbs its title.
 */
export async function updateAssessment(
  id: string,
  patch: { title?: string; student?: string | null; paper?: string | null }
): Promise<AssessmentRecord> {
  const { assessment } = await request<{ assessment: AssessmentRecord }>(
    `/api/assessments/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  return assessment;
}

export async function deleteAssessment(id: string): Promise<void> {
  await request(`/api/assessments/${id}`, { method: "DELETE" });
}

/** Uploads one batch of rendered pages. */
export async function uploadPages(
  id: string,
  kind: PageKind,
  pages: RenderedPage[]
): Promise<AssessmentRecord> {
  const { assessment } = await postJSON<{ assessment: AssessmentRecord }>(
    `/api/assessments/${id}/pages`,
    { kind, pages }
  );
  return assessment;
}

/** Runs one unit of server-side work and returns the updated record. */
export async function advanceAssessment(id: string): Promise<AssessmentRecord> {
  const { assessment } = await postJSON<{ assessment: AssessmentRecord }>(
    `/api/assessments/${id}/advance`,
    {}
  );
  return assessment;
}

/** Clears a failure and resumes the run from the step that failed. */
export async function retryAssessment(id: string): Promise<AssessmentRecord> {
  const { assessment } = await postJSON<{ assessment: AssessmentRecord }>(
    `/api/assessments/${id}/retry`,
    {}
  );
  return assessment;
}

export interface Health {
  storage: string;
  durable: boolean;
  model: string;
  modelConfigured: boolean;
  /** True once the free tier's daily allowance has been seen to run out. */
  quotaBlocked: boolean;
  /** Milliseconds until midnight Pacific, when that allowance resets. */
  quotaResetsInMs: number;
  /** Requests sent in the last rolling minute, against the per-minute cap. */
  requestsLastMinute: number;
}

export function fetchHealth(): Promise<Health> {
  return request<Health>("/api/health", { cache: "no-store" });
}

/* ------------------------------------------------------------------ */
/* Page URLs                                                           */
/* ------------------------------------------------------------------ */

export function pageUrl(id: string, kind: PageKind, index: number): string {
  return `/api/assessments/${id}/pages/${kind}/${index}`;
}

/** Turns stored page metadata into something the viewer can render. */
export function toPageRefs(record: AssessmentRecord, kind: PageKind): PageRef[] {
  const metas = kind === "question" ? record.questionPages : record.answerPages;
  return metas.map((m) => ({
    index: m.index,
    width: m.width,
    height: m.height,
    source: m.source,
    url: pageUrl(record.id, kind, m.index),
  }));
}
