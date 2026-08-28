import type { AnswerBlock, Grade, Mapping, Question, Review } from "./types";
import type { Exam } from "./exam";

/**
 * Getting the marks out.
 *
 * Whatever else this app does, a teacher's marks have to end up in the place
 * they actually keep marks — a spreadsheet, a school portal, a printed list.
 * A marking tool that can only show its results on its own screen makes more
 * work than it saves, because every number has to be copied out by hand.
 *
 * Kept pure and free of the DOM so the rules below can be tested. The browser
 * half is `download` in lib/download.ts.
 */

/**
 * A single CSV cell.
 *
 * Two hazards, and both are real here rather than theoretical. Quotes and
 * newlines appear constantly in transcribed handwriting and in model feedback,
 * so they are escaped the way RFC 4180 says. And a cell that begins with =, +,
 * - or @ is treated as a formula by Excel and Sheets, which turns a student's
 * answer of "=2+2" into a spreadsheet that computes rather than reports. A
 * leading apostrophe is the standard defence and is invisible in the cell.
 */
export function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(rows: (string | number | null | undefined)[][]): string {
  // CRLF, because that is what RFC 4180 says and what Excel is least likely to
  // misread. A BOM goes on the front so Excel opens it as UTF-8 rather than
  // mangling every name that is not ASCII.
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

export interface ScriptExport {
  title: string;
  student: string | null;
  paper: string | null;
  questions: Question[];
  blocks: AnswerBlock[];
  mappings: Mapping[];
  grades: Grade[];
  reviews?: Review[] | null;
}

/**
 * One row per question, in printed order, plus a total.
 *
 * Includes what the student wrote and what the model said about it, because
 * the most common reason to export is to check a disputed mark away from the
 * screen — and a row of numbers with no reasoning attached cannot settle
 * anything.
 */
export function scriptCSV(s: ScriptExport): string {
  const gradeFor = new Map(s.grades.map((g) => [g.questionId, g]));
  const mappingFor = new Map(s.mappings.map((m) => [m.questionId, m]));
  const blockFor = new Map(s.blocks.map((b) => [b.id, b]));
  const reviewFor = new Map((s.reviews ?? []).map((r) => [r.questionId, r]));

  const rows: (string | number | null)[][] = [
    [
      "Question",
      "Marks",
      "Out of",
      "Result",
      "Answered",
      "Marked by",
      "What the student wrote",
      "Feedback",
      "Teacher note",
    ],
  ];

  const ordered = [...s.questions].sort((a, b) => a.order - b.order);

  let awarded = 0;
  let outOf = 0;

  for (const q of ordered) {
    const grade = gradeFor.get(q.id) ?? null;
    const mapping = mappingFor.get(q.id) ?? null;
    const review = reviewFor.get(q.id) ?? null;
    const block = mapping?.answerBlockId ? blockFor.get(mapping.answerBlockId) ?? null : null;

    awarded += grade?.awarded ?? 0;
    outOf += grade?.max ?? 0;

    rows.push([
      q.number,
      grade?.awarded ?? null,
      grade?.max ?? null,
      grade?.verdict ?? "",
      block ? "yes" : "no",
      review ? "teacher" : "AI",
      block ? flatten(block.transcription) : "",
      flatten(grade?.feedback ?? ""),
      flatten(review?.note ?? ""),
    ]);
  }

  rows.push([]);
  rows.push(["Total", awarded, outOf, outOf > 0 ? `${Math.round((awarded / outOf) * 100)}%` : ""]);

  return toCSV(rows);
}

/** One row per question of a paper, across every script marked against it. */
export function examCSV(exam: Exam): string {
  const rows: (string | number | null)[][] = [
    ["Question", "Marks earned", "Marks available", "Class %", "Scripts", "Answered", "Blank", "Question text"],
  ];

  for (const q of exam.questions) {
    rows.push([
      q.number,
      q.awarded,
      q.outOf,
      q.score === null ? "" : `${Math.round(q.score * 100)}%`,
      q.scripts,
      q.answered,
      q.unanswered,
      flatten(q.text),
    ]);
  }

  rows.push([]);
  rows.push([
    "Whole paper",
    exam.awarded,
    exam.outOf,
    exam.score === null ? "" : `${Math.round(exam.score * 100)}%`,
    exam.scripts,
  ]);

  return toCSV(rows);
}

/**
 * A filename a filesystem will accept and a human can read back.
 *
 * Student names and paper titles are typed freely, so they arrive with slashes,
 * colons and quotes that Windows refuses outright.
 */
export function filename(parts: (string | null | undefined)[], ext = "csv"): string {
  const stem =
    parts
      .filter((p): p is string => Boolean(p && p.trim()))
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "export";

  return `${stem}.${ext}`;
}

/** Newlines inside a cell are legal but make the file unreadable in a grid. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
