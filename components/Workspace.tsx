"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProcessingProgress from "./ProcessingProgress";
import QuestionRail from "./QuestionRail";
import SheetViewer from "./SheetViewer";
import Shell from "./Shell";
import {
  advanceAssessment,
  clearReview,
  fetchAssessment,
  retryAssessment,
  saveReview,
  toPageRefs,
  updateAssessment,
} from "@/lib/api";
import { isTerminal } from "@/lib/job";
import { resolve } from "@/lib/review";
import { filename, scriptCSV } from "@/lib/csv";
import { download } from "@/lib/download";
import { Download } from "./icons";
import { splitRef } from "@/lib/display";
import type { ReviewPatch } from "./MarkEditor";
import type { AssessmentRecord } from "@/lib/types";

/**
 * One marking run, from wherever it happens to be.
 *
 * The server owns the work; this component's only job while a run is in flight
 * is to keep asking for the next unit of it. That inversion is what makes the
 * URL reloadable — arriving here mid-run picks the job up where it was rather
 * than restarting it, and arriving after it finished renders the stored result
 * without touching the model at all.
 */

/** How long to wait when a poll comes back unchanged — another tab holds it. */
const IDLE_WAIT_MS = 1500;
/** Give up after this much unchanged polling rather than spinning forever. */
const STALL_LIMIT_MS = 120_000;

export default function Workspace({ id }: { id: string }) {
  const [record, setRecord] = useState<AssessmentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"questions" | "sheet">("questions");

  // Bumped to re-enter the drive loop after a retry, without remounting.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const railRef = useRef<HTMLDivElement>(null);

  /* -------------------------------------------------------------- */
  /* Driving the job                                                 */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let current = await fetchAssessment(id);
        if (cancelled) return;
        setRecord(current);

        let stalledFor = 0;

        while (!cancelled && !isTerminal(current.job.step)) {
          const before = `${current.job.step}:${current.job.cursor}`;
          const next = await advanceAssessment(id);
          if (cancelled) return;

          setRecord(next);
          current = next;

          // Unchanged means someone else holds the lease — another tab, or a
          // request still finishing on a different instance. Waiting is the
          // correct response; hammering it would only lengthen the queue.
          if (`${next.job.step}:${next.job.cursor}` === before) {
            stalledFor += IDLE_WAIT_MS;
            if (stalledFor >= STALL_LIMIT_MS) {
              throw new Error(
                "This run has not moved for two minutes. It may be running in another tab — reload to pick it up again."
              );
            }
            await sleep(IDLE_WAIT_MS);
          } else {
            stalledFor = 0;
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const onRetry = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      setRecord(await retryAssessment(id));
      setAttempt((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }, [id]);

  /* -------------------------------------------------------------- */
  /* Derived views                                                   */
  /* -------------------------------------------------------------- */

  const answerPages = useMemo(() => (record ? toPageRefs(record, "answer") : []), [record]);

  /**
   * The record as the teacher's corrections leave it.
   *
   * Everything on screen reads from here rather than from the raw record, so a
   * mark changed in the rail moves the highlight, the running total and the
   * chip in the same render. `record` itself still holds what the model said,
   * which is what the editor shows the override against.
   */
  const view = useMemo(
    () => (record ? resolve(record) : { grades: [], mappings: [], orphanBlockIds: [] }),
    [record]
  );

  const blockByQuestion = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of view.mappings) {
      if (m.answerBlockId) map.set(m.questionId, m.answerBlockId);
    }
    return map;
  }, [view]);

  /**
   * The tag drawn on a highlight names the QUESTION, not the block, because
   * that is the connection the teacher is checking. It uses the canonical key
   * rather than the printed number so a highlight over "Q. 11 (a)" reads as a
   * compact "Q11a" instead of overflowing the box.
   */
  const blockLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    const byId = new Map((record?.questions ?? []).map((q) => [q.id, q]));

    for (const m of view.mappings) {
      if (!m.answerBlockId) continue;
      const q = byId.get(m.questionId);
      if (!q) continue;
      const ref = splitRef(q.canonical, q.number);
      labels[m.answerBlockId] = `Q${ref.badge}${ref.sub ? ref.sub.replace(".", "") : ""}`;
    }

    for (const blockId of view.orphanBlockIds) {
      labels[blockId] = "unmatched";
    }
    return labels;
  }, [view, record]);

  const activeBlockId =
    selectedOrphanId ??
    (selectedQuestionId ? blockByQuestion.get(selectedQuestionId) ?? null : null);

  const emptyNotice = useMemo(() => {
    if (!selectedQuestionId || selectedOrphanId) return null;
    if (blockByQuestion.has(selectedQuestionId)) return null;
    const q = record?.questions.find((x) => x.id === selectedQuestionId);
    return q ? `Nothing on this sheet answers ${q.number}.` : null;
  }, [selectedQuestionId, selectedOrphanId, blockByQuestion, record]);


  /* -------------------------------------------------------------- */
  /* Correcting the model                                            */
  /* -------------------------------------------------------------- */

  const [savingId, setSavingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  /**
   * The server returns the whole record, and it becomes the new state.
   *
   * Recomputing the totals in the browser would be faster and would eventually
   * be wrong: the server clamps a mark to what the question is worth, and a
   * client that had already drawn its own number would keep showing a total the
   * database does not agree with.
   */
  const onSaveReview = useCallback(
    async (questionId: string, patch: ReviewPatch) => {
      setSavingId(questionId);
      setReviewError(null);
      try {
        setRecord(await saveReview(id, { questionId, ...patch }));
      } catch (err) {
        setReviewError((err as Error).message);
      } finally {
        setSavingId(null);
      }
    },
    [id]
  );

  const onClearReview = useCallback(
    async (questionId: string) => {
      setSavingId(questionId);
      setReviewError(null);
      try {
        setRecord(await clearReview(id, questionId));
      } catch (err) {
        setReviewError((err as Error).message);
      } finally {
        setSavingId(null);
      }
    },
    [id]
  );

  const selectQuestion = useCallback((questionId: string) => {
    setSelectedOrphanId(null);
    setSelectedQuestionId(questionId);
    setMobileTab("sheet");
  }, []);

  const selectOrphan = useCallback((blockId: string) => {
    setSelectedQuestionId(null);
    setSelectedOrphanId(blockId);
    setMobileTab("sheet");
  }, []);

  // Up/down walks the paper in printed order. Marking is repetitive work, and
  // reaching for the mouse on every question makes it slower than it needs to
  // be. Scoped to the rail so it cannot fight the sheet's own scrolling.
  useEffect(() => {
    const questions = record?.questions ?? [];
    if (!questions.length) return;

    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!railRef.current?.contains(document.activeElement)) return;

      e.preventDefault();
      const at = questions.findIndex((q) => q.id === selectedQuestionId);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? 0 : Math.min(questions.length - 1, Math.max(0, at + delta));
      selectQuestion(questions[next].id);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, selectedQuestionId, selectQuestion]);

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */

  if (error && !record) {
    return (
      <Shell current="exams" backHref="/history" label="Exams">
        <Notice
          heading="This run could not be opened"
          body={error}
          action={{ href: "/", label: "Start a new one" }}
        />
      </Shell>
    );
  }

  if (!record) {
    return (
      <Shell current="exams" backHref="/history" label="Exams">
        <div className="flex h-full items-center justify-center text-[13px] text-mute">
          Opening run&hellip;
        </div>
      </Shell>
    );
  }

  const title = record.title;
  const failed = record.job.step === "failed";
  const running = !isTerminal(record.job.step);

  if (running || failed) {
    return (
      <Shell current="exams" sidebarCollapsed backHref="/history" label={title}>
        <div className="h-full p-3">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ProcessingProgress job={record.job} />
            </div>

            {failed ? (
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-line px-4 py-3">
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b] disabled:opacity-50"
                >
                  {retrying ? "Resuming…" : "Resume from where it stopped"}
                </button>
                <Link
                  href="/"
                  className="rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold text-body transition-colors hover:bg-raised"
                >
                  Start over
                </Link>
              </div>
            ) : null}

            {/* The loop stopped without the run itself failing — a dropped
                connection, or a lease that outlived its worker. The job is
                still mid-flight on the server, so re-entering the loop is all
                that is needed. */}
            {error && !failed ? (
              <div className="shrink-0 border-t border-line px-4 py-3 text-center">
                <p className="text-[12px] text-bad">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAttempt((n) => n + 1);
                  }}
                  className="mt-2 rounded-full border border-line px-4 py-1.5 text-[12px] font-semibold text-body transition-colors hover:bg-raised"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell current="exams" sidebarCollapsed backHref="/history" label={title}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
          {/* Phone: the two panels cannot sit side by side, so they take turns.
              Selecting a question switches to the sheet, which is where the
              teacher was heading anyway. */}
          <div className="flex flex-1 gap-1 md:hidden">
            {(["questions", "sheet"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMobileTab(tab)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  mobileTab === tab ? "bg-ink text-white" : "text-mute hover:bg-raised"
                }`}
              >
                {tab === "questions" ? "Questions" : "Answer Sheet"}
              </button>
            ))}
          </div>

          <div className="hidden flex-1 md:block" />

          <RunDetails
            record={record}
            onSaved={(next) => setRecord((r) => (r ? { ...r, ...next } : r))}
          />
          {record.grades.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                download(
                  filename([record.student, record.paper ?? record.title]),
                  scriptCSV({ ...record, ...view })
                )
              }
              title="Download this script as a spreadsheet"
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-body transition-colors hover:bg-raised"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          ) : null}

          <ShareLink id={id} />
        </div>

        {reviewError ? (
          <div className="flex items-start gap-2 border-b border-bad/30 bg-bad-soft/50 px-3 py-2">
            <p className="flex-1 text-[11.5px] font-medium text-bad">{reviewError}</p>
            <button
              type="button"
              onClick={() => setReviewError(null)}
              className="shrink-0 text-[11px] font-semibold text-bad underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[minmax(320px,7fr)_9fr]">
          <div
            ref={railRef}
            className={`min-h-0 ${mobileTab === "questions" ? "" : "hidden"} md:block`}
          >
            <QuestionRail
              questions={record.questions}
              blocks={record.blocks}
              mappings={view.mappings}
              grades={view.grades}
              orphanBlockIds={view.orphanBlockIds}
              reviews={record.reviews ?? []}
              summary={record.summary}
              selectedQuestionId={selectedQuestionId}
              selectedOrphanId={selectedOrphanId}
              onSelectQuestion={selectQuestion}
              onSelectOrphan={selectOrphan}
              editing={
                // Offered once there are marks to correct. Before grading there
                // is nothing to disagree with, and an editor on an empty rail
                // would only invite a teacher to grade the paper by hand.
                record.grades.length > 0
                  ? {
                      modelGrades: record.grades,
                      modelMappings: record.mappings,
                      savingId,
                      onSave: onSaveReview,
                      onClear: onClearReview,
                    }
                  : undefined
              }
            />
          </div>

          <div className={`min-h-0 ${mobileTab === "sheet" ? "" : "hidden"} md:block`}>
            <SheetViewer
              pages={answerPages}
              blocks={record.blocks}
              activeBlockId={activeBlockId}
              orphanBlockIds={view.orphanBlockIds}
              blockLabels={blockLabels}
              emptyNotice={emptyNotice}
            />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Notice({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-[380px] text-center">
        <h2 className="font-display text-[19px] font-extrabold tracking-tight text-ink">
          {heading}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mute">{body}</p>
        <Link
          href={action.href}
          className="mt-5 inline-flex rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b]"
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}

/**
 * What this run is called, whose it is, and which paper it belongs to.
 *
 * A script is usually identified after it has been read, not before — the name
 * is on the sheet, and by the time the teacher is looking at the marks they
 * know both. Editing it here rather than only at upload is what lets My
 * Classroom and Assignments cover a history that already exists.
 */
function RunDetails({
  record,
  onSaved,
}: {
  record: AssessmentRecord;
  onSaved: (next: { title: string; student: string | null; paper: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [student, setStudent] = useState(record.student ?? "");
  const [paper, setPaper] = useState(record.paper ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Reopening after a save must show what was saved, not the draft from a
  // previous edit that may since have been abandoned.
  useEffect(() => {
    if (open) return;
    setTitle(record.title);
    setStudent(record.student ?? "");
    setPaper(record.paper ?? "");
    setFailed(null);
  }, [open, record.title, record.student, record.paper]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const save = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const saved = await updateAssessment(record.id, {
        title: title.trim() || record.title,
        student: student.trim(),
        paper: paper.trim(),
      });
      onSaved({ title: saved.title, student: saved.student, paper: saved.paper });
      setOpen(false);
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [record.id, record.title, title, student, paper, onSaved]);

  const filed = [record.student, record.paper].filter(Boolean).join(" · ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Name the student and the paper this script belongs to"
        className={`max-w-[220px] truncate rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
          open ? "border-brand bg-brand-soft/40 text-ink" : "border-line text-body hover:bg-raised"
        }`}
      >
        {filed || "File this script"}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[300px] animate-riseIn rounded-2xl border border-line bg-surface p-4 shadow-pop">
          <h3 className="text-[12.5px] font-bold text-ink">Run details</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
            Nothing is re-marked. This only decides where the run files itself.
          </p>

          <div className="mt-3 space-y-2.5">
            <DetailField id="run-title" label="Title" value={title} onChange={setTitle} />
            <DetailField
              id="run-student"
              label="Student"
              value={student}
              placeholder="Groups it in My Classroom"
              onChange={setStudent}
            />
            <DetailField
              id="run-paper"
              label="Paper"
              value={paper}
              placeholder="Groups it in Assignments"
              onChange={setPaper}
            />
          </div>

          {failed ? <p className="mt-2 text-[11px] font-medium text-bad">{failed}</p> : null}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-full bg-ink px-3.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-line px-3.5 py-1.5 text-[11.5px] font-semibold text-body transition-colors hover:bg-raised"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
      />
    </label>
  );
}

/**
 * Hands the student their own copy of this result.
 *
 * The link points at /s/:id: the same marks, the same feedback and the same
 * highlighted regions, with none of the controls that change them. There is no
 * account to deliver it to, because the brief rules out authentication, so the
 * teacher passes the URL on through whatever they already use to reach a class.
 */
function ShareLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [url, setUrl] = useState("");

  // Built on the client because the origin is not known while rendering on the
  // server, and a link to the wrong host is worse than no link.
  useEffect(() => {
    setUrl(`${window.location.origin}/s/${id}`);
  }, [id]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setRevealed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright by the browser. Showing the
      // URL to copy by hand is a worse experience than copying it, and a much
      // better one than a button that silently does nothing.
      setRevealed(true);
    }
  }, [url]);

  return (
    <div className="flex items-center gap-2">
      {revealed ? (
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Student link"
          className="ref w-[220px] rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] text-body"
        />
      ) : null}

      <a
        href={`/s/${id}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-body transition-colors hover:bg-raised"
      >
        Preview
      </a>

      <button
        type="button"
        onClick={copy}
        className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#2b2b2b]"
      >
        {copied ? "Link copied" : "Share with student"}
      </button>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
