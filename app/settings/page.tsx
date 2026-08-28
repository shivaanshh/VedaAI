"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { deleteAssessment, fetchHealth, listAssessments, type Health } from "@/lib/api";
import { DEFAULT_PROFILE, useProfile, type Profile } from "@/lib/profile";
import type { AssessmentSummary } from "@/lib/types";

/**
 * Settings — the things about this build that are genuinely settable, and the
 * things about it that are worth knowing.
 *
 * There is no account, so the name and school are kept on this device and
 * affect only what is displayed. Everything below them is read from the running
 * server: which storage driver is live, whether it outlives a restart, which
 * model the runs go to, and whether a key is configured at all. Those four
 * decide whether the product works, so they belong somewhere a teacher can
 * look rather than only in a log.
 */

export default function SettingsRoute() {
  const { profile, save } = useProfile();
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => undefined);
    listAssessments()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const pages = (items ?? []).reduce((n, i) => n + i.answerPageCount, 0);

  const clearAll = useCallback(async () => {
    const list = items ?? [];
    if (!list.length) return;

    const ok = window.confirm(
      `Delete all ${list.length} stored run${list.length === 1 ? "" : "s"}? ` +
        "Every page image, mark and highlight goes with them. This cannot be undone."
    );
    if (!ok) return;

    setError(null);
    try {
      // Sequential rather than parallel: the filesystem driver removes a
      // directory per run, and thirty concurrent removals on a serverless host
      // is a good way to have some of them fail silently.
      for (const item of list) await deleteAssessment(item.id);
      setItems([]);
    } catch (err) {
      setError((err as Error).message);
      listAssessments().then(setItems).catch(() => undefined);
    }
  }, [items]);

  return (
    <Shell current="settings" backHref="/home" label="Settings">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 md:px-6">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">
            Settings
          </h1>
          <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-mute">
            How you are shown in the app, where your marking is stored, and which model reads the
            scripts.
          </p>

          {error ? (
            <p className="mt-5 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[12px] font-medium text-bad">
              {error}
            </p>
          ) : null}

          <IdentityCard profile={profile} onSave={save} />

          <Section
            title="Storage"
            note="Where runs are kept between visits"
          >
            {health ? (
              <>
                <Row label="Driver" value={health.storage} />
                <Row
                  label="Survives a restart"
                  value={health.durable ? "Yes" : "No"}
                  tone={health.durable ? "good" : "warn"}
                />
                <Row
                  label="Runs stored"
                  value={items === null ? "…" : `${items.length}`}
                />
                <Row
                  label="Answer pages stored"
                  value={items === null ? "…" : `${pages}`}
                />

                {!health.durable ? (
                  <p className="mt-3 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[11.5px] leading-relaxed text-warn">
                    This host writes to scratch space that is wiped when the instance recycles.
                    Setting <span className="ref font-semibold">DATABASE_URL</span> switches to
                    Postgres and history becomes permanent — nothing else about the app changes.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[12.5px] text-mute">Reading the server&hellip;</p>
            )}
          </Section>

          <Section title="Model" note="What reads the paper and the handwriting">
            {health ? (
              <>
                <Row label="Model" value={health.model} mono />
                <Row
                  label="API key configured"
                  value={health.modelConfigured ? "Yes" : "No"}
                  tone={health.modelConfigured ? "good" : "bad"}
                />
                <Row label="Handwriting" value="Read by the model, no separate OCR" />
                <Row
                  label="Daily free-tier allowance"
                  value={health.quotaBlocked ? "Used up" : "Available"}
                  tone={health.quotaBlocked ? "bad" : "good"}
                />
                <Row label="Requests in the last minute" value={`${health.requestsLastMinute}`} />

                {health.quotaBlocked ? (
                  <p className="mt-3 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[11.5px] leading-relaxed text-bad">
                    The free tier&rsquo;s daily request allowance is gone. It resets at midnight
                    Pacific time, {describeGap(health.quotaResetsInMs)} from now. Runs already
                    marked are unaffected, and a run that stopped part way keeps everything it read
                    &mdash; open it after the reset and press Retry.
                  </p>
                ) : null}

                {!health.modelConfigured ? (
                  <p className="mt-3 rounded-xl border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[11.5px] leading-relaxed text-bad">
                    Without <span className="ref font-semibold">GEMINI_API_KEY</span> a new run
                    stops the moment extraction starts. A free key from{" "}
                    <span className="ref">aistudio.google.com/apikey</span> in{" "}
                    <span className="ref font-semibold">.env.local</span> is enough.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[12.5px] text-mute">Reading the server&hellip;</p>
            )}
          </Section>

          <Section title="Sign-in" note="Why there is nothing to sign into">
            <p className="text-[12.5px] leading-relaxed text-body">
              This build has no accounts by design, so anyone with a link can open a run. A student
              gets the read-only view at <span className="ref font-semibold">/s/&lt;id&gt;</span>,
              which shows their marks and highlights but no controls that change them. The name and
              school above are display settings on this browser, not an identity the server knows
              about.
            </p>
          </Section>

          <Section title="Stored runs" note="Everything this browser has marked" danger>
            <p className="text-[12.5px] leading-relaxed text-body">
              {items === null
                ? "Counting…"
                : items.length === 0
                  ? "Nothing is stored. Mark a script and it appears in My Library."
                  : `${items.length} run${items.length === 1 ? "" : "s"} and ${pages} answer page${
                      pages === 1 ? "" : "s"
                    } are stored. Deleting one from My Library removes just that one.`}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/history"
                className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-body transition-colors hover:bg-raised"
              >
                Open My Library
              </Link>
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={!items?.length}
                className="rounded-full border border-bad/30 px-3.5 py-1.5 text-[12px] font-semibold text-bad transition-colors hover:bg-bad-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete every run
              </button>
            </div>
          </Section>
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

/** "about 3 hours" — the same phrasing the server uses in its own error. */
function describeGap(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `about ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The one card on this page that writes anything. Kept as its own component
 * with its own draft state so typing a name does not re-render the health
 * readings underneath it on every keystroke.
 */
function IdentityCard({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (next: Profile) => void;
}) {
  const [draft, setDraft] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);

  // The stored profile arrives one render after mount, so the draft has to
  // follow it in rather than being seeded once and left stale.
  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const dirty =
    draft.name !== profile.name ||
    draft.school !== profile.school ||
    draft.place !== profile.place;

  const commit = useCallback(() => {
    onSave(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }, [draft, onSave]);

  return (
    <Section title="You" note="Shown in the app on this browser only">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id="profile-name"
          label="Your name"
          placeholder={DEFAULT_PROFILE.name}
          value={draft.name}
          onChange={(name) => setDraft((d) => ({ ...d, name }))}
        />
        <Input
          id="profile-school"
          label="School"
          placeholder="Not set"
          value={draft.school}
          onChange={(school) => setDraft((d) => ({ ...d, school }))}
        />
        <Input
          id="profile-place"
          label="Place"
          placeholder="Optional second line"
          value={draft.place}
          onChange={(place) => setDraft((d) => ({ ...d, place }))}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={commit}
          disabled={!dirty}
          className="rounded-full bg-ink px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
        {saved ? <span className="text-[11.5px] font-medium text-good">Saved</span> : null}
      </div>
    </Section>
  );
}

function Input({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label htmlFor={id}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={60}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
      />
    </label>
  );
}

function Section({
  title,
  note,
  danger = false,
  children,
}: {
  title: string;
  note: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`mt-5 rounded-2xl border bg-surface px-4 py-4 ${
        danger ? "border-bad/20" : "border-line"
      }`}
    >
      <h2 className="text-[13px] font-bold text-ink">{title}</h2>
      <p className="mt-0.5 text-[11.5px] text-mute">{note}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  tone = "plain",
  mono = false,
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "warn" | "bad";
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="text-[12.5px] text-mute">{label}</span>
      <span
        className={`${mono ? "ref " : ""}text-[12.5px] font-semibold ${
          tone === "good"
            ? "text-good"
            : tone === "warn"
              ? "text-warn"
              : tone === "bad"
                ? "text-bad"
                : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
