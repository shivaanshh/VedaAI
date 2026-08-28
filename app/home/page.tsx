"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Clock, Library, Sparkle } from "@/components/icons";
import { fetchHealth, listAssessments, type Health } from "@/lib/api";
import { RUN_STATE_LABEL, runState, timeAgo } from "@/lib/display";
import { firstName, useProfile } from "@/lib/profile";
import type { AssessmentSummary } from "@/lib/types";

/**
 * Home, built from what has actually been marked.
 *
 * Every number on this page is derived from stored runs — there is no seeded
 * data and no placeholder. An empty account therefore shows an empty dashboard,
 * which is the honest thing for it to show: a teacher who has marked nothing
 * should not be greeted by someone else's statistics.
 */

export default function HomeRoute() {
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const { profile } = useProfile();

  useEffect(() => {
    listAssessments()
      .then(setItems)
      .catch(() => setItems([]));
    fetchHealth()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  const stats = useMemo(() => summarise(items ?? []), [items]);

  const recent = (items ?? []).slice(0, 5);
  const attention = (items ?? [])
    .filter((i) => i.step !== "done" || i.unansweredCount > 0 || i.orphanCount > 0)
    .slice(0, 4);

  return (
    <Shell current="home" label="Home">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-4 py-8 md:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
                Good to see you, {firstName(profile.name)}
              </h1>
              <p className="mt-1 text-[13px] text-mute">
                {items === null
                  ? "Reading your marking history…"
                  : stats.scripts === 0
                    ? "Nothing marked yet. Upload a paper and a script to start."
                    : `${stats.scripts} script${stats.scripts === 1 ? "" : "s"} marked so far.`}
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
              Runs are being kept on <span className="font-semibold">{health.storage}</span>, which
              is scratch space on this host &mdash; they survive a reload but not a redeploy. Set{" "}
              <span className="ref font-semibold">DATABASE_URL</span> to keep them permanently.
            </p>
          ) : null}

          {health && !health.modelConfigured ? (
            <p className="mt-3 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-bad">
              No <span className="ref font-semibold">GEMINI_API_KEY</span> is configured, so a new
              run will stop as soon as extraction starts.
            </p>
          ) : null}

          {/* ---------------- numbers ---------------- */}

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Scripts marked" value={String(stats.scripts)} sub={`${stats.pages} pages read`} />
            <Stat
              label="Questions extracted"
              value={String(stats.questions)}
              sub={`across ${stats.scripts || 0} paper${stats.scripts === 1 ? "" : "s"}`}
            />
            <Stat
              label="Answered"
              value={stats.attempted ? `${Math.round(stats.answerRate * 100)}%` : "—"}
              sub={
                stats.attempted
                  ? `${stats.unanswered} left unanswered`
                  : "no questions yet"
              }
              tone={stats.attempted && stats.answerRate < 0.7 ? "warn" : "good"}
            />
            <Stat
              label="Average score"
              value={stats.outOf ? `${Math.round((stats.awarded / stats.outOf) * 100)}%` : "—"}
              sub={stats.outOf ? `${fmt(stats.awarded)} of ${fmt(stats.outOf)} marks` : "not marked yet"}
              tone={stats.outOf && stats.awarded / stats.outOf < 0.5 ? "warn" : "good"}
            />
          </div>

          {stats.attempted > 0 ? (
            <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-bold text-ink">Coverage across every script</span>
                <span className="ref text-[11.5px] tabular-nums text-mute">
                  {stats.answered} answered &middot; {stats.unanswered} unanswered
                  {stats.orphans ? ` · ${stats.orphans} unmatched` : ""}
                </span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#EDEDED]">
                <div
                  className="bg-good"
                  style={{ width: `${(stats.answered / stats.attempted) * 100}%` }}
                />
                <div
                  className="bg-bad"
                  style={{ width: `${(stats.unanswered / stats.attempted) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* ---------------- attention ---------------- */}

          {attention.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-[13px] font-bold text-ink">Worth a look</h2>
              <p className="mt-0.5 text-[11.5px] text-mute">
                Runs that stopped, are still going, or left something unaccounted for
              </p>

              <ul className="mt-3 space-y-2">
                {attention.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/a/${item.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-brand/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] font-medium">{reason(item)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ---------------- recent ---------------- */}

          <section className="mt-8">
            <div className="flex items-baseline gap-3">
              <h2 className="flex-1 text-[13px] font-bold text-ink">Recent</h2>
              {(items?.length ?? 0) > recent.length ? (
                <Link
                  href="/history"
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-mute transition-colors hover:text-ink"
                >
                  <Library className="h-3.5 w-3.5" />
                  See all {items?.length}
                </Link>
              ) : null}
            </div>

            {items === null ? (
              <p className="mt-3 text-[12.5px] text-mute">Loading&hellip;</p>
            ) : recent.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                <Sparkle className="mx-auto h-6 w-6 text-faint" />
                <p className="mx-auto mt-3 max-w-[340px] text-[12.5px] leading-relaxed text-mute">
                  Upload a question paper and a student&rsquo;s answer sheet. Once the run
                  finishes, its numbers appear here.
                </p>
                <Link
                  href="/"
                  className="mt-5 inline-flex rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#2b2b2b]"
                >
                  Mark a script
                </Link>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {recent.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/a/${item.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-brand/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">
                          {item.title}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-faint">
                          <Clock className="h-3 w-3" />
                          {timeAgo(item.createdAt)}
                        </div>
                      </div>

                      {item.step === "done" && item.outOf > 0 ? (
                        <span className="ref shrink-0 text-[14px] font-bold tabular-nums text-ink">
                          {fmt(item.awarded)}
                          <span className="text-faint">/{fmt(item.outOf)}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11.5px] font-medium">{reason(item)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div
        className={`ref mt-1.5 text-[24px] font-bold leading-none tabular-nums ${
          tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-mute">{sub}</div>
    </div>
  );
}

function reason(item: AssessmentSummary) {
  const state = runState(item);
  if (state === "failed") return <span className="text-bad">{RUN_STATE_LABEL.failed}</span>;
  if (state === "abandoned")
    return <span className="text-faint">{RUN_STATE_LABEL.abandoned}</span>;
  if (state === "running") return <span className="text-brand">{RUN_STATE_LABEL.running}</span>;
  if (item.unansweredCount > 0)
    return <span className="text-bad">{item.unansweredCount} unanswered</span>;
  return <span className="text-warn">{item.orphanCount} unmatched</span>;
}

function summarise(items: AssessmentSummary[]) {
  const done = items.filter((i) => i.step === "done");

  const questions = done.reduce((n, i) => n + i.questionCount, 0);
  const answered = done.reduce((n, i) => n + i.answeredCount, 0);
  const unanswered = done.reduce((n, i) => n + i.unansweredCount, 0);
  const attempted = answered + unanswered;

  return {
    scripts: done.length,
    pages: done.reduce((n, i) => n + i.answerPageCount, 0),
    questions,
    answered,
    unanswered,
    attempted,
    answerRate: attempted ? answered / attempted : 0,
    orphans: done.reduce((n, i) => n + i.orphanCount, 0),
    awarded: done.reduce((n, i) => n + i.awarded, 0),
    outOf: done.reduce((n, i) => n + i.outOf, 0),
  };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
