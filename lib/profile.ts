"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Who is using this browser.
 *
 * The brief rules out authentication, so there is no account to read a name
 * from. The design still shows one in the application bar and a school on the
 * sidebar, and inventing a teacher and a school there would be a caption
 * pretending to be data. Instead the teacher sets both in Settings and they are
 * kept on this device — which is the truthful scope of the claim: this is the
 * name shown on this browser, not an identity the server knows about.
 *
 * Nothing here reaches the API. Marking does not depend on it, and a fresh
 * browser gets sensible neutral defaults rather than somebody else's name.
 */

export interface Profile {
  /** Shown in the application bar and used to greet on Home. */
  name: string;
  /** Shown on the sidebar crest. Empty until set — the crest hides itself. */
  school: string;
  /** Second line of the crest: a town, a campus, a branch. */
  place: string;
}

export const DEFAULT_PROFILE: Profile = { name: "Teacher", school: "", place: "" };

const KEY = "veda.profile";

/**
 * localStorage fires `storage` only in OTHER tabs, so a component in the tab
 * that saved would never hear about it. This event covers that gap and keeps
 * the sidebar, the application bar and Home in step after a save.
 */
const CHANGED = "veda:profile";

function read(): Profile {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;

    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      name: clean(parsed.name) || DEFAULT_PROFILE.name,
      school: clean(parsed.school),
      place: clean(parsed.place),
    };
  } catch {
    // Private browsing, a cleared store, or something hand-edited into the key.
    // A default profile is a complete answer in all three cases.
    return DEFAULT_PROFILE;
  }
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Reads the stored profile and re-renders when it changes anywhere.
 *
 * The first render always returns the default, on the server and in the
 * browser alike, and the stored value arrives on the effect that follows. That
 * is deliberate: rendering a stored name straight away would make the server's
 * HTML and the browser's first paint disagree and trip hydration.
 */
export function useProfile(): { profile: Profile; save: (next: Profile) => void } {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);

  useEffect(() => {
    setProfile(read());

    const sync = () => setProfile(read());
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = useCallback((next: Profile) => {
    const cleaned: Profile = {
      name: clean(next.name) || DEFAULT_PROFILE.name,
      school: clean(next.school),
      place: clean(next.place),
    };

    try {
      window.localStorage.setItem(KEY, JSON.stringify(cleaned));
    } catch {
      // A browser refusing to store is not a reason to refuse the change; it
      // just will not outlive the tab.
    }

    setProfile(cleaned);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return { profile, save };
}

/** "Priya Nair" -> "PN". What the avatar disc shows. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "T";

  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** The greeting on Home uses the first name only. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || DEFAULT_PROFILE.name;
}
