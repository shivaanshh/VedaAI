"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Close, PdfMark, Upload } from "./icons";
import { countPages } from "@/lib/pdf";
import GuideTip from "./GuideTip";

/**
 * The upload screen. Two drop zones, a primary action that stays inert until
 * both are filled, and per-zone validation.
 *
 * The design prints "Max 10MB" under each zone, so the limit is enforced here
 * rather than left to fail later against the request body cap.
 */

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

interface ZoneProps {
  id: string;
  noun: string;
  files: File[];
  onFiles: (files: File[]) => void;
}

/**
 * The `accept` attribute filters the file dialog and nothing else — a drag and
 * drop hands over whatever was dragged. Checked here so a stray .docx is
 * refused by name, rather than reaching the renderer and failing as "The source
 * image could not be decoded" three screens later.
 */
function isSupported(file: File): boolean {
  return /\.(pdf|png|jpe?g|webp)$/i.test(file.name) || ACCEPT.includes(file.type);
}

function DropZone({ id, noun, files, onFiles }: ZoneProps) {
  const [over, setOver] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const picked = Array.from(list);

      const unsupported = picked.filter((f) => !isSupported(f));
      if (unsupported.length) {
        setRejected(
          unsupported.length === 1
            ? `${unsupported[0].name} is not a PDF or an image.`
            : `${unsupported.length} of those are not PDFs or images.`
        );
        return;
      }

      const total = picked.reduce((n, f) => n + f.size, 0);
      if (total > MAX_BYTES) {
        setTooBig(true);
        setRejected(null);
        return;
      }

      setTooBig(false);
      setRejected(null);
      onFiles(picked);
    },
    [onFiles]
  );

  // The page count is shown on the file chip, so it has to be read out of the
  // PDF itself. Doing it here also warms the pdf.js worker before Start Mapping.
  useEffect(() => {
    let live = true;
    if (!files.length) {
      setPages(null);
      return;
    }
    countPages(files)
      .then((n) => {
        if (live) setPages(n);
      })
      .catch(() => {
        if (live) setPages(null);
      });
    return () => {
      live = false;
    };
  }, [files]);

  const empty = files.length === 0;

  return (
    <div className="flex-1">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed bg-surface p-4 transition-colors ${
          over ? "border-brand bg-brand-soft/40" : "border-line"
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => accept(e.target.files)}
        />

        {empty ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2.5 px-3 py-6 text-center"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-raised text-ink">
              <Upload className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[14px] font-bold text-ink">
              Upload <span className="text-brand">{noun}</span>
            </span>
            <span className="text-[11px] text-faint">Max 10MB</span>
          </button>
        ) : (
          <div className="relative py-1">
            <ul className="space-y-2">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2.5 rounded-xl bg-raised px-3 py-2.5"
                >
                  <PdfMark className="h-7 w-7 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-bold text-ink">{file.name}</div>
                    <div className="text-[11px] text-mute">
                      {formatSize(file.size)}
                      {files.length === 1 && pages !== null ? (
                        <span> &bull; {pages} Page{pages === 1 ? "" : "s"}</span>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {files.length > 1 && pages !== null ? (
              <p className="mt-2 px-1 text-[11px] text-mute">
                {files.length} files &bull; {pages} page{pages === 1 ? "" : "s"} total
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => onFiles([])}
              aria-label={`Remove ${noun}`}
              className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white shadow-pop transition-transform hover:scale-110"
            >
              <Close className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {tooBig ? (
        <p className="mt-2 text-center text-[11.5px] font-medium text-bad">
          That is over the 10MB limit. Try a smaller scan.
        </p>
      ) : rejected ? (
        <p className="mt-2 text-center text-[11.5px] font-medium text-bad">
          {rejected} Upload a PDF, PNG, JPEG or WebP.
        </p>
      ) : null}
    </div>
  );
}

/** One optional filing field. */
function Field({
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
    <label htmlFor={id} className="flex-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
      />
    </label>
  );
}

interface Props {
  questionFiles: File[];
  answerFiles: File[];
  student: string;
  paper: string;
  error: string | null;
  /** Something wrong with the environment, not with what was uploaded. */
  warning?: string | null;
  onQuestionFiles: (f: File[]) => void;
  onAnswerFiles: (f: File[]) => void;
  onStudent: (v: string) => void;
  onPaper: (v: string) => void;
  onStart: () => void;
}

export default function UploadPanel({
  questionFiles,
  answerFiles,
  student,
  paper,
  error,
  warning,
  onQuestionFiles,
  onAnswerFiles,
  onStudent,
  onPaper,
  onStart,
}: Props) {
  const ready = questionFiles.length > 0 && answerFiles.length > 0;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[620px] animate-riseIn">
        <h1 className="text-center font-display text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">
          Upload <span className="mark-brand">Question Paper &amp; Answer Sheets</span>
        </h1>
        <p className="mt-2.5 text-center text-[13.5px] text-mute">
          Upload both files to get started
        </p>

        <div className="mt-7 flex justify-center">
          <TeacherBadge />
        </div>

        {warning ? (
          <div className="mt-6 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-[12.5px] leading-relaxed text-warn">
            {warning}
          </div>
        ) : null}

        <GuideTip id="upload" className="mt-6" />

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <DropZone
            id="question-paper"
            noun="Question Paper"
            files={questionFiles}
            onFiles={onQuestionFiles}
          />
          <DropZone
            id="answer-sheet"
            noun="Answer Sheet"
            files={answerFiles}
            onFiles={onAnswerFiles}
          />
        </div>

        {/* Optional, and the run works exactly the same without them. They are
            what files the result: a name puts this script under a student in My
            Classroom, a paper puts it beside every other script marked from the
            same one. Both can also be set afterwards from the workspace, so
            skipping them here costs nothing. */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Field
            id="student-name"
            label="Student (optional)"
            placeholder="e.g. Aarav Sharma"
            value={student}
            onChange={onStudent}
          />
          <Field
            id="paper-name"
            label="Paper (optional)"
            placeholder="e.g. Class 9 Physics — Unit 2"
            value={paper}
            onChange={onPaper}
          />
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-center text-[13px] font-medium text-bad">
            {error}
          </div>
        ) : null}

        <div className="mt-7 flex justify-center">
          <button
            type="button"
            disabled={!ready}
            onClick={onStart}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition-colors ${
              ready
                ? "bg-ink text-white hover:bg-[#2b2b2b]"
                : "cursor-not-allowed bg-[#E4E4E4] text-faint"
            }`}
          >
            Start Mapping
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-center text-[11.5px] text-faint">
          Once both files are uploaded, you&rsquo;ll able to map answers with questions
        </p>
      </div>
    </div>
  );
}

/**
 * The haloed portrait from the design. The original is a photograph we do not
 * have, so this is a drawn stand-in holding the same silhouette and the four
 * orange nodes around the ring.
 */
function TeacherBadge() {
  const nodes = [
    "left-[6px] top-[16px]",
    "right-[6px] top-[16px]",
    "left-[6px] bottom-[16px]",
    "right-[6px] bottom-[16px]",
  ];

  return (
    <div className="relative h-[92px] w-[92px]">
      <div className="absolute inset-0 rounded-full bg-brand-soft" />
      <div className="absolute inset-[7px] rounded-full border-2 border-brand/35" />
      <div className="absolute inset-[13px] overflow-hidden rounded-full bg-white">
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <circle cx="32" cy="24" r="10" fill="#1A1A1A" />
          <path
            d="M32 15c5 0 9 3.4 9 8.2 0 1.4-.5 2.3-1.3 2.3-1.6 0-2-2.2-4-2.2-3.4 0-4.6 2.6-8.4 2.6-2.6 0-4.3-1.2-4.3-3 0-4.4 4.2-7.9 9-7.9Z"
            fill="#0D0D0D"
          />
          <path d="M14 56c1.6-9.3 8.8-15 18-15s16.4 5.7 18 15Z" fill="#FC5E24" />
          <rect
            x="22"
            y="43"
            width="20"
            height="13"
            rx="2"
            fill="#FFF"
            stroke="#1A1A1A"
            strokeWidth="1.6"
          />
          <path d="M26 47h12M26 51h8" stroke="#1A1A1A" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      {nodes.map((pos) => (
        <span key={pos} className={`absolute h-2 w-2 rounded-full bg-brand ${pos}`} />
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
