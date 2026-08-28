"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import UploadPanel from "@/components/UploadPanel";
import ProcessingProgress from "@/components/ProcessingProgress";
import { batchPages, countPages, renderToPages } from "@/lib/pdf";
import { createAssessment, fetchHealth, uploadPages } from "@/lib/api";
import { freshJob } from "@/lib/job";
import type { JobState, PageKind, RenderedPage } from "@/lib/types";

/**
 * Upload, render, hand off.
 *
 * Rendering happens here and only here — pdf.js rasterises each page once, in
 * the browser, and those exact bytes are uploaded and stored. Everything after
 * this route works from what was stored, so the model and the teacher can never
 * end up looking at two different rasterisations of the same page.
 */

export default function UploadRoute() {
  const router = useRouter();

  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [student, setStudent] = useState("");
  const [paper, setPaper] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);

  // Checked before anything is uploaded. Without a key the run would render
  // every page, upload them, and only then hit a wall — better to say so while
  // the teacher can still do something about it.
  useEffect(() => {
    fetchHealth()
      .then((health) => {
        if (health.modelConfigured) return;
        setWarning(
          "No GEMINI_API_KEY is configured, so extraction will stop as soon as it starts. Add a free key from aistudio.google.com/apikey to .env.local and restart."
        );
      })
      .catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setJob({ ...freshJob(), detail: "Starting" });

    try {
      /**
       * A named student is the better title — history then reads as a list of
       * people rather than a list of scan filenames. Without one the filename
       * still has to do the job, because an id in a list tells a teacher
       * nothing.
       */
      const named = student.trim();
      const title = named || deriveTitle(answerFiles, questionFiles);

      /**
       * Both documents are counted before either is touched, because the bar
       * cannot be honest about how far along it is until it knows how far there
       * is to go. Sizing it from whichever document is in hand made the
       * denominator change halfway through and the bar jump backwards.
       *
       * Each page is two units of work — render it, then upload it — so a page
       * that has been rasterised but not yet sent is genuinely half done.
       */
      const questionPages = await countPages(questionFiles);
      const answerPages = await countPages(answerFiles);
      const units = (questionPages + answerPages) * 2;

      /**
       * The paper falls back to the question paper's own filename. Two scripts
       * marked against the same upload then land in the same assignment without
       * the teacher having typed anything, which is what makes Assignments
       * useful on the first run rather than only after a habit forms.
       */
      const created = await createAssessment({
        title,
        student: named || null,
        paper: paper.trim() || derivePaper(questionFiles),
      });

      const report = (offset: number, label: string) => (done: number, name: string) =>
        setJob((j) => ({
          ...(j ?? freshJob()),
          cursor: offset + done,
          total: units,
          detail: `${label} — ${name}`,
        }));

      await ingest(created.id, "question", questionFiles, questionPages,
        report(0, "Question paper"));

      await ingest(created.id, "answer", answerFiles, answerPages,
        report(questionPages * 2, "Answer sheet"));

      // From here the server owns the work. The workspace picks it up and
      // drives it, which also means this URL is now reloadable and shareable.
      router.push(`/a/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      setJob(null);
    }
  }, [answerFiles, questionFiles, student, paper, router]);

  return (
    <Shell sidebarCollapsed={job !== null} current="exams">
      {job ? (
        <div className="h-full p-3">
          <div className="h-full overflow-hidden rounded-2xl border border-line bg-surface">
            <ProcessingProgress job={job} />
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto">
          <UploadPanel
            questionFiles={questionFiles}
            answerFiles={answerFiles}
            student={student}
            paper={paper}
            error={error}
            warning={warning}
            onQuestionFiles={setQuestionFiles}
            onAnswerFiles={setAnswerFiles}
            onStudent={setStudent}
            onPaper={setPaper}
            onStart={start}
          />
        </div>
      )}
    </Shell>
  );
}

/**
 * Renders a document and uploads it a batch at a time.
 *
 * Batching is not an optimisation: serverless request bodies cap at 4.5 MB and
 * base64 adds about a third, so a five-page script sent whole would be rejected.
 */
async function ingest(
  id: string,
  kind: PageKind,
  files: File[],
  /** Pages this document holds, counted by the caller before any work began. */
  expected: number,
  /** `done` counts in half-pages: 0 to expected while rendering, on to 2x. */
  onProgress: (done: number, name: string) => void
): Promise<void> {
  const noun = kind === "question" ? "question paper" : "answer sheet";

  const pages: RenderedPage[] = await renderToPages(
    files,
    (done, _total, name) => onProgress(Math.min(done, expected), `reading ${name}`),
    expected
  );

  if (!pages.length) throw new Error(`The ${noun} produced no readable pages.`);

  const batches = batchPages(pages);
  let uploaded = 0;

  for (const batch of batches) {
    await uploadPages(id, kind, batch);
    uploaded += batch.length;
    onProgress(expected + Math.min(uploaded, expected), `sending page ${uploaded} of ${pages.length}`);
  }
}

/**
 * A run is named after the script it came from, so history reads as a list of
 * students' papers rather than a list of ids.
 */
function deriveTitle(answerFiles: File[], questionFiles: File[]): string {
  const source = answerFiles[0] ?? questionFiles[0];
  return source ? readableName(source) || "Untitled script" : "Untitled script";
}

/**
 * The paper's own filename, used when the teacher did not name the assignment.
 * Null rather than a placeholder when there is nothing to go on, because an
 * assignment called "Untitled" that every unfiled run joins would be worse than
 * no grouping at all.
 */
function derivePaper(questionFiles: File[]): string | null {
  const source = questionFiles[0];
  return source ? readableName(source) || null : null;
}

function readableName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}
