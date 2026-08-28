"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { NAV, type NavKey } from "./Sidebar";
import { ArrowLeft, Bell, ChevronDown, Close, Exams, Help, Menu, Settings, Sparkle } from "./icons";
import { listAssessments } from "@/lib/api";
import { initials, useProfile } from "@/lib/profile";
import type { AssessmentSummary } from "@/lib/types";

/**
 * Application bar. On desktop it shows the breadcrumb into the current section;
 * on a phone the design swaps the breadcrumb for the wordmark.
 *
 * The sidebar is desktop-only, so on a phone this bar is the only way to move
 * around — hence the drawer behind the menu button. It reuses the sidebar's own
 * NAV list rather than repeating it, so a destination cannot exist in one place
 * and not the other.
 */

interface Props {
  /** Highlighted in the phone drawer. */
  current?: NavKey;
  backHref?: string;
  /** Breadcrumb text. Defaults to the section the design shows. */
  label?: string;
}

export default function TopBar({ current, backHref, label = "Exams" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { profile } = useProfile();

  // A drawer that survives navigation would cover the page it just opened.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Back"
            className="rounded-md p-1.5 text-mute transition-colors hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
        ) : (
          <span aria-hidden className="rounded-md p-1.5 text-mute opacity-40">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </span>
        )}

        {/* Desktop: breadcrumb. */}
        <div className="hidden items-center gap-2 md:flex">
          <Exams className="h-4 w-4 shrink-0 text-mute" />
          <span className="max-w-[320px] truncate text-[13px] font-medium text-body">{label}</span>
        </div>

        {/* Phone: wordmark. */}
        <Link href="/home" className="flex items-center gap-2 md:hidden">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden fill="#fff">
              <path d="M4.5 5h3.2l4.3 10.4L16.3 5h3.2l-6 14h-3z" />
            </svg>
          </span>
          <span className="font-display text-[15px] font-extrabold tracking-tight">VedaAI</span>
        </Link>

        <div className="flex-1" />

        <HelpMenu />
        <Notifications />

        <Link
          href="/"
          aria-label="Mark a new script"
          title="Mark a new script"
          className="hidden rounded-md p-1.5 text-brand transition-colors hover:bg-brand-soft md:block"
        >
          <Sparkle className="h-[18px] w-[18px]" />
        </Link>

        <Link
          href="/settings"
          title="Your name and school, storage and model"
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-raised"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[11px] font-bold text-brand ring-1 ring-line">
            {initials(profile.name)}
          </span>
          <span className="hidden max-w-[140px] truncate text-[13px] font-semibold text-ink md:inline">
            {profile.name}
          </span>
          <ChevronDown className="hidden h-4 w-4 text-mute md:block" />
        </Link>

        <button
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="rounded-md p-1.5 text-ink transition-colors hover:bg-raised md:hidden"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Sections">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />

          <nav className="absolute right-0 top-0 flex h-full w-[248px] animate-riseIn flex-col border-l border-line bg-surface px-3 py-4">
            <div className="flex items-center justify-between px-1">
              <span className="font-display text-[16px] font-extrabold tracking-tight text-ink">
                VedaAI
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="rounded-md p-1.5 text-mute transition-colors hover:bg-raised hover:text-ink"
              >
                <Close className="h-[18px] w-[18px]" />
              </button>
            </div>

            <Link
              href="/"
              onClick={() => setMenuOpen(false)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white ring-[1.5px] ring-brand"
            >
              <Sparkle className="h-3.5 w-3.5 text-brand" />
              Mark a script
            </Link>

            <ul className="mt-5 space-y-0.5">
              {NAV.map(({ key, label: name, Icon, href }) => (
                <li key={key}>
                  <Link
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={key === current ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13px] ${
                      key === current
                        ? "bg-raised font-semibold text-ink"
                        : "font-medium text-mute"
                    }`}
                  >
                    <Icon className="h-[17px] w-[17px] shrink-0" />
                    {name}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex-1" />

            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13px] ${
                current === "settings"
                  ? "bg-raised font-semibold text-ink"
                  : "font-medium text-mute"
              }`}
            >
              <Settings className="h-[17px] w-[17px] shrink-0" />
              Settings
            </Link>
          </nav>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Popover plumbing                                                    */
/* ------------------------------------------------------------------ */

/**
 * A panel anchored under a bar button. Closes on Escape and on a click
 * anywhere outside it, because a panel that can only be dismissed by pressing
 * the same button again is a panel people leave open by accident.
 */
function Popover({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      // The anchor button handles its own toggle, so a click on it must not be
      // treated as "outside" or the panel would close and reopen in one press.
      const target = e.target as Node;
      if (ref.current && !ref.current.parentElement?.contains(target)) onClose();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={labelledBy}
      className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] animate-riseIn overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

/**
 * What the product actually does, written down.
 *
 * Everything listed here is a control that exists on the screens this bar sits
 * above — the four stages a run passes through, what each chip in the question
 * list means, and the two keys that walk it. It is documentation of this build,
 * not a marketing panel.
 */
function HelpMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative hidden md:block">
      <button
        type="button"
        aria-label="How this works"
        aria-expanded={open}
        title="How this works"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md p-1.5 transition-colors hover:bg-raised hover:text-ink ${
          open ? "bg-raised text-ink" : "text-mute"
        }`}
      >
        <Help className="h-[18px] w-[18px]" />
      </button>

      <Popover open={open} onClose={close} labelledBy="help-title">
        <div className="border-b border-line px-4 py-3">
          <h2 id="help-title" className="text-[13px] font-bold text-ink">
            How a run works
          </h2>
          <p className="mt-0.5 text-[11.5px] text-mute">Four stages, in order</p>
        </div>

        <ol className="px-4 py-3">
          {[
            ["Questions", "Every question on the paper is read out in printed order. A labelled sub-part is its own question."],
            ["Answers", "The handwriting is transcribed page by page, with the region each answer occupies."],
            ["Mapping", "Written labels are matched first. Anything left over is matched on what it says."],
            ["Grading", "Each answer is marked against its question, with a note explaining the mark."],
          ].map(([name, what], i) => (
            <li key={name} className="flex gap-2.5 py-1.5">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[10.5px] font-bold text-ink">
                {i + 1}
              </span>
              <p className="text-[11.5px] leading-relaxed text-body">
                <span className="font-bold text-ink">{name}.</span> {what}
              </p>
            </li>
          ))}
        </ol>

        <div className="border-t border-line px-4 py-3">
          <h3 className="text-[12px] font-bold text-ink">Reading the question list</h3>
          <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-body">
            <li>
              <span className="font-semibold text-bad">0/2 in red</span> — nothing on the sheet
              answers it.
            </li>
            <li>
              <span className="font-semibold text-warn">Unmatched</span> — writing that answers no
              question on the paper.
            </li>
            <li>
              <span className="font-semibold text-warn">Check match</span> — matched on meaning
              rather than a written number.
            </li>
          </ul>
        </div>

        <div className="border-t border-line px-4 py-3">
          <h3 className="text-[12px] font-bold text-ink">While marking</h3>
          <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-body">
            <li>Click a question to highlight its answer on the sheet.</li>
            <li>
              <Key>↑</Key> and <Key>↓</Key> walk the paper once the list has focus.
            </li>
            <li>Share with student hands over a read-only copy of the result.</li>
          </ul>
        </div>
      </Popover>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="ref rounded border border-line bg-canvas px-1 py-px text-[10.5px] font-semibold text-body">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runs that want the teacher's attention, read from stored history.
 *
 * The dot only appears when there is genuinely something here. A run that
 * stopped is the urgent case — it needs a resume and nothing else will move it.
 * A run still in flight is next: the work is server-side, so it can be picked
 * up in any tab, and a teacher who closed the workspace has no other way to
 * find out it is still going.
 */
function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const close = useCallback(() => setOpen(false), []);

  // Loaded on mount so the dot is truthful before anything is clicked, and
  // again on open so a panel is never showing a stale list.
  const load = useCallback(() => {
    listAssessments()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(load, [load]);

  const stopped = (items ?? []).filter((i) => i.step === "failed");
  const running = (items ?? []).filter((i) => i.step !== "failed" && i.step !== "done");
  const count = stopped.length + running.length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={count ? `Notifications, ${count} needing attention` : "Notifications"}
        aria-expanded={open}
        title={count ? `${count} run${count === 1 ? "" : "s"} need attention` : "Nothing needs attention"}
        onClick={() => {
          load();
          setOpen((v) => !v);
        }}
        className={`relative rounded-md p-1.5 transition-colors hover:bg-raised hover:text-ink ${
          open ? "bg-raised text-ink" : "text-mute"
        }`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
        ) : null}
      </button>

      <Popover open={open} onClose={close} labelledBy="notifications-title">
        <div className="border-b border-line px-4 py-3">
          <h2 id="notifications-title" className="text-[13px] font-bold text-ink">
            Needs attention
          </h2>
          <p className="mt-0.5 text-[11.5px] text-mute">
            {items === null
              ? "Reading your runs…"
              : count === 0
                ? "Every run finished. Nothing waiting."
                : `${count} run${count === 1 ? "" : "s"} from your history`}
          </p>
        </div>

        {count > 0 ? (
          <ul className="max-h-[300px] overflow-y-auto py-1.5">
            {[...stopped, ...running].map((item) => (
              <li key={item.id}>
                <Link
                  href={`/a/${item.id}`}
                  onClick={close}
                  className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-raised"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      item.step === "failed" ? "bg-bad" : "bg-brand"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">
                    {item.title}
                  </span>
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      item.step === "failed" ? "text-bad" : "text-brand"
                    }`}
                  >
                    {item.step === "failed" ? "resume" : "running"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : items !== null ? (
          <p className="px-4 py-5 text-center text-[11.5px] text-mute">
            Stopped and in-flight runs show up here.
          </p>
        ) : null}
      </Popover>
    </div>
  );
}
