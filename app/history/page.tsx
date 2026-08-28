"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Clock, Sparkle, Trash } from "@/components/icons";
import { deleteAssessment, fetchHealth, listAssessments, type Health } from "@/lib/api";
import { RUN_STATE_LABEL, runState, timeAgo } from "@/lib/display";
import type { AssessmentSummary } from "@/lib/types";

/**
 * Every script marked so far.
 *
 * The brief allows in-memory storage, but a teacher who marks a class of thirty
 * needs yesterday's script to still be there — so runs are persisted and this
 * is where they live. When the deployment cannot actually keep them (the
 * filesystem driver on a serverless host writes to per-instance scratch), the
 * page says so rather than quietly losing them.
 */

export default function HistoryRoute() {
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listAssessments());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchHealth().then(setHealth).catch(() => undefined);
  }, [load]);

  const remove = useCallback(async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? The pages and marks go with it.`)) return;
    setBusyId(id);
    try {
      await deleteAssessment(id);
      setItems((list) => (list ?? []).filter((i) => i.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <Shell current="library" backHref="/home" label="My Library">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-4 py-8 md:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
                My Library
              </h1>
              <p className="mt-1 text-[13px] text-mute">
                Scripts you have marked. Open one to see the highlights again — nothing is
                re-run. Hover a row to share the read-only student view of it.
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

          {health && !health.durable ? (
            <p className="mt-5 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-warn">
              This deployment is storing runs on <span className="font-semibold">{health.storage}</span>,
              which is scratch space on a serverless host — history survives a reload but not a
              redeploy or an idle period. Set <span className="ref font-semibold">DATABASE_URL</span> to
              keep it permanently.
            </p>
          ) : null}

          {error ? (
            <p className="mt-5 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[12px] font-medium text-bad">
              {error}
            </p>
          ) : null}

          {items === null ? (
            <p className="mt-8 text-[13px] text-mute">Loading&hellip;</p>
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <ul className="mt-6 space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Row
                    item={item}
                    busy={busyId === item.id}
                    onDelete={() => remove(item.id, item.title)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Row({
  item,
  busy,
  onDelete,
}: {
  item: AssessmentSummary;
  busy: boolean;
  onDelete: () => void;
}) {
  const finished = item.step === "done";
  const failed = item.step === "failed";

  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand/40">
      <Link href={`/a/${item.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-bold text-ink">{item.title}</span>
          <Status item={item} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <span className="flex items-center gap-1 text-faint">
            <Clock className="h-3 w-3" />
            {timeAgo(item.createdAt)}
          </span>

          {finished ? (
            <>
              <Dot />
              <span className="text-mute">{item.questionCount} questions</span>
              <Dot />
              <span className="font-semibold text-good">{item.answeredCount} answered</span>
              {item.unansweredCount > 0 ? (
                <>
                  <Dot />
                  <span className="font-semibold text-bad">
                    {item.unansweredCount} unanswered
                  </span>
                </>
              ) : null}
              {item.orphanCount > 0 ? (
                <>
                  <Dot />
                  <span className="font-semibold text-warn">{item.orphanCount} unmatched</span>
                </>
              ) : null}
              <Dot />
              <span className="text-faint">
                {item.answerPageCount} page{item.answerPageCount === 1 ? "" : "s"}
              </span>
            </>
          ) : failed ? (
            <>
              <Dot />
              <span className="truncate text-bad">{item.error ?? "Stopped part way"}</span>
            </>
          ) : runState(item) === "abandoned" ? (
            <>
              <Dot />
              <span className="text-mute">
                No pages were ever uploaded &mdash; safe to delete
              </span>
            </>
          ) : (
            <>
              <Dot />
              <span className="text-mute">Still running &mdash; open to continue</span>
            </>
          )}
        </div>
      </Link>

      {finished && item.outOf > 0 ? (
        <span className="ref shrink-0 text-[15px] font-bold tabular-nums text-ink">
          {fmt(item.awarded)}
          <span className="text-faint">/{fmt(item.outOf)}</span>
        </span>
      ) : null}

      {finished ? (
        <a
          href={`/s/${item.id}`}
          target="_blank"
          rel="noreferrer"
          title="Open the read-only result a student sees"
          className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-mute opacity-0 transition-all hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        >
          Student view
        </a>
      ) : null}

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Delete ${item.title}`}
        className="shrink-0 rounded-lg p-2 text-faint opacity-0 transition-all hover:bg-bad-soft hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
      >
        <Trash className="h-4 w-4" />
      </button>
    </div>
  );
}

function Status({ item }: { item: AssessmentSummary }) {
  const state = runState(item);
  if (state === "done") return null;

  // Abandoned is grey rather than red: nothing failed, the run simply never
  // received its pages. Red would send a teacher looking for a fault.
  const tone =
    state === "failed"
      ? "bg-bad-soft text-bad"
      : state === "abandoned"
        ? "bg-raised text-mute"
        : "bg-brand-soft text-brand";

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {state === "running" ? "in progress" : RUN_STATE_LABEL[state]}
    </span>
  );
}

function Empty() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <Sparkle className="mx-auto h-6 w-6 text-faint" />
      <h2 className="mt-3 font-display text-[16px] font-extrabold tracking-tight text-ink">
        Nothing marked yet
      </h2>
      <p className="mx-auto mt-1.5 max-w-[340px] text-[12.5px] leading-relaxed text-mute">
        Upload a question paper and a student&rsquo;s answer sheet, and the run will appear here
        once it finishes.
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

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
