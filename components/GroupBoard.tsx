"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "./Shell";
import { ChevronDown, Clock, Sparkle } from "./icons";
import { listAssessments, updateAssessment } from "@/lib/api";
import { fmt, groupBy, percent, type GroupField } from "@/lib/cohort";
import { RUN_STATE_LABEL, runState, timeAgo } from "@/lib/display";
import type { NavKey } from "./Sidebar";
import type { AssessmentSummary } from "@/lib/types";

/**
 * My Classroom and Assignments are the same board over the same history, read
 * on a different key — students, or the papers they sat. Building it once means
 * a fix to how an average is shown or how a run is filed lands on both, and
 * the two can never disagree about the same run.
 *
 * Nothing here is seeded. A group exists because a stored run names it, so an
 * account that has marked nothing shows an empty board and says how to fill it
 * rather than showing a class that does not exist.
 */

export interface BoardCopy {
  nav: NavKey;
  /** Page heading and the browser breadcrumb. */
  title: string;
  intro: string;
  /** One group, in the singular: "student", "paper". */
  noun: string;
  /** The column of numbers beside a group. */
  countLabel: (n: number) => string;
  /** Heading over the runs nothing has filed yet. */
  unfiledTitle: string;
  unfiledHint: string;
  /** Placeholder in the inline filing input. */
  filePlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
}

export default function GroupBoard({ field, copy }: { field: GroupField; copy: BoardCopy }) {
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listAssessments());
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { groups, unfiled } = useMemo(() => groupBy(items ?? [], field), [items, field]);

  /**
   * Filing is applied locally rather than by reloading the whole list. The
   * server has already accepted it, and a full refetch would drop the run out
   * of the unfiled column and back in a moment later.
   */
  const file = useCallback(
    async (id: string, value: string) => {
      const saved = await updateAssessment(id, { [field]: value });
      setItems((list) =>
        (list ?? []).map((i) => (i.id === id ? { ...i, [field]: saved[field] } : i))
      );
    },
    [field]
  );

  const marked = groups.reduce((n, g) => n + g.marked, 0);

  return (
    <Shell current={copy.nav} backHref="/home" label={copy.title}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-4 py-8 md:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
                {copy.title}
              </h1>
              <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-mute">
                {copy.intro}
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

          {items === null ? (
            <p className="mt-8 text-[13px] text-mute">Loading&hellip;</p>
          ) : groups.length === 0 && unfiled.length === 0 ? (
            <Empty title={copy.emptyTitle} body={copy.emptyBody} />
          ) : (
            <>
              {groups.length > 0 ? (
                <p className="mt-6 text-[11.5px] text-mute">
                  {groups.length} {copy.noun}
                  {groups.length === 1 ? "" : "s"} &middot; {marked} script
                  {marked === 1 ? "" : "s"} marked
                </p>
              ) : null}

              <ul className="mt-3 space-y-2">
                {groups.map((group) => (
                  <li key={group.key}>
                    <GroupRow group={group} countLabel={copy.countLabel} />
                  </li>
                ))}
              </ul>

              {unfiled.length > 0 ? (
                <section className="mt-8">
                  <h2 className="text-[13px] font-bold text-ink">{copy.unfiledTitle}</h2>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-mute">
                    {copy.unfiledHint}
                  </p>

                  <ul className="mt-3 space-y-2">
                    {unfiled.map((item) => (
                      <li key={item.id}>
                        <UnfiledRow
                          item={item}
                          placeholder={copy.filePlaceholder}
                          onFile={(value) => file(item.id, value)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function GroupRow({
  group,
  countLabel,
}: {
  group: ReturnType<typeof groupBy>["groups"][number];
  countLabel: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);

  const answerRate =
    group.answered + group.unanswered > 0
      ? group.answered / (group.answered + group.unanswered)
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-ink">{group.key}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span className="text-mute">{countLabel(group.marked)}</span>
            {group.pending > 0 ? (
              <>
                <Dot />
                <span className="font-semibold text-brand">
                  {group.pending} not finished
                </span>
              </>
            ) : null}
            {group.unanswered > 0 ? (
              <>
                <Dot />
                <span className="font-semibold text-bad">{group.unanswered} unanswered</span>
              </>
            ) : null}
            {group.orphans > 0 ? (
              <>
                <Dot />
                <span className="font-semibold text-warn">{group.orphans} unmatched</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div
            className={`ref text-[17px] font-bold leading-none tabular-nums ${
              group.score === null
                ? "text-faint"
                : group.score < 0.5
                  ? "text-bad"
                  : group.score < 0.75
                    ? "text-warn"
                    : "text-good"
            }`}
          >
            {percent(group.score)}
          </div>
          <div className="mt-1 text-[10.5px] text-faint">
            {group.outOf > 0 ? `${fmt(group.awarded)} of ${fmt(group.outOf)}` : "no marks yet"}
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* The bar is the same reading as the percentage above, split by what a
          teacher can act on: questions left blank are a different problem from
          questions attempted and marked down. */}
      {answerRate !== null ? (
        <div className="px-4 pb-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[#EDEDED]">
            <div className="bg-good" style={{ width: `${answerRate * 100}%` }} />
            <div className="bg-bad" style={{ width: `${(1 - answerRate) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {open ? (
        <ul className="animate-markIn border-t border-line">
          {group.runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/a/${run.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-raised"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">{run.title}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
                    <Clock className="h-3 w-3" />
                    {timeAgo(run.createdAt)}
                  </div>
                </div>

                {run.step === "done" && run.outOf > 0 ? (
                  <span className="ref shrink-0 text-[12.5px] font-bold tabular-nums text-ink">
                    {fmt(run.awarded)}
                    <span className="text-faint">/{fmt(run.outOf)}</span>
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      runState(run) === "failed"
                        ? "text-bad"
                        : runState(run) === "abandoned"
                          ? "text-faint"
                          : "text-brand"
                    }`}
                  >
                    {RUN_STATE_LABEL[runState(run)]}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A run that names nobody, with the one control that fixes that.
 *
 * Filing from here rather than only at upload time is what makes the board
 * usable on a history that already exists — otherwise every script marked
 * before today would be permanently outside it.
 */
function UnfiledRow({
  item,
  placeholder,
  onFile,
}: {
  item: AssessmentSummary;
  placeholder: string;
  onFile: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const name = value.trim();
    if (!name || busy) return;

    setBusy(true);
    setFailed(null);
    try {
      await onFile(name);
    } catch (err) {
      setFailed((err as Error).message);
      setBusy(false);
    }
  }, [value, busy, onFile]);

  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/a/${item.id}`} className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-faint">
            <Clock className="h-3 w-3" />
            {timeAgo(item.createdAt)}
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <input
            type="text"
            value={value}
            maxLength={120}
            disabled={busy}
            placeholder={placeholder}
            aria-label={`${placeholder} for ${item.title}`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="w-[180px] rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !value.trim()}
            className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "File"}
          </button>
        </div>
      </div>

      {failed ? <p className="mt-2 text-[11px] font-medium text-bad">{failed}</p> : null}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <Sparkle className="mx-auto h-6 w-6 text-faint" />
      <h2 className="mt-3 font-display text-[16px] font-extrabold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[12.5px] leading-relaxed text-mute">{body}</p>
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
