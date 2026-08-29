/**
 * What every feature is for, and how to use it.
 *
 * Guide mode is the answer to a specific failure of the help popover in the top
 * bar: that panel explains the product correctly, in one corner, away from the
 * thing it describes. A teacher reads it, closes it, and is back to a screen of
 * controls with no labels on them. So the same explanations also exist here,
 * pinned beside the control they are about, and turned on and off as a mode.
 *
 * Two fields, deliberately, because they answer different questions:
 *
 *   why  — why the feature exists at all. The thing a new user cannot guess.
 *   how  — what to actually do. Always an action, never a restatement of `why`.
 *
 * Deliberately free of imports. It is copy, it is read by a test that checks
 * every id is used and every used id exists, and it must stay loadable from
 * anywhere without dragging React in behind it.
 */

export interface GuideEntry {
  /** Names the feature. Matches the visible label wherever there is one. */
  title: string;
  /** Why it exists. One sentence. */
  why: string;
  /** What to do with it. One sentence, starting with a verb. */
  how: string;
}

export type GuideId =
  | "upload"
  | "question-rail"
  | "highlight"
  | "mark-editor"
  | "rail-toolbar"
  | "orphans"
  | "export"
  | "share"
  | "progress"
  | "home"
  | "history"
  | "classroom"
  | "assignments"
  | "exams"
  | "settings";

export const GUIDE: Record<GuideId, GuideEntry> = {
  upload: {
    title: "Two uploads, not one",
    why: "The paper and the script are read differently — the paper is where the questions and their marks come from, the script is where the handwriting is. Sending both as one pile would leave nothing to mark against.",
    how: "Drop the question paper on the left and one student's answer sheet on the right. Both take PDFs or images, and either can be several pages.",
  },

  progress: {
    title: "What the bar is counting",
    why: "It moves when a batch of pages the server actually finished is written down, so it is a real measure rather than an animation that would keep moving if the run had already died.",
    how: "Leave it running. If it stops, the error says which stage failed, and Resume picks up from there without re-reading the pages already done.",
  },

  "question-rail": {
    title: "The question list",
    why: "Every question on the paper appears here in printed order, including sub-parts as their own entries, so a question the student never answered is still visible instead of quietly missing.",
    how: "Click any question to select it. Use the up and down arrow keys to walk the paper once the list has focus.",
  },

  highlight: {
    title: "Finding the answer on the sheet",
    why: "Marking on screen usually means hunting for the answer that goes with the question you are reading; this is the part that removes that step.",
    how: "Click a question and its answer is outlined in green on the sheet. An answer running across two pages lights up on both, and the view scrolls to where it starts.",
  },

  "mark-editor": {
    title: "Changing what the model decided",
    why: "The mark is a suggestion, and the teacher signs the result — so every mark, and every question-to-answer match, can be overruled without the model's own reading being lost.",
    how: "Open a question and press Change mark. Set a mark, move the answer to the right question, or leave a note the student will read. Undo restores the model's version.",
  },

  "rail-toolbar": {
    title: "Search and filters",
    why: "On a long paper the questions that need attention are scattered through the ones that do not, and scrolling past twenty correct answers to reach the third wrong one wastes the time this tool is meant to save.",
    how: "Type to search the questions and the transcribed answers. Click a chip to show only those questions; click it again to clear it.",
  },

  orphans: {
    title: "Unmatched writing",
    why: "Writing that answers no question on the paper is usually a real signal — a mislabelled answer, rough work, or a question from a different paper — and silently dropping it would hide the student's actual work.",
    how: "Read what it says, then use Change mark on the question it belongs to and pick this block from the answer list.",
  },

  export: {
    title: "Export CSV",
    why: "Marks almost always have to end up somewhere else — a spreadsheet, a report, a school system — and retyping them is where mistakes get made.",
    how: "Press it to download one row per question, in printed order, with the mark that now stands and whether it was yours or the model's.",
  },

  share: {
    title: "Share with student",
    why: "The student needs the result and the feedback, but not the controls that change them, so the same stored run has a second read-only view.",
    how: "Press it to copy a link. Anyone with the link sees that one result — marks, feedback, notes and highlighting — and cannot alter it or reach any other script.",
  },

  home: {
    title: "Numbers read off your own marking",
    why: "Nothing on this screen is seeded or illustrative. Every figure is recomputed from the runs you have actually marked, so an empty dashboard means an empty account rather than a loading failure.",
    how: "Mark a script, then come back — the counts, the answered rate and the recent list all fill in on their own.",
  },

  history: {
    title: "Every run you have marked",
    why: "A marked script is worth more than the minute it was marked in — it is the record the boards, the averages and the per-question analysis are all computed from.",
    how: "Open a run to reopen the workspace exactly as you left it. File one under a student and a paper so it reaches the other screens.",
  },

  classroom: {
    title: "Grouped by student",
    why: "It answers a question the single-script view cannot: how one student is doing across everything of theirs you have marked.",
    how: "Set the Student field on a run — here or in the workspace — and every script under that name is totalled together.",
  },

  assignments: {
    title: "Grouped by paper",
    why: "The mirror image of My Classroom: one paper, every student who sat it, so a question the whole class lost marks on stops looking like one student's bad day.",
    how: "Set the Paper field on a run, then open the paper here to see its scripts and their average side by side.",
  },

  exams: {
    title: "One paper, question by question",
    why: "Averaging a whole paper hides where the marks actually went; this is the view that shows a question two-thirds of the class got wrong.",
    how: "Open a paper to see every question with its total across all scripts. Export CSV takes the same table out as a file.",
  },

  settings: {
    title: "What this build is actually doing",
    why: "Storage durability and the model's remaining allowance both decide whether the next run will work, so they are reported rather than hidden until something fails.",
    how: "Check Storage before a demo — filesystem is durable locally, but a serverless deployment needs DATABASE_URL set or history will not survive a redeploy.",
  },
};

/** Every id, in a stable order. Used by the tests and nothing else. */
export const GUIDE_IDS = Object.keys(GUIDE) as GuideId[];
