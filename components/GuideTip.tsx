"use client";

import { useState } from "react";
import { GUIDE, type GuideId } from "@/lib/guide";
import { useGuide } from "@/lib/guide-mode";
import { Bulb, ChevronDown, Close } from "./icons";

/**
 * One explanation, pinned beside the thing it explains.
 *
 * Collapsed to a single line until asked, and that is the whole design. The
 * first version showed every explanation open, which put four paragraphs above
 * the question list and pushed the actual marking below the fold — a guide that
 * has to be turned off before the product is usable is one nobody will leave
 * on. A titled line is enough to say "there is an explanation here", costs one
 * row, and opens on a click.
 *
 * The styling is doing the other half of the job: guide tips are brand-tinted
 * and dashed, which is used nowhere else in the product. They have to read as
 * scaffolding that is about to be taken away, not as a permanent part of the
 * interface, or a teacher will spend the first minute working out whether the
 * orange box is a warning about their paper.
 *
 * Renders nothing at all when the mode is off — not hidden with CSS, absent —
 * so a screen reader walking a working session never meets tutorial copy.
 */

interface Props {
  id: GuideId;
  /** Tighter spacing and type. For narrow columns like the question rail. */
  compact?: boolean;
  className?: string;
}

export default function GuideTip({ id, compact = false, className = "" }: Props) {
  const { on, setOn } = useGuide();
  const [open, setOpen] = useState(false);
  const entry = GUIDE[id];

  if (!on || !entry) return null;

  const bodyId = `guide-${id}`;

  return (
    <aside
      // "note" rather than a live region: it is reference material that was
      // already on the page, not something that just happened.
      role="note"
      aria-label={`Guide: ${entry.title}`}
      className={`overflow-hidden rounded-xl border border-dashed border-brand-ring bg-brand-soft/50 ${className}`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
            compact ? "px-2.5 py-2" : "px-3 py-2.5"
          }`}
        >
          <Bulb className="h-[15px] w-[15px] shrink-0 text-brand" />
          <span
            className={`min-w-0 flex-1 truncate font-bold text-ink ${
              compact ? "text-[11.5px]" : "text-[12px]"
            }`}
          >
            {entry.title}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-brand transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setOn(false)}
          aria-label="Turn off guide mode"
          title="Turn off guide mode"
          className="mr-1.5 shrink-0 rounded-md p-1 text-brand/60 transition-colors hover:bg-brand-soft hover:text-brand"
        >
          <Close className="h-3 w-3" />
        </button>
      </div>

      {open ? (
        <div id={bodyId} className={`pb-2.5 pr-3 ${compact ? "pl-[30px]" : "pl-[34px]"}`}>
          <p className="text-[11.5px] leading-relaxed text-body">{entry.why}</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink">
            <span className="font-semibold">Try it: </span>
            {entry.how}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
