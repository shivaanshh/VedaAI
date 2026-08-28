import { resolve } from "./review";
import type { AssessmentRecord } from "./types";

/**
 * Per-question analysis of a paper across every script marked against it.
 *
 * My Classroom answers "how is this student doing" and Assignments answers "how
 * did the class find this paper". Neither can answer the question a teacher
 * actually acts on, which is *which question* the class found hardest — that
 * lives inside the runs, one row per question, and nothing surfaced it.
 *
 * It costs no model call. Every number here is already sitting in the stored
 * records; this only adds them up.
 */

export interface ExamQuestion {
  /** The matching key. Two scripts of one paper agree on this. */
  canonical: string;
  /** As the paper prints it — "3 (b)". Taken from the most recent script. */
  number: string;
  text: string;
  marks: number | null;
  /** Finished scripts whose paper contained this question. */
  scripts: number;
  answered: number;
  unanswered: number;
  awarded: number;
  outOf: number;
  /** 0–1 across every script that carried it, or null if none carried marks. */
  score: number | null;
  /** Printed position, so the list reads down the paper. */
  order: number;
}

export interface Exam {
  paper: string;
  /** Finished scripts only — the ones every number is computed from. */
  scripts: number;
  /** Distinct students, case-insensitively. Unfiled scripts count as one each. */
  students: number;
  awarded: number;
  outOf: number;
  score: number | null;
  lastAt: string;
  questions: ExamQuestion[];
}

/**
 * Builds one Exam per paper.
 *
 * The two rules that keep it honest are the same ones the group views follow.
 * A run that stopped part way has a real question count and a mark of zero, so
 * letting it in would report a crash as a bad result — only finished runs
 * count. And a run nobody filed under a paper is not given an invented one; it
 * is simply absent, because a heading called "Unknown" reads like a real paper
 * that the class did badly on.
 */
export function buildExams(records: AssessmentRecord[]): Exam[] {
  const byPaper = new Map<string, AssessmentRecord[]>();

  for (const r of records) {
    if (r.job.step !== "done") continue;
    const paper = (r.paper ?? "").trim();
    if (!paper) continue;

    const key = paper.toLowerCase();
    const bucket = byPaper.get(key);
    if (bucket) bucket.push(r);
    else byPaper.set(key, [r]);
  }

  const exams = [...byPaper.values()].map(summariseExam);

  // Most recently marked first, matching every other list in the app.
  exams.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return exams;
}

function summariseExam(runs: AssessmentRecord[]): Exam {
  // Newest first, so "the most recent script" is simply the first one and the
  // printed wording shown for a question is the freshest available.
  const ordered = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const students = new Set(
    ordered.map((r) => (r.student ?? "").trim().toLowerCase()).filter(Boolean)
  ).size;

  const questions = new Map<string, ExamQuestion>();

  for (const run of ordered) {
    // Teacher corrections first. A mark raised in the workspace has to move the
    // question that mark belongs to, otherwise the board would keep naming a
    // question the class has already been shown to be fine on.
    const gradeFor = new Map(resolve(run).grades.map((g) => [g.questionId, g]));

    for (const q of run.questions) {
      // Falls back to the printed number so a question that canonicalised to
      // nothing still aggregates with its twin instead of splitting per script.
      const key = q.canonical || q.number.trim().toLowerCase();
      if (!key) continue;

      let row = questions.get(key);
      if (!row) {
        row = {
          canonical: key,
          number: q.number,
          text: q.text,
          marks: q.marks,
          scripts: 0,
          answered: 0,
          unanswered: 0,
          awarded: 0,
          outOf: 0,
          score: null,
          order: q.order,
        };
        questions.set(key, row);
      }

      const grade = gradeFor.get(q.id);
      row.scripts += 1;

      if (!grade || grade.verdict === "unanswered") row.unanswered += 1;
      else row.answered += 1;

      if (grade) {
        row.awarded += grade.awarded ?? 0;
        row.outOf += grade.max ?? 0;
      }
    }
  }

  const rows = [...questions.values()].map((q) => ({
    ...q,
    score: q.outOf > 0 ? q.awarded / q.outOf : null,
  }));

  rows.sort((a, b) => a.order - b.order);

  const awarded = rows.reduce((n, q) => n + q.awarded, 0);
  const outOf = rows.reduce((n, q) => n + q.outOf, 0);

  return {
    paper: (ordered[0].paper ?? "").trim(),
    scripts: ordered.length,
    students,
    awarded,
    outOf,
    score: outOf > 0 ? awarded / outOf : null,
    lastAt: ordered[0].createdAt,
    questions: rows,
  };
}

/**
 * The questions worth talking about in class, hardest first.
 *
 * Ranked on the proportion of the marks available that the class actually got,
 * not on raw marks lost — a 1-mark question everybody missed is a clearer
 * signal than a 5-mark question everybody half-answered. Questions nobody has
 * been marked on yet are left out rather than ranked as perfectly hard.
 */
export function hardest(exam: Exam, limit = 3): ExamQuestion[] {
  return exam.questions
    .filter((q) => q.outOf > 0 && q.score !== null && q.score < 1)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, limit);
}
