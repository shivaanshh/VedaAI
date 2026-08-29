"use client";

import { SparkleCluster } from "./icons";
import { jobProgress, STEP_ORDER } from "@/lib/job";
import type { JobState } from "@/lib/types";
import GuideTip from "./GuideTip";

/**
 * The design gives this screen a sparkle, a heading and one grey line, and
 * nothing else. The brief asks for processing progress — so the composition is
 * kept exactly and the progress is carried by the two pieces of text that were
 * already there, plus one hairline track.
 *
 * The progress is real. Every advance corresponds to a batch of pages the
 * server actually finished, read back from the job record rather than from a
 * timer, which is why the bar can sit still for twenty seconds on a dense page
 * and then jump. That honesty is worth more than a smooth animation: a teacher
 * watching it can tell the difference between slow and stuck.
 */

const HEADING: Record<string, string> = {
  uploading: "Preparing pages...",
  questions: "Extracting...",
  answers: "Extracting...",
  mapping: "Mapping answers...",
  grading: "Marking...",
};

export default function ProcessingProgress({ job }: { job: JobState }) {
  const failed = job.step === "failed";
  const overall = jobProgress(job);

  const heading = failed ? "Something went wrong" : HEADING[job.step] ?? "Working...";
  const stepNumber = Math.max(1, STEP_ORDER.indexOf(job.step) + 1);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[380px] flex-col items-center text-center">
        <SparkleCluster className={`h-24 w-24 ${failed ? "text-faint" : "text-brand"}`} />

        <h2
          aria-live="polite"
          className="-mt-1 font-display text-[21px] font-extrabold tracking-tight text-ink"
        >
          {heading}
        </h2>

        <p className="mt-1.5 text-[13px] text-mute">
          {failed ? job.error || "The run stopped part way." : job.detail || "This may take a while"}
        </p>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overall * 100)}
          className="mt-6 h-[3px] w-full max-w-[240px] overflow-hidden rounded-full bg-[#E8E8E8]"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${
              failed ? "bg-bad" : "bg-brand"
            }`}
            style={{ width: `${Math.max(3, Math.round(overall * 100))}%` }}
          />
        </div>

        {!failed ? (
          <p className="mt-2.5 text-[11px] text-faint">
            Step {stepNumber} of {STEP_ORDER.length}
          </p>
        ) : null}

        <GuideTip id="progress" className="mt-7 text-left" />
      </div>
    </div>
  );
}
