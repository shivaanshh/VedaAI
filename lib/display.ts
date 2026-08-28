/**
 * Presentation-only helpers. Nothing here feeds matching — the canonical key
 * and the printed number both stay exactly as `lib/normalize.ts` left them.
 *
 * The design renders a question as a numbered disc with the sub-part beside it:
 * "11 (a)" becomes a disc reading 11 and a small "a." next to it, so that 11(a)
 * and 11(b) share a disc and read as one question with two parts.
 */

export interface Ref {
  /** Goes inside the disc. */
  badge: string;
  /** Sits beside the disc, already punctuated. Null for a whole question. */
  sub: string | null;
}

export function splitRef(canonical: string, printed: string): Ref {
  const key = canonical.trim();

  if (!key) {
    // Nothing canonicalised — show whatever the paper printed rather than
    // inventing a number.
    return { badge: printed.trim() || "?", sub: null };
  }

  const parts = key.split("|");
  const badge = parts[0];
  const rest = parts.slice(1);

  return {
    badge,
    sub: rest.length ? `${rest.join(".")}.` : null,
  };
}

/**
 * How long a run may sit at "uploading" with nothing uploaded before it is
 * treated as abandoned rather than in flight. Rasterising and posting a long
 * script takes under a minute on a slow machine; ten is generous.
 */
const ABANDONED_AFTER_MS = 10 * 60_000;

export type RunState = "done" | "failed" | "abandoned" | "running";

/**
 * The one place that decides what a stored run currently is.
 *
 * "abandoned" exists because a teacher who opens the upload screen and closes
 * the tab leaves a record behind with no pages attached to it. Nothing is
 * wrong with it and nothing is coming, but every list showed it as "in
 * progress" — a spinner for work that stopped before it began, sitting at the
 * top of the history forever. Naming the state is what lets all three lists
 * say so and offer the only useful action, which is deleting it.
 */
export function runState(
  run: { step: string; answerPageCount: number; updatedAt: string },
  now = Date.now()
): RunState {
  if (run.step === "done") return "done";
  if (run.step === "failed") return "failed";

  const age = now - Date.parse(run.updatedAt);
  if (run.step === "uploading" && run.answerPageCount === 0 && age > ABANDONED_AFTER_MS) {
    return "abandoned";
  }

  return "running";
}

/** The words each list uses, so none of them invents its own. */
export const RUN_STATE_LABEL: Record<RunState, string> = {
  done: "done",
  failed: "stopped",
  abandoned: "never uploaded",
  running: "still running",
};

export type ChipTone = "good" | "warn" | "bad" | "mute";

export interface Chip {
  label: string;
  tone: ChipTone;
}

/**
 * The score chip on the right of every question row.
 *
 * An unanswered question scores zero out of whatever the paper allocated — the
 * design shows "0/2" in red rather than the word "unanswered", because a
 * teacher totalling a script needs the number, not the status.
 */
export function scoreChip(opts: {
  answered: boolean;
  uncertain: boolean;
  awarded: number | null;
  max: number | null;
  printedMarks: number | null;
}): Chip {
  const { answered, uncertain, awarded, max, printedMarks } = opts;

  if (!answered) {
    return printedMarks !== null
      ? { label: `0/${trim(printedMarks)}`, tone: "bad" }
      : { label: "Unanswered", tone: "bad" };
  }

  if (awarded !== null && max !== null) {
    const tone: ChipTone = awarded >= max ? "good" : awarded <= 0 ? "bad" : "warn";
    return { label: `${trim(awarded)}/${trim(max)}`, tone };
  }

  if (uncertain) return { label: "Check match", tone: "warn" };
  return { label: "Answered", tone: "mute" };
}

export const CHIP_CLASS: Record<ChipTone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  mute: "text-mute",
};

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * "12 min ago", "3 d ago", then a date once a week has passed.
 *
 * Every list of runs uses this, so they cannot describe the same timestamp two
 * different ways. Safe to call during render only in a client component: it
 * reads the clock and the browser's locale, and rendering it on the server too
 * would produce a different string on each side and trip hydration.
 */
export function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";

  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))} d ago`;

  return new Date(then).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
