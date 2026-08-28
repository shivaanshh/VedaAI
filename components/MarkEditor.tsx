"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Undo } from "./icons";
import type { AnswerBlock, Grade, Question, Review } from "@/lib/types";

/**
 * Where the teacher overrules the model.
 *
 * The premise of the whole app is that the model proposes and the teacher
 * disposes, and until this existed only half of that was true: a teacher could
 * read a mark they disagreed with and had no way to change it. A marking tool
 * whose marks cannot be corrected is a demo, not a tool.
 *
 * Three things get corrected here, because they are the three things the model
 * can get wrong: the mark, the reasoning shown to the student, and which answer
 * the question was paired with. The last one matters more than it looks — a
 * misplaced answer makes the mark wrong for two questions at once, and no
 * amount of editing numbers fixes the underlying pairing.
 */

export interface ReviewPatch {
  awarded?: number | null;
  note?: string | null;
  answerBlockId?: string | null;
}

interface Props {
  question: Question;
  /** The grade as it currently stands, after any earlier correction. */
  grade: Grade | null;
  /** What the model itself said, kept so an override can be shown against it. */
  modelGrade: Grade | null;
  review: Review | null;
  blocks: AnswerBlock[];
  currentBlockId: string | null;
  modelBlockId: string | null;
  busy: boolean;
  onSave: (patch: ReviewPatch) => void;
  onClear: () => void;
}

/** Marking happens in halves. Anything finer is a slip, not a judgement. */
const STEP = 0.5;

export default function MarkEditor({
  question,
  grade,
  modelGrade,
  review,
  blocks,
  currentBlockId,
  modelBlockId,
  busy,
  onSave,
  onClear,
}: Props) {
  const max = grade?.max ?? question.marks ?? null;

  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [blockId, setBlockId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  /* The form is seeded from the saved state every time it opens, so closing it
     without saving discards the edit rather than leaving it to reappear later
     looking like something that was stored. */
  useEffect(() => {
    if (!open) return;
    setMark(grade?.awarded === null || grade?.awarded === undefined ? "" : String(grade.awarded));
    setNote(review?.note ?? "");
    setBlockId(currentBlockId ?? NOTHING);
    setError(null);
  }, [open, grade?.awarded, review?.note, currentBlockId]);

  const quick = useMemo(() => {
    if (max === null || max <= 0) return [];
    const half = Math.round((max / 2) * 2) / 2;
    return [0, half, max].filter((v, i, a) => a.indexOf(v) === i);
  }, [max]);

  if (!open) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11px] font-semibold text-body transition-colors hover:border-brand hover:text-brand"
        >
          {review ? "Edit your change" : "Change mark"}
        </button>

        {review ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-bold text-brand">
              <Check className="h-3 w-3" />
              Marked by you
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onClear}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-mute underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50"
            >
              <Undo className="h-3 w-3" />
              Undo
            </button>
          </>
        ) : null}
      </div>
    );
  }

  const dirty =
    mark !== (grade?.awarded === null || grade?.awarded === undefined ? "" : String(grade.awarded)) ||
    note !== (review?.note ?? "") ||
    blockId !== (currentBlockId ?? NOTHING);

  function submit() {
    const patch: ReviewPatch = {};

    const trimmed = mark.trim();
    if (trimmed === "") patch.awarded = null;
    else {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return setError("That mark is not a number.");
      if (n < 0) return setError("A mark cannot be negative.");
      if (max !== null && max > 0 && n > max) {
        return setError(`This question is worth ${max}.`);
      }
      patch.awarded = n;
    }

    patch.note = note.trim() ? note.trim() : null;

    // Only sent when the teacher actually moved it, so an untouched dropdown
    // never overwrites the matcher's decision with the same value dressed up as
    // a human judgement.
    if (blockId !== (currentBlockId ?? NOTHING)) {
      patch.answerBlockId = blockId === NOTHING ? null : blockId;
    }

    setError(null);
    onSave(patch);
    setOpen(false);
  }

  return (
    <div className="mt-2.5 rounded-xl border border-brand/40 bg-brand-soft/20 p-2.5">
      {/* ---- the mark ---- */}
      <div className="text-[11px] font-bold text-ink">Marks</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {quick.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setMark(String(v))}
            className={`ref rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums transition-colors ${
              mark === String(v)
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-body hover:border-brand hover:text-brand"
            }`}
          >
            {fmt(v)}
          </button>
        ))}

        <input
          type="number"
          inputMode="decimal"
          step={STEP}
          min={0}
          {...(max !== null && max > 0 ? { max } : {})}
          value={mark}
          onChange={(e) => setMark(e.target.value)}
          placeholder="—"
          aria-label={`Marks for question ${question.number}`}
          className="ref w-16 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-semibold tabular-nums text-ink outline-none focus:border-brand"
        />
        <span className="ref text-[11.5px] font-semibold tabular-nums text-mute">
          / {max === null ? "—" : fmt(max)}
        </span>
      </div>

      {/* ---- which answer this is ---- */}
      {blocks.length > 0 ? (
        <>
          <div className="mt-2.5 text-[11px] font-bold text-ink">Answer on the sheet</div>
          <select
            value={blockId}
            onChange={(e) => setBlockId(e.target.value)}
            aria-label={`Answer paired with question ${question.number}`}
            className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-body outline-none focus:border-brand"
          >
            <option value={NOTHING}>Nothing on the sheet answers this</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {label(b)}
                {b.id === modelBlockId ? "  (the model's pick)" : ""}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {/* ---- why ---- */}
      <div className="mt-2.5 text-[11px] font-bold text-ink">
        Your note <span className="font-medium text-mute">(optional, shown to the student)</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="Why you changed it."
        aria-label={`Note on question ${question.number}`}
        className="mt-1 w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-[11.5px] leading-relaxed text-body outline-none focus:border-brand"
      />

      {modelGrade && modelGrade.awarded !== null ? (
        <p className="mt-1.5 text-[10.5px] text-mute">
          The model gave {fmt(modelGrade.awarded)}
          {modelGrade.max !== null ? ` of ${fmt(modelGrade.max)}` : ""}.
        </p>
      ) : null}

      {error ? <p className="mt-1.5 text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={submit}
          className="rounded-lg bg-brand px-3 py-1 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1 text-[11.5px] font-medium text-mute transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Sentinel for the select, since an <option> cannot carry a null value. */
const NOTHING = "__none__";

function label(b: AnswerBlock): string {
  const head = b.writtenLabel ? `${b.writtenLabel} — ` : "";
  const body = b.transcription.replace(/\s+/g, " ").trim();
  return `${head}${body.length > 64 ? `${body.slice(0, 64)}…` : body || "(blank)"}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
