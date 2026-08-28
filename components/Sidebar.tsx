"use client";

import Link from "next/link";
import { useProfile } from "@/lib/profile";
import {
  Assignments,
  ChevronsRight,
  Classroom,
  Crest,
  Exams,
  Home,
  Library,
  PanelToggle,
  Settings,
  Sparkle,
} from "./icons";

/**
 * Product chrome from the design. Every destination is a working screen built
 * from stored runs — there is no seeded data anywhere behind this list.
 *
 * Exams starts a marking run and My Library holds the ones already marked.
 * Home totals them. My Classroom groups them by the student whose script it is
 * and Assignments by the paper they were marked against, which is why a run
 * carries both: one script answers "how did this go", a term of them answers
 * "how is this student doing" and "how did the class find this paper".
 */

export type NavKey = "home" | "classroom" | "assignments" | "exams" | "library" | "settings";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  current: NavKey;
}

/** Shared with the phone drawer in TopBar, so the two cannot drift apart. */
export const NAV: Array<{ key: NavKey; label: string; Icon: typeof Home; href: string }> = [
  { key: "home", label: "Home", Icon: Home, href: "/home" },
  { key: "classroom", label: "My Classroom", Icon: Classroom, href: "/classroom" },
  { key: "assignments", label: "Assignments", Icon: Assignments, href: "/assignments" },
  { key: "exams", label: "Exams", Icon: Exams, href: "/exams" },
  { key: "library", label: "My Library", Icon: Library, href: "/history" },
];

export default function Sidebar({ collapsed, onToggle, current }: Props) {
  const { profile } = useProfile();

  if (collapsed) {
    return (
      <nav
        aria-label="Sections"
        className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:flex"
      >
        <Logo compact />

        <Link
          href="/"
          title="New marking run"
          className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-ink text-brand ring-2 ring-brand ring-offset-2 ring-offset-surface transition-transform hover:scale-105"
        >
          <Sparkle className="h-4 w-4" />
        </Link>

        <ul className="mt-4 flex flex-col items-center gap-1">
          {NAV.map(({ key, label, Icon, href }) => {
            const active = key === current;

            return (
              <li key={key}>
                <Link
                  href={href}
                  title={label}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    active ? "bg-raised text-ink" : "text-mute hover:bg-raised hover:text-ink"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex-1" />

        <Link
          href="/settings"
          title={profile.school || "Add your school in Settings"}
          aria-label={profile.school || "Add your school in Settings"}
          className={`rounded-lg p-0.5 transition-opacity hover:opacity-100 ${
            profile.school ? "" : "opacity-40"
          }`}
        >
          <Crest className="h-7 w-7" />
        </Link>

        <button
          type="button"
          onClick={onToggle}
          title="Expand sidebar"
          className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Sections"
      className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex"
    >
      <div className="flex items-center justify-between px-1">
        <Logo />
        <button
          type="button"
          onClick={onToggle}
          title="Collapse sidebar"
          className="rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <PanelToggle className="h-[18px] w-[18px]" />
        </button>
      </div>

      <Link
        href="/"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white ring-[1.5px] ring-brand transition-colors hover:bg-[#2b2b2b]"
      >
        <Sparkle className="h-3.5 w-3.5 text-brand" />
        AI Teacher&rsquo;s Toolkit
      </Link>

      <ul className="mt-6 space-y-0.5">
        {NAV.map(({ key, label, Icon, href }) => {
          const active = key === current;

          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
                  active
                    ? "bg-raised font-semibold text-ink"
                    : "font-medium text-mute hover:bg-raised hover:text-ink"
                }`}
              >
                <Icon className="h-[17px] w-[17px] shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      <Link
        href="/settings"
        aria-current={current === "settings" ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
          current === "settings"
            ? "bg-raised font-semibold text-ink"
            : "font-medium text-mute hover:bg-raised hover:text-ink"
        }`}
      >
        <Settings className="h-[17px] w-[17px] shrink-0" />
        Settings
      </Link>

      {/* The design puts a school here. There is no account to read one from,
          so the teacher sets it in Settings and it is kept on this device.
          Until then this offers to collect it rather than showing a school
          nobody chose. */}
      <Link
        href="/settings"
        className="mt-3 flex items-center gap-2.5 rounded-xl bg-raised px-3 py-2.5 transition-colors hover:bg-[#E9E9E9]"
      >
        <Crest className={`h-7 w-7 shrink-0 ${profile.school ? "" : "opacity-40"}`} />
        <div className="min-w-0">
          {profile.school ? (
            <>
              <div className="truncate text-[12.5px] font-bold text-ink">{profile.school}</div>
              {profile.place ? (
                <div className="truncate text-[11px] text-mute">{profile.place}</div>
              ) : null}
            </>
          ) : (
            <>
              <div className="truncate text-[12.5px] font-bold text-mute">Add your school</div>
              <div className="truncate text-[11px] text-faint">Shown here once set</div>
            </>
          )}
        </div>
      </Link>
    </nav>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/home" className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="#fff">
          <path d="M4.5 5h3.2l4.3 10.4L16.3 5h3.2l-6 14h-3z" />
        </svg>
      </span>
      {!compact && (
        <span className="font-display text-[17px] font-extrabold tracking-tight text-ink">
          VedaAI
        </span>
      )}
    </Link>
  );
}
