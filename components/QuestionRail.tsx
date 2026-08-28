"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Sparkle } from "./icons";
import { CHIP_CLASS, scoreChip, splitRef } from "@/lib/display";
import type { AnswerBlock, Grade, Mapping, Question } from "@/lib/types";

/**
 * The extracted paper, in printed order, never re-sorted.
 *
 * Order comes from `Question.order`, which was frozen at extraction time. A
 * student answering 7 before 3 changes nothing here — the list is the paper,
 * not the script.
 */

/**
 * The same list is read by two people with different stakes in it. A teacher is
 * checking the machine's work and needs to see where it was unsure; a student
 * is reading their own result and would only be confused by matcher internals.
 * Everything that differs between them is copy, so it lives in one table rather
 * than in a second component that would drift.
 */
export type Audience = "teacher" | "student";

const COPY = {
  teacher: {
    heading: "Extracted Questions",
    headingNote: "(from question paper)",
    summaryTitle: "Notes on this script",
    transcribed: "What the student wrote",
    located: "Answer located on the sheet. Click to highlight it.",
    missing: "Nothing on the sheet answers this question.",
    orphanTitle: "Unmatched writing",
    orphanNote: "On the sheet, but answering nothing on the paper",
  },
  student: {
    heading: "Your answers",
    headingNote: "(question by question)",
    summaryTitle: "Overall notes on your script",
    transcribed: "Your answer, as it was read",
    located: "Click to see where you wrote this.",
    missing: "You did not answer this one.",
    orphanTitle: "Writing we could not place",
    orphanNote: "This is on your sheet but does not answer a question on the paper",
  },
} as const;

interface Props {
  questions: Question[];
  blocks: AnswerBlock[];
  mappings: Mapping[];
  grades: Grade[];
  orphanBlockIds: string[];
  summary: string | null;
  selectedQuestionId: string | null;
  selectedOrphanId: string | null;
  onSelectQuestion: (id: string) => void;
  onSelectOrphan: (id: string) => void;
  audience?: Audience;
}

export default function QuestionRail({
  questions,
  blocks,
  mappings,
  grades,
  orphanBlockIds,
  summary,
  selectedQuestionId,
  selectedOrphanId,
  onSelectQuestion,
  onSelectOrphan,
  audience = "teacher",
}: Props) {
  const copy = COPY[audience];
  const [expandAll, setExpandAll] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const mappingByQuestion = useMemo(
    () => new Map(mappings.map((m) => [m.questionId, m])),
    [mappings]
  );
  const gradeByQuestion = useMemo(() => new Map(grades.map((g) => [g.questionId, g])), [grades]);
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const orphans = orphanBlockIds
    .map((id) => blockById.get(id))
    .filter((b): b is AnswerBlock => Boolean(b));

  const answered = mappings.filter((m) => m.answerBlockId).length;
  const unanswered = questions.length - answered;
  const awarded = grades.reduce((s, g) => s + (g.awarded ?? 0), 0);
  const outOf = grades.reduce((s, g) => s + (g.max ?? 0), 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[13px] font-bold text-ink">
            {copy.heading}{" "}
            <span className="font-medium text-mute">{copy.headingNote}</span>
          </h2>
          <button
            type="button"
            onClick={() => setExpandAll((v) => !v)}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-mute transition-colors hover:bg-raised hover:text-ink"
          >
            {expandAll ? "Collapse All" : "Expand All"}
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <span className="text-mute">{questions.length} questions</span>
          <Dot />
          <span className="font-semibold text-good">{answered} answered</span>
          <Dot />
          <span className={unanswered ? "font-semibold text-bad" : "text-mute"}>
            {unanswered} unanswered
          </span>
          {orphans.length > 0 ? (
            <>
              <Dot />
              <span className="font-semibold text-warn">{orphans.length} unmatched</span>
            </>
          ) : null}
          {outOf > 0 ? (
            <>
              <Dot />
              <span className="ref font-semibold tabular-nums text-ink">
                {fmt(awarded)}/{fmt(outOf)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {summary ? (
          <div className="border-b border-line bg-brand-soft/40 px-4 py-3">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              <Sparkle className="h-3.5 w-3.5 shrink-0 text-brand" />
              <span className="flex-1 text-[12px] font-bold text-ink">{copy.summaryTitle}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-mute transition-transform ${
                  summaryOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {summaryOpen ? (
              <p className="mt-2 animate-markIn text-[11.5px] leading-relaxed text-body">
                {summary}
              </p>
            ) : null}
          </div>
        ) : null}

        <ul>
          {questions.map((q) => {
            const mapping = mappingByQuestion.get(q.id);
            const grade = gradeByQuestion.get(q.id);
            const isAnswered = Boolean(mapping?.answerBlockId);
            const block = mapping?.answerBlockId
              ? blockById.get(mapping.answerBlockId) ?? null
              : null;
            const selected = selectedQuestionId === q.id;
            const open = selected || expandAll;
            const uncertain = isAnswered && (mapping?.confidence ?? 1) < 0.6;

            const ref = splitRef(q.canonical, q.number);
            const chip = scoreChip({
              answered: isAnswered,
              uncertain,
              awarded: grade?.awarded ?? null,
              max: grade?.max ?? null,
              printedMarks: q.marks,
            });

            return (
              <li key={q.id} className="px-2 py-0.5">
                <button
                  type="button"
                  onClick={() => onSelectQuestion(q.id)}
                  aria-expanded={open}
                  className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-brand bg-brand-soft/25"
                      : "border-transparent hover:bg-raised"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white ${
                        selected ? "bg-brand" : isAnswered ? "bg-ink" : "bg-bad"
                      }`}
                    >
                      {ref.badge}
                    </span>

                    {ref.sub ? (
                      <span className="ref mt-1 w-3.5 shrink-0 text-[11px] font-semibold text-body">
                        {ref.sub}
                      </span>
                    ) : null}

                    <p
                      className={`min-w-0 flex-1 text-[12px] leading-[1.45] text-body ${
                        open ? "" : "line-clamp-2"
                      }`}
                    >
                      {q.text}
                    </p>

                    <span
                      className={`ref mt-0.5 shrink-0 text-[11.5px] font-semibold tabular-nums ${CHIP_CLASS[chip.tone]}`}
                    >
                      {chip.label}
                    </span>

                    <ChevronDown
                      className={`mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform ${
                        open ? "rotate-180" : ""
                      }`}
                    />
                  </div>

                  {open ? (
                    <div className="animate-markIn pl-[34px] pt-2.5">
                      {/* The transcription is what every later stage actually
                          reasoned about, so it is shown rather than kept
                          backstage. Handwriting misread here is the single
                          most likely cause of a mark that looks wrong, and
                          this is the only place it can be caught. */}
                      {block ? (
                        <div className="mb-2.5 rounded-lg border border-line bg-canvas px-2.5 py-2">
                          <div className="text-[11px] font-bold text-mute">{copy.transcribed}</div>
                          <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-body">
                            {block.transcription}
                          </p>
                        </div>
                      ) : null}

                      {grade?.feedback ? (
                        <>
                          <div className="text-[11.5px] font-bold text-ink">AI Feedback</div>
                          <p className="mt-1 text-[11.5px] leading-relaxed text-body">
                            {grade.feedback}
                          </p>
                        </>
                      ) : !isAnswered ? (
                        <p className="text-[11.5px] font-medium text-bad">{copy.missing}</p>
                      ) : (
                        <p className="text-[11.5px] text-mute">{copy.located}</p>
                      )}

                      {uncertain && audience === "teacher" ? (
                        <p className="mt-1.5 text-[11px] font-medium text-warn">
                          Matched by content rather than by a written label — worth a glance.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {orphans.length > 0 ? (
          <div className="mt-2 border-t border-line pt-3">
            <div className="px-4">
              <h3 className="text-[12px] font-bold text-bad">{copy.orphanTitle}</h3>
              <p className="mt-0.5 text-[11px] text-mute">{copy.orphanNote}</p>
            </div>
            <ul className="mt-1.5 pb-2">
              {orphans.map((b) => (
                <li key={b.id} className="px-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => onSelectOrphan(b.id)}
                    className={`w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors ${
                      selectedOrphanId === b.id
                        ? "border-bad bg-bad-soft/50"
                        : "border-transparent hover:bg-raised"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bad text-[10px] font-bold text-white">
                        ?
                      </span>
                      <span className="ref text-[11.5px] font-semibold text-bad">
                        {b.writtenLabel ?? "no label"}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 pl-[34px] text-[11.5px] leading-[1.45] text-body">
                      {b.transcription}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" aria-hidden />;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
