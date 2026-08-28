"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import QuestionRail from "./QuestionRail";
import SheetViewer from "./SheetViewer";
import { fetchAssessment, toPageRefs } from "@/lib/api";
import { isTerminal } from "@/lib/job";
import { splitRef } from "@/lib/display";
import type { AssessmentRecord } from "@/lib/types";

/**
 * The student's side of the same marked script.
 *
 * The brief asks for no authentication, so this is deliberately not a login and
 * not a second account system. The two roles are expressed as two views over
 * one stored record, and they differ in what they can DO rather than in what
 * someone had to type to get here: a teacher uploads, re-runs, renames and
 * deletes; a student opens a link their teacher sent and reads the result.
 * Building a sign-in screen instead would enforce nothing and claim something
 * untrue.
 *
 * Concretely, against the teacher workspace this drops: the product sidebar and
 * every route behind it, the library of other scripts, upload, retry, rename,
 * delete, and the matcher's own confidence notes. It never calls /advance
 * either &mdash; marking is the teacher's run to drive, and a student
 * refreshing their result should not be spending the school's model quota.
 */

export default function StudentView({ id }: { id: string }) {
  const [record, setRecord] = useState<AssessmentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"questions" | "sheet">("questions");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAssessment(id)
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const answerPages = useMemo(() => (record ? toPageRefs(record, "answer") : []), [record]);

  const blockByQuestion = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of record?.mappings ?? []) {
      if (m.answerBlockId) map.set(m.questionId, m.answerBlockId);
    }
    return map;
  }, [record]);

  const blockLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    const byId = new Map((record?.questions ?? []).map((q) => [q.id, q]));

    for (const m of record?.mappings ?? []) {
      if (!m.answerBlockId) continue;
      const q = byId.get(m.questionId);
      if (!q) continue;
      const ref = splitRef(q.canonical, q.number);
      labels[m.answerBlockId] = `Q${ref.badge}${ref.sub ? ref.sub.replace(".", "") : ""}`;
    }
    for (const blockId of record?.orphanBlockIds ?? []) {
      labels[blockId] = "unplaced";
    }
    return labels;
  }, [record]);

  const activeBlockId =
    selectedOrphanId ??
    (selectedQuestionId ? blockByQuestion.get(selectedQuestionId) ?? null : null);

  const emptyNotice = useMemo(() => {
    if (!selectedQuestionId || selectedOrphanId) return null;
    if (blockByQuestion.has(selectedQuestionId)) return null;
    const q = record?.questions.find((x) => x.id === selectedQuestionId);
    return q ? `You did not answer ${q.number}.` : null;
  }, [selectedQuestionId, selectedOrphanId, blockByQuestion, record]);

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

  /* -------------------------------------------------------------- */
  /* Before there is a result to show                                */
  /* -------------------------------------------------------------- */

  if (error) {
    return (
      <Frame title="Result">
        <Message
          heading="This result is not available"
          body={
            error.includes("no longer exists")
              ? "The link may be old, or your teacher may have removed this script."
              : error
          }
        />
      </Frame>
    );
  }

  if (!record) {
    return (
      <Frame title="Result">
        <div className="flex h-full items-center justify-center text-[13px] text-mute">
          Opening your result&hellip;
        </div>
      </Frame>
    );
  }

  if (record.job.step === "failed") {
    return (
      <Frame title={record.title}>
        <Message
          heading="Marking did not finish"
          body="Something went wrong part way through, and your teacher will need to run it again. Nothing you wrote has been lost."
        />
      </Frame>
    );
  }

  if (!isTerminal(record.job.step)) {
    return (
      <Frame title={record.title}>
        <Message
          heading="Still being marked"
          body="Your teacher has started marking this script. Check back in a minute."
          action={{ label: "Check again", onClick: () => setAttempt((n) => n + 1) }}
        />
      </Frame>
    );
  }

  /* -------------------------------------------------------------- */
  /* The result                                                      */
  /* -------------------------------------------------------------- */

  const awarded = record.grades.reduce((s, g) => s + (g.awarded ?? 0), 0);
  const outOf = record.grades.reduce((s, g) => s + (g.max ?? 0), 0);
  const answered = record.mappings.filter((m) => m.answerBlockId).length;
  const percent = outOf > 0 ? Math.round((awarded / outOf) * 100) : null;

  return (
    <Frame title={record.title}>
      <div className="flex h-full flex-col">
        <ScoreStrip
          awarded={awarded}
          outOf={outOf}
          percent={percent}
          answered={answered}
          total={record.questions.length}
        />

        <div className="flex shrink-0 gap-1 border-b border-line bg-surface px-3 py-2 md:hidden">
          {(["questions", "sheet"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                mobileTab === tab ? "bg-ink text-white" : "text-mute hover:bg-raised"
              }`}
            >
              {tab === "questions" ? "Questions" : "My Answers"}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[minmax(320px,7fr)_9fr]">
          <div className={`min-h-0 ${mobileTab === "questions" ? "" : "hidden"} md:block`}>
            <QuestionRail
              audience="student"
              questions={record.questions}
              blocks={record.blocks}
              mappings={record.mappings}
              grades={record.grades}
              orphanBlockIds={record.orphanBlockIds}
              summary={record.summary}
              selectedQuestionId={selectedQuestionId}
              selectedOrphanId={selectedOrphanId}
              onSelectQuestion={selectQuestion}
              onSelectOrphan={selectOrphan}
            />
          </div>

          <div className={`min-h-0 ${mobileTab === "sheet" ? "" : "hidden"} md:block`}>
            <SheetViewer
              pages={answerPages}
              blocks={record.blocks}
              activeBlockId={activeBlockId}
              orphanBlockIds={record.orphanBlockIds}
              blockLabels={blockLabels}
              emptyNotice={emptyNotice}
            />
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Student chrome: the wordmark, and nothing else that navigates.
 *
 * There is no sidebar on purpose. Every destination in it belongs to the
 * teacher, and My Library lists other scripts.
 */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="#fff">
            <path d="M4.5 5h3.2l4.3 10.4L16.3 5h3.2l-6 14h-3z" />
          </svg>
        </span>
        <span className="font-display text-[16px] font-extrabold tracking-tight text-ink">
          VedaAI
        </span>
        <span className="hidden h-4 w-px bg-line sm:block" />
        <span className="hidden max-w-[280px] truncate text-[13px] font-medium text-body sm:block">
          {title}
        </span>

        <div className="flex-1" />

        <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-semibold text-faint">
          Student view &middot; read only
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

function ScoreStrip({
  awarded,
  outOf,
  percent,
  answered,
  total,
}: {
  awarded: number;
  outOf: number;
  percent: number | null;
  answered: number;
  total: number;
}) {
  const tone =
    percent === null
      ? "text-ink"
      : percent >= 75
        ? "text-good"
        : percent >= 40
          ? "text-warn"
          : "text-bad";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-3">
      {outOf > 0 ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Score</div>
          <div className={`ref text-[22px] font-bold leading-tight tabular-nums ${tone}`}>
            {fmt(awarded)}
            <span className="text-faint">/{fmt(outOf)}</span>
            {percent !== null ? (
              <span className="ml-2 text-[13px] font-semibold text-mute">{percent}%</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Answered</div>
        <div className="ref text-[22px] font-bold leading-tight tabular-nums text-ink">
          {answered}
          <span className="text-faint">/{total}</span>
        </div>
      </div>

      <p className="min-w-[200px] flex-1 text-[11.5px] leading-relaxed text-mute">
        Pick a question to see exactly where you answered it on your own sheet, and what the
        marking picked up. These marks were awarded by AI &mdash; if something looks wrong, tell
        your teacher.
      </p>
    </div>
  );
}

function Message({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-[380px] text-center">
        <h2 className="font-display text-[19px] font-extrabold tracking-tight text-ink">
          {heading}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mute">{body}</p>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b]"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
