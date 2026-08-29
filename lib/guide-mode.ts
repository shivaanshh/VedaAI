"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether guide mode is on, kept on this browser.
 *
 * Deliberately separate from lib/guide.ts: that file is copy and must stay
 * loadable anywhere, this one is React state and browser storage. Splitting
 * them is what lets a test read every explanation without a DOM.
 *
 * The same shape as useProfile — a custom event alongside `storage`, because
 * localStorage notifies other tabs but never the tab that wrote — so the top
 * bar toggle and every tip on the page turn over together.
 */

const KEY = "veda.guide";
const CHANGED = "veda:guide";

/**
 * On for a browser that has never been here.
 *
 * A guide nobody can find is not a guide, and the person most likely to be
 * looking at this build for the first time is exactly the person it is for.
 * Turning it off is one click and is remembered, so it costs a returning user
 * nothing.
 */
function read(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? true : raw === "on";
  } catch {
    // Private browsing or a blocked store. Defaulting to on matches the
    // first-visit case, which is the one that matters.
    return true;
  }
}

/**
 * Reads guide mode and re-renders when it changes anywhere.
 *
 * The first render returns false on the server and in the browser alike, and
 * the stored value arrives on the effect after it. Rendering the stored value
 * immediately would make the server's HTML disagree with the first paint and
 * trip hydration — the same reason useProfile starts on its default.
 */
export function useGuide(): { on: boolean; setOn: (next: boolean) => void; toggle: () => void } {
  const [on, setState] = useState(false);

  useEffect(() => {
    setState(read());

    const sync = () => setState(read());
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setOn = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // A browser refusing to store is not a reason to refuse the change; it
      // just will not outlive the tab.
    }

    setState(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  const toggle = useCallback(() => setOn(!on), [on, setOn]);

  return { on, setOn, toggle };
}
