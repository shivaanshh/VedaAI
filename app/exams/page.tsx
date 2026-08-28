"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { ChevronDown, Download, Sparkle } from "@/components/icons";
import { listExams } from "@/lib/api";
import { fmt, percent } from "@/lib/cohort";
import { hardest, type Exam, type ExamQuestion } from "@/lib/exam";
import { timeAgo } from "@/lib/display";
import { examCSV, filename } from "@/lib/csv";
import { download } from "@/lib/download";

/**
 * Exams — a paper broken open, one row per question.
 *
 * My Classroom asks how a student is doing and Assignments asks how the class
 * found a paper. Both stop at a single percentage, and a percentage is not
 * something a teacher can act on. This is the view that is: it says *which*
 * question the class lost the marks on, so the next lesson has a subject.
 *
 * Every number is added up from stored runs. Nothing here costs a model call —
 * the per-question marks were written down when the script was graded, and this
 * page only sums them across the scripts that sat the same paper.
 */

export default function ExamsRoute() {
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listExams()
      .then(setExams)
      .catch((err: Error) => {
        setError(err.message);
        setExams([]);
      });
  }, []);

  const totals = useMemo(() => {
    const list = exams ?? [];
    return {
      papers: list.length,
      scripts: list.reduce((n, e) => n + e.scripts, 0),
      questions: list.reduce((n, e) => n + e.questions.length, 0),
    };
  }, [exams]);

  return (
    <Shell current="exams" backHref="/home" label="Exams">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-4 py-8 md:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
                Exams
              </h1>
              <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-mute">
                Each paper you have marked against, question by question. Open one to see where
                the marks actually went.
              </p>
            </div>

            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[12.5px] font-semibold text-white ring-[1.5px] ring-brand transition-colors hover:bg-[#2b2b2b]"
            >
              <Sparkle className="h-3.5 w-3.5 text-brand" />
              Mark a new script
            </Link>
          </div>

          {error ? (
            <p className="mt-5 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[12px] font-medium text-bad">
              {error}
            </p>
          ) : null}

          {exams === null ? (
            <p className="mt-8 text-[13px] text-mute">Loading&hellip;</p>
          ) : exams.length === 0 ? (
            <Empty />
          ) : (
            <>
              <p className="mt-6 text-[11.5px] text-mute">
                {totals.papers} paper{totals.papers === 1 ? "" : "s"} &middot; {totals.scripts}{" "}
                script{totals.scripts === 1 ? "" : "s"} &middot; {totals.questions} question
                {totals.questions === 1 ? "" : "s"} analysed
              </p>

              <ul className="mt-3 space-y-2">
                {exams.map((exam, i) => (
                  <li key={exam.paper}>
                    {/* The most recent paper opens itself. An accordion with every
                        row shut reads as a page with nothing on it, and the
                        breakdown is the entire point of coming here. */}
                    <ExamCard exam={exam} initiallyOpen={i === 0} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function ExamCard({ exam, initiallyOpen }: { exam: Exam; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const worst = hardest(exam, 3);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-ink">{exam.paper}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span className="text-mute">
              {exam.scripts} script{exam.scripts === 1 ? "" : "s"} &middot; {exam.questions.length}{" "}
              question{exam.questions.length === 1 ? "" : "s"}
            </span>
            {exam.students > 0 ? (
              <>
                <Dot />
                <span className="text-mute">
                  {exam.students} student{exam.students === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
            {worst.length > 0 ? (
              <>
                <Dot />
                <span className="font-semibold text-bad">
                  hardest: {worst.map((q) => q.number).join(", ")}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className={`ref text-[17px] font-bold leading-none tabular-nums ${tone(exam.score)}`}>
            {percent(exam.score)}
          </div>
          <div className="mt-1 text-[10.5px] text-faint">
            {exam.outOf > 0 ? `${fmt(exam.awarded)} of ${fmt(exam.outOf)}` : "no marks yet"}
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="animate-markIn border-t border-line">
          {/* Sits inside the panel rather than in the header, because the
              header is itself a button and a button inside a button is neither
              valid nor reliably clickable. */}
          <div className="flex justify-end border-b border-line px-4 py-2">
            <button
              type="button"
              onClick={() => download(filename([exam.paper, "by question"]), examCSV(exam))}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-body transition-colors hover:bg-raised"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>

          {/* One script is one student, and calling that a class average would
              be a lie the teacher cannot see through — so it says so. */}
          {exam.scripts === 1 ? (
            <p className="border-b border-line bg-raised px-4 py-2.5 text-[11.5px] leading-relaxed text-mute">
              Only one script has been marked against this paper, so these are one
              student&rsquo;s results rather than the class&rsquo;s. Mark a second script against{" "}
              <span className="font-semibold text-ink">{exam.paper}</span> and every row below
              becomes an average.
            </p>
          ) : null}

          <ul>
            {exam.questions.map((q) => (
              <li key={q.canonical}>
                <QuestionRow q={q} scripts={exam.scripts} />
              </li>
            ))}
          </ul>

          <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">
            Last marked {timeAgo(exam.lastAt)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One question, across every script that carried it.
 *
 * The bar is the share of available marks the class earned. A question nobody
 * has been marked on gets no bar at all rather than an empty one, because an
 * empty bar reads as zero and "not yet marked" is not zero.
 */
function QuestionRow({ q, scripts }: { q: ExamQuestion; scripts: number }) {
  return (
    <div className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span className="ref mt-0.5 w-[62px] shrink-0 truncate text-[11.5px] font-bold text-ink">
        {q.number}
      </span>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-ink">{q.text}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {q.marks !== null ? (
            <span className="text-faint">
              {fmt(q.marks)} mark{q.marks === 1 ? "" : "s"}
            </span>
          ) : null}

          {q.unanswered > 0 ? (
            <>
              {q.marks !== null ? <Dot /> : null}
              <span className="font-semibold text-bad">
                {/* Phrased against the scripts that actually contained this
                    question, not the paper's total — an older script of the
                    same paper may not have had it. */}
                left blank on {q.unanswered} of {q.scripts} script
                {q.scripts === 1 ? "" : "s"}
              </span>
            </>
          ) : null}

          {q.scripts < scripts ? (
            <>
              <Dot />
              <span className="text-faint">not on every script</span>
            </>
          ) : null}
        </div>

        {q.outOf > 0 && q.score !== null ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EDEDED]">
            <div
              className={
                q.score < 0.5 ? "h-full bg-bad" : q.score < 0.75 ? "h-full bg-warn" : "h-full bg-good"
              }
              style={{ width: `${Math.round(q.score * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="w-[64px] shrink-0 text-right">
        <div className={`ref text-[13px] font-bold leading-none tabular-nums ${tone(q.score)}`}>
          {percent(q.score)}
        </div>
        <div className="mt-1 text-[10.5px] text-faint">
          {q.outOf > 0 ? `${fmt(q.awarded)}/${fmt(q.outOf)}` : "unmarked"}
        </div>
      </div>
    </div>
  );
}

function tone(score: number | null): string {
  if (score === null) return "text-faint";
  if (score < 0.5) return "text-bad";
  if (score < 0.75) return "text-warn";
  return "text-good";
}

function Empty() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <Sparkle className="mx-auto h-6 w-6 text-faint" />
      <h2 className="mt-3 font-display text-[16px] font-extrabold tracking-tight text-ink">
        No papers analysed yet
      </h2>
      <p className="mx-auto mt-1.5 max-w-[400px] text-[12.5px] leading-relaxed text-mute">
        A paper appears here once a script has been marked all the way through and filed under
        it. If you have finished runs that are missing, they are most likely unfiled &mdash;{" "}
        <Link href="/assignments" className="font-semibold text-ink underline">
          name the paper on Assignments
        </Link>{" "}
        and they arrive here without being re-run.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b]"
      >
        Mark a script
      </Link>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" aria-hidden />;
}
