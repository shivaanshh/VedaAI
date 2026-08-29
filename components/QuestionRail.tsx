"use client";

import { useMemo, useState } from "react";
import MarkEditor, { type ReviewPatch } from "./MarkEditor";
import { Check, ChevronDown, Search, Sparkle } from "./icons";
import { CHIP_CLASS, scoreChip, splitRef } from "@/lib/display";
import type { AnswerBlock, Grade, Mapping, Question, Review } from "@/lib/types";
import GuideTip from "./GuideTip";

/**
 * The extracted paper, in printed order, never re-sorted.
 *
 * Order comes from `Question.order`, which was frozen at extraction time. A
 * student answering 7 before 3 changes nothing here — the list is the paper,
 * not the script. Filtering hides rows; it never reorders them, because a
 * teacher reading down a filtered list is still reading down the paper.
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
    noteTitle: "Your note",
    searchLabel: "Search the paper",
    placeholder: "Search questions…",
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
    noteTitle: "From your teacher",
    searchLabel: "Search your answers",
    placeholder: "Search questions…",
  },
} as const;

/**
 * What a teacher is looking for when they stop reading top to bottom.
 *
 * These are the four questions worth asking of a marked script — what was left
 * blank, what the matcher was unsure of, where marks went, and what has already
 * been corrected — and each one is a filter rather than a screen.
 */
type Filter = "all" | "unanswered" | "review" | "lost" | "edited";

/** Below this a paper reads fine end to end and a toolbar is just clutter. */
const TOOLBAR_FROM = 8;

/**
 * Everything needed to let a teacher overrule the model. Absent for students.
 *
 * Note that the corrections themselves are NOT in here — they are a separate
 * prop, because a student must see that their teacher changed a mark and left a
 * note without being handed the controls that changed it.
 */
export interface Editing {
  /** The model's own grades and mappings, before corrections were applied. */
  modelGrades: Grade[];
  modelMappings: Mapping[];
  savingId: string | null;
  onSave: (questionId: string, patch: ReviewPatch) => void;
  onClear: (questionId: string) => void;
}

interface Props {
  questions: Question[];
  blocks: AnswerBlock[];
  /** Resolved: the teacher's corrections are already applied to these. */
  mappings: Mapping[];
  grades: Grade[];
  orphanBlockIds: string[];
  /** Corrections already applied to the values above; shown as notes and badges. */
  reviews?: Review[];
  summary: string | null;
  selectedQuestionId: string | null;
  selectedOrphanId: string | null;
  onSelectQuestion: (id: string) => void;
  onSelectOrphan: (id: string) => void;
  audience?: Audience;
  editing?: Editing;
}

export default function QuestionRail({
  questions,
  blocks,
  mappings,
  grades,
  orphanBlockIds,
  reviews,
  summary,
  selectedQuestionId,
  selectedOrphanId,
  onSelectQuestion,
  onSelectOrphan,
  audience = "teacher",
  editing,
}: Props) {
  const copy = COPY[audience];
  const [expandAll, setExpandAll] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  /**
   * Clicking the chip that is already on turns it off.
   *
   * Without this the only way back to the whole paper is the All chip, which
   * reads as a separate thing to find rather than as undoing what you just did.
   */
  const toggle = (next: Filter) => setFilter((now) => (now === next ? "all" : next));
  const [query, setQuery] = useState("");

  const mappingByQuestion = useMemo(
    () => new Map(mappings.map((m) => [m.questionId, m])),
    [mappings]
  );
  const gradeByQuestion = useMemo(() => new Map(grades.map((g) => [g.questionId, g])), [grades]);
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const reviewByQuestion = useMemo(
    () => new Map((reviews ?? []).map((r) => [r.questionId, r])),
    [reviews]
  );
  const modelGradeByQuestion = useMemo(
    () => new Map((editing?.modelGrades ?? []).map((g) => [g.questionId, g])),
    [editing?.modelGrades]
  );
  const modelMappingByQuestion = useMemo(
    () => new Map((editing?.modelMappings ?? []).map((m) => [m.questionId, m])),
    [editing?.modelMappings]
  );

  const orphans = orphanBlockIds
    .map((id) => blockById.get(id))
    .filter((b): b is AnswerBlock => Boolean(b));

  const answered = mappings.filter((m) => m.answerBlockId).length;
  const unanswered = questions.length - answered;
  const awarded = grades.reduce((s, g) => s + (g.awarded ?? 0), 0);
  const outOf = grades.reduce((s, g) => s + (g.max ?? 0), 0);

  /* ---------------------------------------------------------------- */
  /* Which rows a filter keeps                                         */
  /* ---------------------------------------------------------------- */

  const traits = useMemo(() => {
    const map = new Map<
      string,
      { unanswered: boolean; uncertain: boolean; lost: boolean; edited: boolean }
    >();

    for (const q of questions) {
      const mapping = mappingByQuestion.get(q.id);
      const grade = gradeByQuestion.get(q.id);
      const isAnswered = Boolean(mapping?.answerBlockId);

      map.set(q.id, {
        unanswered: !isAnswered,
        // A label match and a teacher's own decision are both settled. Only the
        // matcher's guesswork is worth flagging for a second look.
        uncertain: isAnswered && mapping?.method === "semantic" && (mapping?.confidence ?? 1) < 0.6,
        lost: grade?.max != null && grade.max > 0 && (grade.awarded ?? 0) < grade.max,
        edited: reviewByQuestion.has(q.id),
      });
    }
    return map;
  }, [questions, mappingByQuestion, gradeByQuestion, reviewByQuestion]);

  const counts = useMemo(() => {
    let u = 0;
    let r = 0;
    let l = 0;
    let e = 0;
    for (const t of traits.values()) {
      if (t.unanswered) u += 1;
      if (t.uncertain) r += 1;
      if (t.lost) l += 1;
      if (t.edited) e += 1;
    }
    return { all: questions.length, unanswered: u, review: r, lost: l, edited: e };
  }, [traits, questions.length]);

  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return questions.filter((q) => {
      const t = traits.get(q.id);
      if (filter === "unanswered" && !t?.unanswered) return false;
      if (filter === "review" && !t?.uncertain) return false;
      if (filter === "lost" && !t?.lost) return false;
      if (filter === "edited" && !t?.edited) return false;

      if (!needle) return true;

      const mapping = mappingByQuestion.get(q.id);
      const block = mapping?.answerBlockId ? blockById.get(mapping.answerBlockId) : null;
      // The transcription is searched too, so a teacher who remembers a phrase
      // the student wrote can find it without remembering the question number.
      return `${q.number} ${q.text} ${block?.transcription ?? ""}`.toLowerCase().includes(needle);
    });
  }, [questions, traits, filter, needle, mappingByQuestion, blockById]);

  const visibleOrphans = useMemo(() => {
    if (filter === "unanswered" || filter === "lost" || filter === "edited") return [];
    if (!needle) return orphans;
    return orphans.filter((b) =>
      `${b.writtenLabel ?? ""} ${b.transcription}`.toLowerCase().includes(needle)
    );
  }, [orphans, filter, needle]);

  const showToolbar = questions.length >= TOOLBAR_FROM;
  const filtering = filter !== "all" || needle !== "";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[13px] font-bold text-ink">
            {copy.heading} <span className="font-medium text-mute">{copy.headingNote}</span>
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

        {showToolbar ? (
          <div className="mt-2.5">
            <GuideTip id="rail-toolbar" compact className="mb-2.5" />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={copy.placeholder}
                aria-label={copy.searchLabel}
                className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-7 pr-2 text-[11.5px] text-body outline-none transition-colors focus:border-brand"
              />
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1">
              <Chip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>
                All
              </Chip>
              {counts.unanswered > 0 ? (
                <Chip
                  active={filter === "unanswered"}
                  onClick={() => toggle("unanswered")}
                  count={counts.unanswered}
                  tone="bad"
                >
                  Unanswered
                </Chip>
              ) : null}
              {counts.review > 0 && audience === "teacher" ? (
                <Chip
                  active={filter === "review"}
                  onClick={() => toggle("review")}
                  count={counts.review}
                  tone="warn"
                >
                  Needs a look
                </Chip>
              ) : null}
              {counts.lost > 0 ? (
                <Chip
                  active={filter === "lost"}
                  onClick={() => toggle("lost")}
                  count={counts.lost}
                >
                  Marks lost
                </Chip>
              ) : null}
              {counts.edited > 0 ? (
                <Chip
                  active={filter === "edited"}
                  onClick={() => toggle("edited")}
                  count={counts.edited}
                  tone="brand"
                >
                  {audience === "teacher" ? "Marked by you" : "Teacher edited"}
                </Chip>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {summary && !filtering ? (
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

        {filtering && visible.length === 0 && visibleOrphans.length === 0 ? (
          <p className="px-4 py-6 text-center text-[11.5px] text-mute">
            Nothing here matches. <button
              type="button"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
              className="font-semibold text-brand underline-offset-2 hover:underline"
            >
              Show everything
            </button>
          </p>
        ) : null}

        <ul>
          {visible.map((q) => {
            const mapping = mappingByQuestion.get(q.id);
            const grade = gradeByQuestion.get(q.id);
            const review = reviewByQuestion.get(q.id) ?? null;
            const isAnswered = Boolean(mapping?.answerBlockId);
            const block = mapping?.answerBlockId
              ? blockById.get(mapping.answerBlockId) ?? null
              : null;
            const selected = selectedQuestionId === q.id;
            const open = selected || expandAll;
            const uncertain = traits.get(q.id)?.uncertain ?? false;

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
                {/* The header is the only button. The panel below is a sibling
                    rather than a child, because it now holds inputs of its own
                    and controls nested inside a button neither validate nor
                    reliably receive their own clicks. */}
                <div
                  className={`rounded-xl border transition-colors ${
                    selected ? "border-brand bg-brand-soft/25" : "border-transparent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(q.id)}
                    aria-expanded={open}
                    className={`w-full rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                      selected ? "" : "hover:bg-raised"
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

                      {review ? (
                        <span
                          className="mt-0.5 shrink-0 text-brand"
                          title="Marked by the teacher"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span className="sr-only">Marked by the teacher</span>
                        </span>
                      ) : null}

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
                  </button>

                  {open ? (
                    <div className="animate-markIn px-2.5 pb-2.5 pl-[34px]">
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

                      {/* The teacher's own words sit below the model's and are
                          labelled as theirs. A student reading this needs to
                          know which of the two a person actually stands behind. */}
                      {review?.note ? (
                        <div className="mt-2 rounded-lg border-l-2 border-brand bg-brand-soft/25 py-1.5 pl-2.5 pr-2">
                          <div className="text-[11px] font-bold text-brand">{copy.noteTitle}</div>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-body">
                            {review.note}
                          </p>
                        </div>
                      ) : null}

                      {uncertain && audience === "teacher" ? (
                        <p className="mt-1.5 text-[11px] font-medium text-warn">
                          Matched by content rather than by a written label — worth a glance.
                        </p>
                      ) : null}

                      {audience === "student" && review ? (
                        <p className="mt-1.5 text-[11px] font-medium text-brand">
                          Your teacher reviewed this one.
                        </p>
                      ) : null}

                      {editing ? (
                        <>
                          <GuideTip id="mark-editor" compact className="mt-2.5" />
                          <MarkEditor
                            question={q}
                            grade={grade ?? null}
                            modelGrade={modelGradeByQuestion.get(q.id) ?? null}
                            review={review}
                            blocks={blocks}
                            currentBlockId={mapping?.answerBlockId ?? null}
                            modelBlockId={modelMappingByQuestion.get(q.id)?.answerBlockId ?? null}
                            busy={editing.savingId === q.id}
                            onSave={(patch) => editing.onSave(q.id, patch)}
                            onClear={() => editing.onClear(q.id)}
                          />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {visibleOrphans.length > 0 ? (
          <div className="mt-2 border-t border-line pt-3">
            <div className="px-4">
              <h3 className="text-[12px] font-bold text-bad">{copy.orphanTitle}</h3>
              <p className="mt-0.5 text-[11px] text-mute">{copy.orphanNote}</p>
              <GuideTip id="orphans" compact className="mt-2" />
            </div>
            <ul className="mt-1.5 pb-2">
              {visibleOrphans.map((b) => (
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

const CHIP_TONE = {
  plain: "border-line text-body hover:border-brand hover:text-brand",
  bad: "border-bad/40 text-bad hover:border-bad",
  warn: "border-warn/50 text-warn hover:border-warn",
  brand: "border-brand/40 text-brand hover:border-brand",
} as const;

function Chip({
  children,
  count,
  active,
  onClick,
  tone = "plain",
}: {
  children: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: keyof typeof CHIP_TONE;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
        active ? "border-ink bg-ink text-white" : `bg-surface ${CHIP_TONE[tone]}`
      }`}
    >
      {children} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
