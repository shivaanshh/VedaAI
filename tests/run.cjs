/**
 * Logic tests for the parts of the pipeline that must be right every time.
 *
 * These cover the extraction-independent half of the system: label
 * canonicalisation, answer mapping, the job arithmetic the progress bar and the
 * batching depend on, and the per-run lock. They need no API key and no
 * network, so they run in about a second and can gate a deploy.
 *
 * What they deliberately do not cover is anything that needs the model or a
 * browser canvas. Those are exercised end to end against a running server
 * instead, because a stub of Gemini would only ever prove the stub works.
 *
 * Run with:  npm test
 */
const { canonicalize, fuzzyCanonical } = require("../.test-build/lib/normalize.js");
const {
  labelPass,
  coalesceBlocks,
  mergeSemantic,
  findOrphans,
} = require("../.test-build/lib/mapping.js");
const {
  batchCount,
  batchRange,
  jobProgress,
  isTerminal,
  freshJob,
  leaseHeld,
  PAGE_BATCH,
  STEP_ORDER,
} = require("../.test-build/lib/job.js");
const { withLock } = require("../.test-build/server/services/lock.js");
const { groupBy, percent } = require("../.test-build/lib/cohort.js");
const { runState, RUN_STATE_LABEL, scoreChip } = require("../.test-build/lib/display.js");
const { buildExams, hardest } = require("../.test-build/lib/exam.js");

let pass = 0;
let fail = 0;

function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    return;
  }
  fail++;
  console.log(`  FAIL ${label}`);
  console.log(`    got      ${JSON.stringify(actual)}`);
  console.log(`    expected ${JSON.stringify(expected)}`);
}

function group(name) {
  console.log(name);
}

/* -------------------- fixtures -------------------- */

const Q = (id, number) => ({
  id,
  number,
  canonical: canonicalize(number),
  text: `text ${number}`,
  marks: null,
  page: 0,
  order: 0,
});

const B = (id, label, pages = [0]) => ({
  id,
  writtenLabel: label,
  // Mirrors what job.ts stores on a block: the canonical key, or null when
  // there was no label to canonicalise.
  canonical: canonicalize(label) || null,
  transcription: `answer ${label}`,
  regions: pages.map((p) => ({ page: p, box: { x: 10, y: 10, w: 50, h: 8 } })),
  order: 0,
});

/** A paper where question 11 has two labelled sub-parts. */
const questions = [
  Q("q0", "3"),
  Q("q1", "7"),
  Q("q2", "11 (a)"),
  Q("q3", "11 (b)"),
  Q("q4", "12"),
];

/* -------------------- canonicalisation -------------------- */

group("canonicalize — the many ways to write one reference:");
eq(canonicalize("11 (a)"), "11|a", '"11 (a)"');
eq(canonicalize("11(a)"), "11|a", '"11(a)"');
eq(canonicalize("Q.11 a"), "11|a", '"Q.11 a"');
eq(canonicalize("q11(A)"), "11|a", '"q11(A)"');
eq(canonicalize("Question 11 part a"), "11|a", '"Question 11 part a"');
eq(canonicalize("Ans 11 a)"), "11|a", '"Ans 11 a)"');

group("canonicalize — other shapes:");
eq(canonicalize("5b)"), "5|b", '"5b)"');
eq(canonicalize("17 (iii)"), "17|iii", '"17 (iii)"');
eq(canonicalize("4."), "4", '"4."');
eq(canonicalize("Q.4"), "4", '"Q.4"');
eq(canonicalize(""), "", "empty string");
eq(canonicalize(null), "", "null");
eq(canonicalize("(ii)"), "ii", "bare sub-part");

// The distinction the whole design rests on. If these ever collapse, "treat
// labelled sub-parts as separate questions" fails silently.
group("sub-parts never collapse:");
eq(canonicalize("11 (a)") !== canonicalize("11 (b)"), true, "a sub-part differs from its sibling");
eq(canonicalize("11 (a)") !== canonicalize("11"), true, "and from its parent");

group("fuzzyCanonical — repairing digits misread from handwriting:");
eq(fuzzyCanonical("ll(a)"), "11|a", '"ll(a)" recovers 11|a');
eq(fuzzyCanonical("S(b)"), "5|b", '"S(b)" recovers 5|b');
eq(fuzzyCanonical("lo"), "10", '"lo" recovers 10');
eq(fuzzyCanonical("11(a)"), "11|a", "already numeric, untouched");
eq(fuzzyCanonical("(iii)"), "iii", "roman numeral not mangled into 111");
eq(fuzzyCanonical("(iv)"), "iv", "roman iv preserved");
eq(fuzzyCanonical("(x)"), "x", "roman x preserved");
eq(fuzzyCanonical("osmosis"), "osmosis", "a word is not a misread number");

/**
 * A misread character in the MIDDLE of a number is a different problem from one
 * that takes the whole token, because canonicalize splits digit runs from
 * letter runs and pulls the two halves apart before any repair can see them.
 * "1O" arrives as "1|o" — question one, part o — which matches nothing.
 */
group("fuzzyCanonical — a misread digit inside a number:");
eq(fuzzyCanonical("1O)"), "10", "a letter O between the digits of ten");
eq(fuzzyCanonical("1l)"), "11", "a trailing lowercase L");
eq(fuzzyCanonical("S0."), "50", "a leading S");
eq(fuzzyCanonical("1OO"), "100", "two misreads in one number");
eq(fuzzyCanonical("1O (a)"), "10|a", "and the sub-part still comes through");

group("fuzzyCanonical — what the repair must refuse to touch:");
eq(fuzzyCanonical("5b)"), "5|b", "b is how a sub-part is labelled, not an eight");
eq(fuzzyCanonical("5i)"), "5|i", "and i is a roman sub-part, not a one");
eq(fuzzyCanonical("No1"), "1", "a noise word against a digit keeps the plain key");
eq(fuzzyCanonical("Sol5"), "5", "and so does a run-together solution prefix");
eq(fuzzyCanonical("loss"), "loss", "a long run of letters is a word");

// Both sides of the comparison are canonicalised the same way, so a repair is
// only useful if the printed label survives it unchanged.
group("fuzzyCanonical is stable on printed labels:");
eq(fuzzyCanonical("10."), "10", "a two-digit number");
eq(fuzzyCanonical("10 (a)"), "10|a", "and its sub-part");

/* -------------------- mapping -------------------- */

group("answers written OUT OF ORDER (7, then 3, then 11b, then 11a):");
{
  const blocks = [B("b0", "7)"), B("b1", "3."), B("b2", "11 b"), B("b3", "Q.11(a)")];
  const r = labelPass(questions, blocks);
  const got = {};
  r.mappings.forEach((m) => {
    got[m.questionId] = m.answerBlockId;
  });
  eq(got.q0, "b1", "Q3 finds the block written second");
  eq(got.q1, "b0", "Q7 finds the block written first");
  eq(got.q2, "b3", "Q11(a) finds the block written last");
  eq(got.q3, "b2", "Q11(b) finds the block written third");
  eq(r.unmatchedQuestions.map((q) => q.number), ["12"], "Q12 reported unanswered");
  eq(r.unmatchedBlocks.length, 0, "no blocks left over");

  // Order independence is a property of the design, not a happy accident, so
  // it is asserted rather than assumed: the same blocks in printed order must
  // produce the identical result.
  const reordered = labelPass(questions, [blocks[1], blocks[0], blocks[3], blocks[2]]);
  eq(
    reordered.mappings.map((m) => `${m.questionId}=${m.answerBlockId}`).sort(),
    r.mappings.map((m) => `${m.questionId}=${m.answerBlockId}`).sort(),
    "shuffling the sheet changes nothing"
  );
}

group("labelled sub-parts stay separate:");
{
  const blocks = [B("b0", "11 a"), B("b1", "11 b")];
  const r = labelPass(questions, blocks);
  eq(r.mappings.length, 2, "two matches, not one merged parent");
  eq(new Set(r.mappings.map((m) => m.answerBlockId)).size, 2, "to distinct blocks");
}

group("an answer that matches no question becomes an orphan:");
{
  const blocks = [B("b0", "3."), B("b1", "99")];
  const r = labelPass(questions, blocks);
  eq(findOrphans(blocks, r.mappings), ["b1"], "block 99 flagged");
}

group("one question cannot be claimed twice:");
{
  const r = labelPass(questions, [B("b0", "7)"), B("b1", "7)")]);
  eq(r.mappings.length, 1, "the first block wins the question");
  eq(r.unmatchedBlocks.map((b) => b.id), ["b1"], "and the second is passed on, not dropped");
}

group("an answer split across pages is rejoined:");
{
  const source = [B("b0", "5", [0]), B("b1", "5", [1])];
  const blocks = coalesceBlocks(source);
  eq(blocks.length, 1, "merged into a single block");
  eq(blocks[0].regions.map((r) => r.page), [0, 1], "both page regions retained");
  eq(blocks[0].transcription.split("\n").length, 2, "and both transcriptions");

  // The record these come from is persisted and the step may run again, so the
  // merge has to work on copies.
  eq(source[0].regions.length, 1, "the caller's blocks are left alone");
}

group("unlabelled blocks are never blindly merged:");
{
  const blocks = coalesceBlocks([B("b0", null, [0]), B("b1", null, [0])]);
  eq(blocks.length, 2, "kept apart for the semantic pass to decide");
}

group("a misread label still finds its question:");
{
  const r = labelPass(questions, [B("b0", "ll(a)")]);
  const m = r.mappings.find((x) => x.questionId === "q2");
  eq(Boolean(m), true, "matched through the repair pass");
  eq(Boolean(m) && m.confidence < 1, true, "and flagged as less than certain");
}

group("the semantic pass enforces one-to-one:");
{
  const base = [{ questionId: "q0", answerBlockId: "b0", confidence: 1, method: "label" }];
  const merged = mergeSemantic(
    base,
    [
      { questionId: "q0", blockId: "b9", confidence: 0.95 },
      { questionId: "q4", blockId: "b9", confidence: 0.7 },
      { questionId: "qX", blockId: "b9", confidence: 0.9 },
    ],
    new Set(["q4", "q0"]),
    new Set(["b9"])
  );
  eq(merged.length, 2, "only the one valid proposal was accepted");
  eq(merged[1].questionId, "q4", "it went to the free question");
  eq(merged[1].method, "semantic", "and is tagged semantic for the UI");
}

group("a model confidence is never trusted raw:");
{
  const base = [];
  const valid = [new Set(["q0"]), new Set(["b0"])];
  eq(
    mergeSemantic(base, [{ questionId: "q0", blockId: "b0", confidence: 4 }], ...valid)[0].confidence,
    1,
    "an overshoot is clamped"
  );
  eq(
    mergeSemantic(base, [{ questionId: "q0", blockId: "b0", confidence: NaN }], ...valid)[0]
      .confidence,
    0,
    "and a nonsense value becomes no confidence at all"
  );
}

group("batching pages for the model:");
{
  eq(batchCount(0), 1, "an empty document still costs one call");
  eq(batchCount(1), 1, "one page, one batch");
  eq(batchCount(PAGE_BATCH), 1, "a full batch is not split");
  eq(batchCount(PAGE_BATCH + 1), 2, "one page over spills into a second");
  eq(batchCount(10), Math.ceil(10 / PAGE_BATCH), "and it scales linearly");

  eq(batchRange(0, 8), { from: 0, to: 3 }, "the first batch starts at zero");
  eq(batchRange(2, 8), { from: 6, to: 8 }, "the last batch is short, not padded");
  eq(batchRange(9, 8), { from: 8, to: 8 }, "a cursor past the end yields nothing to read");
}

group("terminal states:");
{
  eq(isTerminal("done"), true, "done is terminal");
  eq(isTerminal("failed"), true, "so is failed");
  eq(isTerminal("answers"), false, "mid-run is not");
}

group("progress reflects work that actually finished:");
{
  const job = freshJob();
  eq(job.step, "uploading", "a fresh job starts at the beginning");
  eq(job.leaseUntil, null, "and unclaimed");
  eq(job.failedStep, null, "with nothing to resume");
  eq(jobProgress(job), 0, "and at zero");

  eq(jobProgress({ ...job, step: "done" }), 1, "a finished run reads 100%");

  // The bar must never claim completion before the run says so - a teacher
  // watching a full bar that is still working would reasonably assume a hang.
  const lastBatch = { ...job, step: "grading", cursor: 1, total: 1 };
  eq(jobProgress(lastBatch) < 1, true, "the last batch still stops short of 100%");

  const later = { ...job, step: "answers", cursor: 1, total: 2 };
  const earlier = { ...job, step: "questions", cursor: 1, total: 2 };
  eq(jobProgress(later) > jobProgress(earlier), true, "later steps read higher");

  // Progress must be monotonic across the whole run, or the bar goes backwards.
  let previous = -1;
  let monotonic = true;
  for (const step of STEP_ORDER) {
    for (let cursor = 0; cursor <= 4; cursor++) {
      const value = jobProgress({ ...job, step, cursor, total: 4 });
      if (value < previous) monotonic = false;
      previous = value;
    }
  }
  eq(monotonic, true, "and the bar never goes backwards");
}

/**
 * A failed run keeps the step it died on in `failedStep`; `step` itself reads
 * "failed" and carries no weight of its own. Reading the weight off `step`
 * parked every failure at the far right of the bar, which told a teacher whose
 * run died on the first page that it had almost finished.
 */
group("a failure freezes the bar where it stopped:");
{
  const job = freshJob();
  const at = (failedStep) => jobProgress({ ...job, step: "failed", failedStep });

  eq(at("uploading"), 0, "dying before anything ran reads zero");
  eq(at("answers") > at("questions"), true, "dying later reads higher");
  eq(at("grading") < 1, true, "and dying on the last step is still not a finished run");
  eq(at("answers") < jobProgress({ ...job, step: "done" }), true, "no failure outranks success");
  eq(at(null), 0, "a record with no failedStep degrades to zero, not to full");
}

group("the lease keeps two tabs off one batch:");
{
  const job = freshJob();
  const now = Date.now();
  eq(leaseHeld(job, now), false, "an unclaimed run is free");
  eq(
    leaseHeld({ ...job, leaseUntil: new Date(now + 30000).toISOString() }, now),
    true,
    "a live claim is held"
  );
  eq(
    leaseHeld({ ...job, leaseUntil: new Date(now - 1000).toISOString() }, now),
    false,
    "an expired claim is reclaimable, so a crashed worker cannot wedge a run"
  );
  eq(leaseHeld({ ...job, leaseUntil: "not a date" }, now), false, "and garbage is not a claim");
}

/* -------------------- the lock -------------------- */

/**
 * The lease above narrows the cross-instance window; this closes the
 * same-instance one. React's development double-effect and a teacher with two
 * tabs open both call advance() at once, and without the lock both would read
 * the same cursor and append the same batch twice.
 */
async function lockTests() {
  group("the lock serialises work on one run:");

  const trace = [];
  const step = (tag, ms) => async () => {
    trace.push(`${tag}+`);
    await new Promise((r) => setTimeout(r, ms));
    trace.push(`${tag}-`);
    return tag;
  };

  await Promise.all([
    withLock("run-1", step("a", 30)),
    withLock("run-1", step("b", 10)),
    withLock("run-1", step("c", 5)),
  ]);
  eq(trace.join(""), "a+a-b+b-c+c-", "one at a time, in the order they arrived");

  // Two teachers on one instance must not queue behind each other, or a slow
  // script would stall every other run on the box.
  const overlap = [];
  await Promise.all([
    withLock("run-2", async () => {
      overlap.push("slow+");
      await new Promise((r) => setTimeout(r, 25));
      overlap.push("slow-");
    }),
    withLock("run-3", async () => {
      overlap.push("fast+");
      await new Promise((r) => setTimeout(r, 5));
      overlap.push("fast-");
    }),
  ]);
  eq(overlap.join(""), "slow+fast+fast-slow-", "different runs proceed side by side");

  group("a failure belongs to its caller, not to the queue:");
  const thrown = await withLock("run-4", async () => {
    throw new Error("batch died");
  }).then(
    () => null,
    (e) => e.message
  );
  eq(thrown, "batch died", "the caller that failed sees its own error");
  eq(await withLock("run-4", async () => "next"), "next", "and the next caller still gets its turn");
}

/* -------------------- grouping history -------------------- */

/**
 * A stored run reduced to what My Classroom and Assignments read. Only the
 * fields the grouping actually touches are set, so a test failure points at the
 * reduction rather than at a fixture that drifted.
 */
const R = (id, over = {}) => ({
  id,
  title: id,
  student: null,
  paper: null,
  createdAt: `2026-08-2${id.length}T10:00:00.000Z`,
  updatedAt: `2026-08-2${id.length}T10:00:00.000Z`,
  step: "done",
  error: null,
  questionCount: 4,
  answeredCount: 3,
  unansweredCount: 1,
  orphanCount: 0,
  awarded: 6,
  outOf: 10,
  answerPageCount: 1,
  ...over,
});

group("history groups on the field it was asked for:");
{
  const runs = [
    R("a", { student: "Aarav", paper: "Unit 2" }),
    R("bb", { student: "Aarav", paper: "Unit 3" }),
    R("ccc", { student: "Priya", paper: "Unit 2" }),
  ];

  const byStudent = groupBy(runs, "student");
  eq(byStudent.groups.length, 2, "two students");
  eq(
    byStudent.groups.map((g) => g.key).sort(),
    ["Aarav", "Priya"],
    "named by the student, never by the paper"
  );

  const byPaper = groupBy(runs, "paper");
  eq(
    byPaper.groups.map((g) => g.key).sort(),
    ["Unit 2", "Unit 3"],
    "and the paper view is named by the paper, though every run also names a student"
  );

  // Most recently touched first, so a teacher mid-marking finds their place.
  eq(byStudent.groups[0].key, "Priya", "the group with the newest run leads");
}

group("a group totals only the runs that finished:");
{
  const { groups } = groupBy(
    [
      R("a", { student: "Aarav" }),
      R("bb", { student: "Aarav", step: "failed", awarded: 0, outOf: 0 }),
      R("ccc", { student: "Aarav", step: "grading", awarded: 0, outOf: 0 }),
    ],
    "student"
  );

  const g = groups[0];
  eq(g.runs.length, 3, "every run is still listed under the student");
  eq(g.marked, 1, "but only the finished one counts as marked");
  eq(g.pending, 2, "the other two are reported as unfinished rather than hidden");

  // The point of the filter: a run that died has a real question count and a
  // real zero, and letting it in would report a crash as a bad result.
  eq(g.outOf, 10, "a stopped run contributes nothing to the denominator");
  eq(g.score, 0.6, "so the average is the finished run's own score");
  eq(percent(g.score), "60%", "shown rounded");
}

group("what has no name is not given one:");
{
  const { groups, unfiled } = groupBy(
    [R("a", { student: "Aarav" }), R("bb"), R("ccc", { student: "   " })],
    "student"
  );

  eq(groups.length, 1, "only the named run forms a group");
  eq(unfiled.map((r) => r.id), ["bb", "ccc"], "the rest are handed back to be filed");
  eq(percent(null), "—", "and a group with no marks shows a dash, not a zero");
}

group("one student, however it was typed:");
{
  const { groups } = groupBy(
    [R("a", { student: "aarav sharma" }), R("bb", { student: "Aarav Sharma" })],
    "student"
  );

  eq(groups.length, 1, "case is not a different student");
  eq(groups[0].marked, 2, "both scripts land in the one group");
  eq(groups[0].key, "Aarav Sharma", "displayed as the most recent spelling seen");
}

group("an empty history is an empty board:");
{
  const { groups, unfiled } = groupBy([], "paper");
  eq(groups.length, 0, "no groups");
  eq(unfiled.length, 0, "and nothing to file");
}

/* ------------------------------------------------------------------ *
 * What a stored run currently is
 *
 * The lists disagreed about this before it was named: a run created by a
 * teacher who then closed the tab has no pages and never will, but every
 * list called it "in progress" and left it at the top of the history with a
 * spinner for work that stopped before it began.
 * ------------------------------------------------------------------ */

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const ago = (mins) => new Date(NOW - mins * 60_000).toISOString();

group("a run's state:");
{
  eq(
    runState({ step: "done", answerPageCount: 3, updatedAt: ago(90) }, NOW),
    "done",
    "finished is finished however old it is"
  );
  eq(
    runState({ step: "failed", answerPageCount: 3, updatedAt: ago(90) }, NOW),
    "failed",
    "a failure is reported as one"
  );
  eq(
    runState({ step: "uploading", answerPageCount: 0, updatedAt: ago(1) }, NOW),
    "running",
    "a run uploading right now is still running"
  );
  eq(
    runState({ step: "uploading", answerPageCount: 0, updatedAt: ago(45) }, NOW),
    "abandoned",
    "no pages after 45 minutes means nobody is coming back"
  );
  eq(
    runState({ step: "answers", answerPageCount: 3, updatedAt: ago(45) }, NOW),
    "running",
    "a long model call is slow, not abandoned"
  );
  eq(
    runState({ step: "uploading", answerPageCount: 4, updatedAt: ago(45) }, NOW),
    "running",
    "pages already uploaded means the run is real, however stale"
  );
}

group("every state has a word for it:");
{
  for (const s of ["done", "failed", "abandoned", "running"]) {
    eq(typeof RUN_STATE_LABEL[s], "string", `${s} is labelled`);
  }
}

/* ------------------------------------------------------------------ *
 * The score chip
 *
 * The one number a teacher totals a script from. An unanswered question
 * scoring 0 out of its printed marks is what keeps the denominator honest.
 * ------------------------------------------------------------------ */

group("the score chip:");
{
  eq(
    scoreChip({ answered: false, uncertain: false, awarded: null, max: null, printedMarks: 3 }),
    { label: "0/3", tone: "bad" },
    "unanswered still scores out of its printed marks"
  );
  eq(
    scoreChip({ answered: true, uncertain: false, awarded: 2, max: 2, printedMarks: 2 }),
    { label: "2/2", tone: "good" },
    "full marks read as good"
  );
  eq(
    scoreChip({ answered: true, uncertain: false, awarded: 0.5, max: 2, printedMarks: 2 }),
    { label: "0.5/2", tone: "warn" },
    "a half mark survives as a half, not as 1 or 0"
  );
  eq(
    scoreChip({ answered: true, uncertain: false, awarded: 0, max: 2, printedMarks: 2 }),
    { label: "0/2", tone: "bad" },
    "answered but worthless is still red"
  );
  eq(
    scoreChip({ answered: true, uncertain: true, awarded: null, max: null, printedMarks: null }),
    { label: "Check match", tone: "warn" },
    "a shaky match asks to be checked rather than claiming a score"
  );
}

/* ------------------------------------------------------------------ *
 * Per-question exam analysis
 *
 * The board views stop at one percentage per group. This is the layer that
 * says which question lost the marks, so its arithmetic has to survive the
 * awkward histories: a run that stopped half way, a run nobody filed, two
 * scripts of one paper, and a question that only one of them carried.
 * ------------------------------------------------------------------ */

function q(number, order, marks) {
  return {
    id: `q-${number}`,
    number,
    canonical: number.replace(/[^a-z0-9]/gi, "").toLowerCase(),
    text: `Question ${number}`,
    marks,
    page: 0,
    order,
  };
}

function g(number, awarded, max, verdict) {
  return { questionId: `q-${number}`, awarded, max, verdict, feedback: "" };
}

function record(over) {
  return {
    id: "r1",
    title: "script",
    student: null,
    paper: "Physics HY",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    job: { step: "done" },
    questionPages: [],
    answerPages: [],
    questions: [],
    blocks: [],
    mappings: [],
    grades: [],
    orphanBlockIds: [],
    summary: null,
    ...over,
  };
}

group("what counts towards an exam:");
{
  const finished = record({ id: "a", questions: [q("1", 0, 2)], grades: [g("1", 2, 2, "correct")] });

  eq(buildExams([finished]).length, 1, "a finished, filed run makes an exam");

  eq(
    buildExams([record({ id: "b", job: { step: "grading" }, questions: [q("1", 0, 2)] })]).length,
    0,
    "a run still going is not an exam - its zero would read as a bad result"
  );

  eq(
    buildExams([record({ id: "c", job: { step: "failed" }, questions: [q("1", 0, 2)] })]).length,
    0,
    "a crashed run cannot lower the class average"
  );

  eq(
    buildExams([record({ id: "d", paper: null, questions: [q("1", 0, 2)] })]).length,
    0,
    "an unfiled run gets no invented paper heading"
  );

  eq(
    buildExams([record({ id: "e", paper: "   ", questions: [q("1", 0, 2)] })]).length,
    0,
    "whitespace is not a paper name"
  );
}

group("two scripts of one paper:");
{
  const exams = buildExams([
    record({
      id: "a",
      student: "Ishaan",
      createdAt: "2026-08-20T10:00:00.000Z",
      questions: [q("1", 0, 2), q("2", 1, 3)],
      grades: [g("1", 2, 2, "correct"), g("2", 1, 3, "partial")],
    }),
    record({
      id: "b",
      student: "Meera",
      paper: "physics hy",
      createdAt: "2026-08-21T10:00:00.000Z",
      questions: [q("1", 0, 2), q("2", 1, 3)],
      grades: [g("1", 1, 2, "partial"), g("2", 0, 3, "unanswered")],
    }),
  ]);

  eq(exams.length, 1, "a paper named in a different case is the same paper");
  eq(exams[0].scripts, 2, "both scripts count");
  eq(exams[0].students, 2, "two names, two students");
  eq(exams[0].questions.length, 2, "the same question across scripts is one row");

  const q1 = exams[0].questions[0];
  const q2 = exams[0].questions[1];

  eq([q1.awarded, q1.outOf], [3, 4], "Q1 sums across both scripts");
  eq(q1.score, 0.75, "and scores on the total, not on an average of averages");
  eq([q2.awarded, q2.outOf], [1, 6], "Q2 sums the blank one in at zero");
  eq(q2.unanswered, 1, "the blank is counted as blank, not as a wrong answer");
  eq(q2.answered, 1, "and the attempt is still counted as attempted");
  eq([exams[0].awarded, exams[0].outOf], [4, 10], "the paper total is the sum of its questions");
  eq(exams[0].score, 0.4, "which is what the headline percentage reads");
}

group("questions the scripts disagree about:");
{
  const exams = buildExams([
    record({
      id: "a",
      createdAt: "2026-08-20T10:00:00.000Z",
      questions: [q("1", 0, 2)],
      grades: [g("1", 2, 2, "correct")],
    }),
    record({
      id: "b",
      createdAt: "2026-08-21T10:00:00.000Z",
      questions: [q("1", 0, 2), q("3", 1, 4)],
      grades: [g("1", 0, 2, "incorrect"), g("3", 4, 4, "correct")],
    }),
  ]);

  const [one, three] = exams[0].questions;
  eq(one.scripts, 2, "a question on both scripts says so");
  eq(three.scripts, 1, "a question only one script carried is not counted against the other");
  eq(three.score, 1, "and is scored only on the script that had it");
}

group("a question with no grade at all:");
{
  const exams = buildExams([
    record({ id: "a", questions: [q("1", 0, 2)], grades: [] }),
  ]);

  const row = exams[0].questions[0];
  eq(row.unanswered, 1, "an ungraded question is treated as unanswered, not as absent");
  eq(row.outOf, 0, "it contributes no denominator, because nothing was marked");
  eq(row.score, null, "so it has no percentage rather than a zero");
  eq(exams[0].score, null, "and neither does the paper");
}

group("questions read down the paper:");
{
  const exams = buildExams([
    record({
      id: "a",
      questions: [q("3", 2, 1), q("1", 0, 1), q("2", 1, 1)],
      grades: [g("3", 1, 1, "correct"), g("1", 1, 1, "correct"), g("2", 1, 1, "correct")],
    }),
  ]);

  eq(
    exams[0].questions.map((x) => x.number),
    ["1", "2", "3"],
    "printed order wins over the order the questions were stored in"
  );
}

group("the hardest questions:");
{
  const exams = buildExams([
    record({
      id: "a",
      questions: [q("1", 0, 2), q("2", 1, 5), q("3", 2, 1), q("4", 3, 2)],
      grades: [
        g("1", 2, 2, "correct"),
        g("2", 2.5, 5, "partial"),
        g("3", 0, 1, "incorrect"),
        g("4", 2, 2, "correct"),
      ],
    }),
  ]);

  const worst = hardest(exams[0], 3);
  eq(
    worst.map((x) => x.number),
    ["3", "2"],
    "hardest first, and a question everybody got right is never listed as hard"
  );

  eq(hardest(exams[0], 1).map((x) => x.number), ["3"], "the limit is honoured");
}

group("exams are listed newest first:");
{
  const exams = buildExams([
    record({ id: "a", paper: "Old paper", createdAt: "2026-01-01T00:00:00.000Z" }),
    record({ id: "b", paper: "New paper", createdAt: "2026-08-01T00:00:00.000Z" }),
  ]);

  eq(exams.map((e) => e.paper), ["New paper", "Old paper"], "most recently marked leads");
}

lockTests()
  .catch((err) => {
    fail++;
    console.log(`  FAIL lock tests threw: ${err.message}`);
  })
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
