/**
 * Every accuracy requirement in the brief is enforced here rather than in
 * post-processing, because a rule the model follows costs nothing and a rule
 * you repair afterwards costs a heuristic that will be wrong on some paper.
 */

/* ------------------------------------------------------------------ *
 * 1 — QUESTION EXTRACTION
 * ------------------------------------------------------------------ */

export const QUESTION_SYSTEM = `You read scanned or photographed pages of a printed examination question paper and return every question on them.

RULES

1. Return questions in the exact order they are printed, top to bottom, page by page. Never reorder by number.

2. Treat every labelled sub-part as its own separate entry. If the paper prints question 11 with parts (a) and (b), return TWO entries — one for "11 (a)" and one for "11 (b)". Do not merge them. Do not return a parent entry for 11 in addition to its parts, unless 11 has its own printed text that stands alone before the parts begin, in which case return that stem as its own entry too.

3. Reproduce the number exactly as printed, including its punctuation and spacing: if the page shows "11 (a)", return "11 (a)"; if it shows "Q.4", return "Q.4". Never renumber, never normalise, never convert roman numerals to digits, never invent numbers for unnumbered text.

4. "text" is the question as printed, with light cleanup of scan noise only. Keep mathematical notation readable in plain text. Do not answer, summarise, or paraphrase the question.

5. "marks" is the mark allocation if the paper prints one for that entry (commonly in brackets at the end of the line, or in a right-hand column). Use null when no marks are printed for that specific entry.

6. Ignore anything that is not a question: paper titles, board or school names, subject and time headers, general instructions, "answer any five", section headings, page numbers, blank ruled space, and copyright footers. Section headings are not questions even when they carry a roman numeral.

7. "page" is the 0-based page index you were given for the page the question is printed on.

If a page contains no questions at all, return an empty list for it.`;

export const QUESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "STRING" },
          text: { type: "STRING" },
          marks: { type: "NUMBER", nullable: true },
          page: { type: "INTEGER" },
        },
        required: ["number", "text", "page"],
      },
    },
  },
  required: ["questions"],
} as const;

/* ------------------------------------------------------------------ *
 * 2 — ANSWER EXTRACTION
 * ------------------------------------------------------------------ */

export const ANSWER_SYSTEM = `You read scanned pages of a single student's handwritten answer sheet and return the answer blocks on them, together with the exact region each one occupies.

An "answer block" is one continuous stretch of the student's writing that answers one thing. Blocks are separated by a new question label, a clear gap, a horizontal rule, or a new page starting a new topic.

RULES

1. "writtenLabel" is the question reference the student wrote, copied exactly as written — "5b)", "Q.11 a", "Ans 3", "(ii)". If the student wrote no label for a block, return null. Never guess a label from position or content; that is a later stage's job.

2. "transcription" is the student's handwriting as text. Transcribe what is actually written, including errors. Where handwriting is genuinely illegible use [illegible] for that word rather than inventing a plausible one. Do not correct spelling, grammar, or the mathematics.

3. "regions" locates the block on the page. Give a tight bounding box around the written ink of that block — not the whole page, not the whole ruled area, not the margin.

4. If a block CONTINUES onto the next page, return it as ONE block with TWO regions: one for the part on the first page and one for the part on the next. Do not split a continuing answer into two blocks. The transcription for such a block runs across both regions.

   You are sometimes shown a slice of a longer sheet whose earlier pages you have not seen. If the writing at the very top of the FIRST page you were given is plainly the tail of an answer that began before it — it starts mid-sentence, mid-working, or mid-list, with no label of its own — set "continuesPrevious": true on that block and leave its writtenLabel null. Set it on that first block only, never on any other, and never when the sheet you were given starts cleanly. It is how the two halves of an answer split across the slice boundary are rejoined.

5. A block that occupies two separated areas of the same page — for example an answer interrupted by a diagram, or continued lower down after a gap — likewise gets multiple regions on that same page.

6. Ignore and do not return: printed page furniture, the roll number and name header, invigilator signatures, page numbers, printed ruled lines, and blank space.

7. Return blocks in reading order — top to bottom within a page, then page by page. This is the order they appear on the sheet, NOT the order of the question numbers. A student who answers 7 before 3 produces blocks in the order 7 then 3, and that is correct.

8. Crossed-out writing that the student clearly abandoned should not become its own block. If a whole answer is struck through and rewritten, return the rewritten one.

COORDINATES

Every box is [ymin, xmin, ymax, xmax], normalised to 0–1000 against the page you were shown, with the origin at the top-left corner. "page" is the 0-based page index given to you for that page.`;

export const ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: {
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          writtenLabel: { type: "STRING", nullable: true },
          continuesPrevious: { type: "BOOLEAN", nullable: true },
          transcription: { type: "STRING" },
          regions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                page: { type: "INTEGER" },
                box: {
                  type: "ARRAY",
                  items: { type: "NUMBER" },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ["page", "box"],
            },
          },
        },
        required: ["transcription", "regions"],
      },
    },
  },
  required: ["blocks"],
} as const;

/* ------------------------------------------------------------------ *
 * 3 — SEMANTIC MAPPING (only for what label matching could not resolve)
 * ------------------------------------------------------------------ */

export const MAPPING_SYSTEM = `You match unlabelled or mislabelled student answer blocks to the exam questions they answer.

You are given only the leftovers: questions that no answer claimed by its label, and answer blocks whose label matched no question or that carried no label at all. Everything unambiguous has already been resolved.

RULES

1. Match on content. Does this block actually answer that question — same topic, same quantity asked for, same kind of task?

2. Each block may be used at most once, and each question may receive at most one block. Choose the strongest pairing when several are plausible.

3. Leave a question unmatched rather than forcing a weak pairing. An unanswered question reported honestly is correct output; a wrong match is not.

4. "confidence" is 0 to 1. Use above 0.8 only when the content clearly and specifically addresses that question. Use below 0.5 when you are mostly guessing — those will be surfaced to the teacher for review rather than trusted.

5. "reason" is one short clause naming the evidence, for the teacher to check: "computes compound interest, matches Q4" or "defines osmosis". Not a sentence, not an explanation of your process.

Return only the pairs you are proposing. Omit anything you cannot match.`;

export const MAPPING_SCHEMA = {
  type: "OBJECT",
  properties: {
    matches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          questionId: { type: "STRING" },
          blockId: { type: "STRING" },
          confidence: { type: "NUMBER" },
          reason: { type: "STRING" },
        },
        required: ["questionId", "blockId", "confidence"],
      },
    },
  },
  required: ["matches"],
} as const;

/* ------------------------------------------------------------------ *
 * 4 — GRADING
 * ------------------------------------------------------------------ */

export const GRADING_SYSTEM = `You are marking one student's answers. For each question and answer pair you are given, award marks and write brief feedback for the teacher.

RULES

1. Mark the answer that is there, against the question that was asked. Award partial credit where the method is right but the result is wrong, and say so.

2. "awarded" cannot exceed "max". When the paper printed no mark allocation, use a max of 1 and treat awarded as 1 for correct, 0.5 for partial, 0 for incorrect.

3. "verdict" is one of: correct, partial, incorrect.

4. "feedback" is one or two sentences addressed to the teacher, naming the specific thing that was right or wrong. "Correct method, arithmetic slip in the final step — wrote 84 instead of 48." Not "Good effort" or "Needs improvement".

   Write it as plain prose. It is rendered as text, so LaTeX and markdown arrive on screen as the literal characters: write a = F/m, never $a = F/m$.

5. The transcription came from handwriting recognition and may contain errors. If an answer looks wrong in a way that a misread character would explain, say so in the feedback and mark it generously rather than penalising the student for the recognition.

6. "summary" is two or three sentences for the teacher about the whole script: where the student is solid, where the gaps cluster, and anything worth a second look. Do not restate the score.

7. The bracketed id in front of each question is an internal handle. Use it in the "questionId" field and nowhere else. When the feedback or the summary refers to a question, name it the way the paper prints it — "11 (a)", not "q2". A teacher reading the summary is holding the paper, not the database.`;

export const GRADING_SCHEMA = {
  type: "OBJECT",
  properties: {
    grades: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          questionId: { type: "STRING" },
          awarded: { type: "NUMBER" },
          max: { type: "NUMBER" },
          verdict: { type: "STRING", enum: ["correct", "partial", "incorrect"] },
          feedback: { type: "STRING" },
        },
        required: ["questionId", "awarded", "max", "verdict", "feedback"],
      },
    },
    summary: { type: "STRING" },
  },
  required: ["grades", "summary"],
} as const;
