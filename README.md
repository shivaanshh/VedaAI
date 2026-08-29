# Assessment Mapper

Upload a question paper and one student's handwritten answer sheet. The app extracts every
question in printed order, reads the handwriting, works out which writing answers which
question, and highlights the exact region of the page where each answer sits.

Click a question on the left; the answer lights up on the right.

---

## Contents

- [The problem, and the one thing that decides it](#the-problem-and-the-one-thing-that-decides-it)
- [Architecture](#architecture)
- [How it works](#how-it-works)
- [Two views, no login](#two-views-no-login)
- [The teacher overrules the model](#the-teacher-overrules-the-model)
- [Finding one question in a long paper](#finding-one-question-in-a-long-paper)
- [Taking the marks out of the app](#taking-the-marks-out-of-the-app)
- [Guide mode](#guide-mode)
- [Edge cases](#edge-cases)
- [Running it](#running-it)
- [Deploying](#deploying)
- [Project layout](#project-layout)
- [Design notes](#design-notes)
- [Staying inside the free tier](#staying-inside-the-free-tier)
- [Assumptions and limitations](#assumptions-and-limitations)
- [Submission summary](#submission-summary)

---

## The problem, and the one thing that decides it

The brief asks for extraction, mapping, highlighting and optional grading. Four of those are
ordinary work. The fifth — **highlight the exact answer region** — is the one that quietly
determines whether the whole thing works, because it depends on something no prompt can fix
afterwards: a bounding box has to survive the trip from PDF, through a renderer, through the
model, and onto the screen, landing on the same ink it started on.

That trip breaks if the image the model sees is not the image the teacher sees. Different
scale, different DPI, a server-side rasteriser with its own idea of page size — any of these
and every highlight drifts. Extraction can be flawless and the product still fails.

So the architecture starts there:

**Pages are rendered exactly once, in the browser, and that single render is both what the
model receives and what the teacher looks at.** Boxes are stored as percentages, never pixels,
so they stay correct at any zoom or window size. Everything else is built on top of that
guarantee.

## Architecture

Three tiers, with a real boundary between each.

```
  browser                    API routes                 services
  ---------------------      --------------------       -----------------------
  render pages once     ->   /assessments/:id/pages ->  store bytes verbatim
  drive the run         ->   /assessments/:id/advance -> one unit of work
  read the result       <-   /assessments/:id       <-  repository (fs | pg)
                                                        |
                                                        +-> Gemini (extract,
                                                            match, grade)
```

**The browser renders and drives; it does not orchestrate.** Rasterisation has to happen client
side to keep the single-render guarantee, so that stays. Everything after it — extraction,
matching, marking — runs on the server against stored pages, and the client's only job is to
ask for the next unit of work and draw whatever comes back.

**A run is a persisted state machine, not a request.** One `POST /advance` does exactly one
batch and writes the result:

```
uploading -> questions -> answers -> mapping -> grading -> done
                                                        -> failed
```

That shape is forced by a constraint — serverless functions are capped at 60 seconds and a
multi-page script needs several minutes of model time — but it pays for itself three times over:

- **Progress is honest.** The bar moves when a batch genuinely finished, read back from the job
  record. It can sit still for twenty seconds on a dense page and then jump, and that is the
  truth rather than a defect.
- **Failure is contained.** A rate limit part way through costs one batch. *Resume from where it
  stopped* picks up at the failed step with everything already extracted still in place.
- **The URL is real.** `/a/<id>` can be reloaded, shared or closed and reopened. Arriving mid-run
  resumes it; arriving after it finished renders the stored result without calling the model.

Concurrency is handled in two layers, because React's development double-effects and a second
open tab are both routine. An in-process mutex serialises callers on one instance, and a
persisted `leaseUntil` claim on the job narrows the cross-instance window from the length of a
model call to the length of a single write. A caller that sees no movement waits rather than
starting a duplicate batch.

**Storage is an interface with two drivers**, chosen once per process:

| Driver | When | Durable |
|---|---|---|
| `FsRepository` | default — writes to `./.data` | yes, locally |
| `PgRepository` | when `DATABASE_URL` is set | yes |

The brief says in-memory storage is sufficient, and the filesystem driver honours the spirit of
that: clone, `npm install`, run, no infrastructure. But a teacher who marks thirty scripts needs
yesterday's script to still be there, so runs are persisted and there is a library. On a
serverless host the filesystem is per-instance scratch, so `/api/health` reports
`durable: false` and the library page says so plainly instead of quietly losing history.

## How it works

```
 ┌──────────────┐
 │ two uploads  │  question paper (PDF/images) + answer sheet (PDF/images)
 └──────┬───────┘
        │  pdf.js in the browser — one render at 1600px
        ▼
 ┌──────────────┐   uploaded 3 pages per request, stored byte-for-byte,
 │ page images  │   and served back byte-for-byte to the viewer
 └──────┬───────┘
        │  from here the server owns the work
        ▼
 ┌──────────────┐        ┌──────────────┐
 │  questions   │        │ answer blocks│  transcription + regions[]
 └──────┬───────┘        └──────┬───────┘
        └────────┬──────────────┘
                 ▼
        ┌──────────────────┐
        │  mapping         │  1. canonical label match  (free, exact)
        │                  │  2. semantic match         (model, leftovers only)
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │    grading       │
        └────────┬─────────┘
                 ▼
     matched · unanswered · unmatched   — persisted, and listed in the library
```

### 1. Rendering

`pdf.js` rasterises every PDF page to a canvas at a fixed 1600px width; uploaded images are
scaled down to the same width. Output is JPEG at quality 0.82. PDFs and images are flattened
into one ordered page list, so a teacher can upload `page1.jpg, page2.jpg` or a single PDF and
get the same result.

Two details that matter: the canvas is filled white before drawing, because scans often carry
transparency that would otherwise flatten to black in JPEG; and images are only ever scaled
*down*, since upscaling a phone photo adds no detail for the model and inflates the request
body for nothing.

### 2. Question extraction

Pages go to Gemini in batches with a strict JSON schema. Three rules in the prompt do most of
the work:

- Return questions in printed order, never reordered by number.
- Every labelled sub-part is its own entry — `11 (a)` and `11 (b)` are two questions, never one.
- Reproduce the number exactly as printed. No renumbering, no normalising, no converting roman
  numerals to digits.

Section headings, instructions, board names and page furniture are explicitly excluded, since
a roman-numeralled section heading is the classic false positive.

### 3. Answer extraction

The same pages-to-model pattern, but the unit is an **answer block** rather than an answer. The
name is deliberate: at this stage we do not know which question a piece of writing belongs to,
or whether it belongs to any. Calling it an answer would smuggle in an assumption the mapping
stage has not yet earned.

Each block carries the label the student wrote (verbatim, or `null`), a transcription, and
`regions: [{ page, box }]`. **Regions is an array from the outset**, which is what makes
multi-page answers ordinary rather than a special case bolted on later.

**There is no separate OCR engine, and that is the point.** Handwriting recognition and region
detection happen in the same call: the model returns the transcription *and* the box that
encloses the ink it transcribed. A conventional OCR stage (Tesseract and friends) would be a
poor fit twice over — it is trained overwhelmingly on printed text and degrades badly on
cursive, and it returns word boxes rather than answer boundaries, so deciding where answer 5(b)
starts and stops would still need a second model pass. Doing both at once also guarantees the
transcription and the highlight describe the same ink, which two independent stages could not.

The transcription is shown in the UI next to each question, not kept backstage. Misread
handwriting is the most likely cause of a mark that looks wrong, and displaying what the model
actually read is the only way a teacher can tell a marking error from a recognition error.

Gemini returns boxes as `[ymin, xmin, ymax, xmax]` normalised to 0–1000. These are divided by
ten into percentages, clamped to the page, and padded slightly so the highlight breathes around
the ink. Regions that come back with zero area, or on a page the model was not shown, are
dropped — a highlight pointing at the wrong sheet is worse than no highlight.

### 4. Mapping — two passes, cheap one first

**Pass one is deterministic and free.** Both sides are reduced to a canonical key:

| written on the page | canonical key |
|---|---|
| `11 (a)` | `11\|a` |
| `Q.11 a` | `11\|a` |
| `11(A)` | `11\|a` |
| `Ans 11 a)` | `11\|a` |
| `5b)` | `5\|b` |
| `17 (iii)` | `17\|iii` |

Noise words (`question`, `ans`, `part`, `soln`) are stripped; the rest is tokenised into number
and letter parts. A second sub-pass repairs characters that handwriting recognition commonly
mangles — `ll(a)` back into `11|a`, `S(b)` into `5|b` — guarded so that a genuine roman numeral
like `(iii)` is never "repaired" into the number 111.

**Pass two is semantic, and only sees leftovers.** Questions nothing claimed and blocks that
claimed nothing go to the model together with their transcriptions, which proposes pairings with
confidence scores. Matches below 0.6 are surfaced in the UI as *check match* rather than
presented as fact.

The model is never asked to re-derive what a string comparison already settled. On a typical
script the first pass resolves most of the sheet and the second call is small or skipped
entirely.

### 5. Grading

Always on — the design shows a score on every question row.
One batched call over the matched pairs returns marks, a verdict,
per-question feedback and an overall note on the script.

Two rules worth naming. The paper's own printed mark allocation always outranks the model's
guess at it. And because transcriptions come from handwriting recognition, the prompt instructs
that an answer which looks wrong in a way a misread character would explain should be marked
generously and flagged — the student should not lose marks for the OCR.

Grading runs in its own stage with its own error boundary: if it fails, the run is still marked
done and the extraction and mapping results are delivered, with the failure explained in the
summary rather than thrown away.

### 6. Storing the run

Everything is written as it is produced, not at the end: pages when they arrive, questions and
blocks after each batch, mappings and grades as those steps complete. That is what makes a
reload mid-run resume, and what makes the library a list of finished work rather than a cache.

Page bytes are stored exactly as the browser produced them and served back with a one-year
immutable cache header. They are never re-encoded, re-scaled or re-rasterised anywhere on the
server — the single-render guarantee is a storage rule as much as a rendering one, because a
second render would invalidate every box in the record.

The record also carries two optional filing fields, `student` and `paper`, which is what turns a
flat history into the class and paper views described under [Design notes](#design-notes). Both
are nullable and both are normalised on read, so a record written before they existed loads
without a migration — the whole record is one JSON document either way.

## Two views, no login

A marked script has two readers with different stakes in it, so it has two views over one stored
record:

| | Teacher — `/a/<id>` | Student — `/s/<id>` |
|---|---|---|
| Upload a paper and a script | yes | no |
| Drive the run, resume a failure | yes | no — never calls `/advance` |
| Rename, file under a student or paper, delete | yes | no |
| Questions in printed order, marks, AI feedback | yes | yes |
| Click a question, highlight the exact region | yes | yes |
| Unanswered questions, unmatched writing | yes | yes |
| Change a mark, move an answer, leave a note | yes | no |
| Read the teacher's note on a question | yes | yes |
| Search and filter the question list | yes | yes |
| Export the marks as CSV | yes | no |
| Match-confidence notes | yes | no |
| Other students' scripts, dashboard, library | yes | no chrome to reach them |

**Why not two portals with two logins.** The brief asks for no authentication, and a sign-in
screen with no accounts behind it would enforce nothing while claiming otherwise. So the split is
one of *capability*, not identity: the teacher workspace is the whole product, and the student
view is a read-only result reached by a link the teacher shares. `Share with student` on a
finished run copies that link; `Preview` opens it.

The honest consequence is that the link is the credential — anyone holding it can read that one
result, and nothing else. Real use would put accounts behind this, and the shape would not have
to change: the student view already reads one record and exposes no route to another.

The student view also refuses to drive the job. Marking is the teacher's run; a student
refreshing a half-finished result should not be spending the school's model quota, so they see
*Still being marked* and a manual check-again button instead.

## The teacher overrules the model

A marking tool the teacher cannot argue with is a marking tool the teacher will not sign. So
every question carries a **Change mark** control: quick buttons for zero, half and full, a number
box for anything between, a note the student will read, and a dropdown to say *this answer over
here is the one that belongs to this question* — or that nothing on the sheet answers it at all.
One click of **Undo** puts the model's own verdict back.

**The correction is stored beside the model's grade, never over it.** A `Review` records what the
teacher decided; the model's `Grade` and `Mapping` stay exactly as they were. A single function,
`resolve()` in `lib/review.ts`, lays the corrections over the model's output on the way out of
storage.

That indirection is the whole design, and it buys three things:

- **The override is reversible.** Nothing was destroyed, so undo is a delete, not a repair.
- **The override is explainable.** The editor can say *the model gave 0.5 of 2* while showing the
  2 that now stands, because both numbers still exist.
- **The override cannot disagree with itself.** Marks are summed in four places — the history
  card, *My Classroom* and *Assignments*, the per-question *Exams* board, and the student's own
  copy. All four read through `resolve()`. A correction that reached the screen but not the boards
  would be worse than no correction at all: two totals, neither obviously wrong.

Reassignment recomputes rather than patches. *Unmatched writing* is defined as every block no
mapping claims, so moving an answer onto a question removes it from the orphan list by the same
rule that put it there, and detaching one puts it back. There is no second list to keep in step.

The server is the authority on what a mark may be. A mark above what the question carries is
refused with the number it carries, a negative mark is refused, a question that is not on the
paper is refused, and an answer block that is not on this sheet is refused. Marks are rounded to
halves, notes are capped, and a save that changes nothing deletes the correction instead of
storing an empty one. The response is the whole updated record, so the client never adds up
marks itself.

## Finding one question in a long paper

Below eight questions, a search box is clutter. At eight and above the rail grows a toolbar: a
search field that reads question text *and the transcribed answer*, so a teacher who remembers
what the student wrote can find it without remembering the number; and filter chips for
**Unanswered**, **Needs a look**, **Marks lost** and **Marked by you**.

Each chip carries its own count and only appears when that count is not zero — a chip reading
*Needs a look 0* is an invitation to click something that does nothing. Clicking the active chip
clears it. Filtering hides rows without reordering them, so question 9 is still below question 4
in the narrowed list; printed order is a property of the paper, not of the current view.

## Taking the marks out of the app

Marks end up in a spreadsheet or a school system, so **Export CSV** sits on the workspace toolbar
for one script and inside each open panel on *Exams* for a whole paper.

The file is written for the program that will actually open it. A UTF-8 BOM leads, so Excel does
not mangle names outside ASCII. Quotes are doubled and rows end `\r\n`, per RFC 4180. Cells
beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe, because the cells hold
transcribed handwriting and a student who wrote `=2+2` should not have it evaluated on the
teacher's machine. Filenames drop the characters Windows refuses, and a script nobody has filed
still produces a file rather than a name that is only an extension.

Rows come out in printed order with the mark that now stands, and a column saying whether it was
the teacher's or the model's — so the export answers the question a marks sheet is usually asked
to answer.

## Guide mode

A teacher meets this app once, usually with a stack of scripts already waiting. The help popover
in the top bar explains the product correctly and in one place — which is the problem: it explains
the product in one corner, away from the thing it describes. Reading it means leaving the screen
you are stuck on.

Guide mode instead pins a one-line explanation **beside the control it explains** — fifteen of
them, one per feature, on every screen. Each opens on a click into two sentences that answer
different questions: *why this exists* and *what to do with it*. Both are needed. A teacher who
reads only what a button does still has to work out whether it is worth pressing.

It is **on the first time a browser opens the app** and off from the moment it is turned off,
kept in `localStorage` per browser. One switch in the top bar clears every tip on the page at
once, and the small x on any tip is that same switch rather than a per-tip dismissal — otherwise
turning the guide off means fifteen clicks in fifteen places.

Three decisions carry most of the design:

**Collapsed until asked.** The first version rendered every explanation open, which put four
paragraphs above the question list and pushed the actual marking below the fold. A guide that has
to be turned off before the product is usable is one nobody will leave on. A titled line costs one
row and says all it needs to: *there is an explanation here*.

**Dashed and brand-tinted, a style used nowhere else.** Tips have to read as scaffolding that is
about to be taken away, not as part of the interface. A solid panel in the product's own styling
would have a teacher spending their first minute working out whether the orange box is a warning
about their paper.

**Shown where the feature is, and only when it is.** The rail toolbar tip appears only on papers
long enough to grow a toolbar; the orphan tip only when there is unmatched writing; the mark
editor tip only once a teacher opens the editor — explaining a correction at the moment they are
making one, rather than on a screen where nothing is wrong yet. Turned off, the tips are absent
from the DOM rather than hidden with CSS, so a screen reader walking a working session never meets
tutorial copy.

The copy lives in one file as data (`lib/guide.ts`), which is what lets the suite check it:
that every explanation is placed on a screen, that every placement names a real one — a typo in an
`id` renders nothing and looks exactly like a tip that was never added — and that no entry says
the same thing twice in its two voices.

## Edge cases

Every requirement in the brief, and where it is handled:

| Requirement | How |
|---|---|
| Every question, in printed order | Batches are sent in page order and concatenated; `order` freezes printed position and the UI never re-sorts. |
| Sub-parts as separate entries | Enforced in the extraction prompt; verified by test. |
| Preserve original numbering | `Question.number` keeps the printed string for display. The canonical key is a separate field used only for matching. |
| Answers out of order | Not handled — *designed out*. Matching is by key, never by sequence, so a student answering 7 before 3 needs no special path. |
| Unanswered questions | Any question the label pass and semantic pass both leave unclaimed. Shown in red, counted, and named in the grading summary. It is also graded — zero out of the marks the paper printed — so it stays in the denominator: a script that skipped a 3-mark question scores 7/10, not a flattering 7/7. |
| Answers matching no question | Unclaimed blocks become orphans, listed separately under *Unmatched writing* and highlighted in red. |
| Read the student's handwriting | Gemini vision transcribes each block verbatim, errors included, `[illegible]` where it cannot read rather than a plausible guess. No separate OCR engine. |
| Display questions and answers side by side | Questions in printed order on the left, the answer sheet on the right, and the transcription of the matched answer under each question. |
| Exact region highlighting | Single-render guarantee plus percentage coordinates. |
| Answers spanning pages | `regions[]` is an array; blocks split across a request batch are rejoined by label, and the viewer scrolls to the first region so the teacher lands at the start of the answer. |
| A teacher who has never seen this before | Guide mode: an explanation pinned beside each feature, on by default for a new browser, off in one click. |
| Processing progress | Real per-batch progress, not a timed animation — the bar advances when a batch the server actually finished is written to the job record. |
| A run interrupted part way | The job is persisted, so reloading `/a/<id>` resumes at the step it reached. A failure keeps everything extracted before it and offers *Resume from where it stopped*. |
| The model marks something wrong | The teacher overrules it — mark, mapping or both — and the correction reaches the history card, both boards, the exam analysis and the student's copy at once, because all five resolve through one function. |
| The same run open twice | An in-process mutex plus a persisted lease claim; the second caller sees no movement and waits instead of duplicating a batch. |

### Tests

The logic that has to be right every time is covered by 297 assertions that need no API key and
no network:

```bash
npm test
```

They cover out-of-order answers, sub-part separation, orphan detection, cross-page rejoining,
misread-label recovery, roman-numeral protection, and one-to-one enforcement in the semantic
merge — plus the job arithmetic: batch boundaries, terminal states, monotonic progress, where a
failed run parks its bar, and the lease and the lock that together keep two tabs off one batch.

They also cover the grouping behind *My Classroom* and *Assignments*: that a group is named by
the field it was grouped on rather than by whichever name a run happens to carry, that only a
finished run contributes to an average, that a run nobody has filed is never given an invented
heading, and that two spellings of one student's name collapse into one student.

The per-question analysis behind *Exams* is covered the same way: that marks sum across scripts
rather than averaging averages, that a blank answer enters the total as a zero instead of
vanishing from it, that a question only one of two scripts carried is scored on that script alone
and not counted against the other, that a question with no grade at all reports no percentage
rather than a zero, and that rows come out in printed order however they were stored. Alongside
them sit the run-state rules, which decide whether a run that is not finished is still working,
has stopped, or was abandoned before a single page was ever uploaded.

The corrections are covered hardest, because they are the one place a wrong answer would be the teacher's rather than the model's: that a script nobody has corrected comes back byte for byte as the model left it, that a mark above what a question carries is clamped rather than stored as given, that a note on its own does not disturb a mark, that moving an answer removes it from the orphan list and detaching one puts it back, that a review naming a block that no longer exists is ignored rather than obeyed, that verdicts are recomputed from the mark that now stands, and that a correction reaches the per-question board and not only the screen. Beside them sit the export rules: quote doubling, the formula guard, printed order, and filenames a filesystem will accept.

Guide mode is checked as data rather than as rendering: the suite walks `app/` and
`components/` for every `<GuideTip>` placement and asserts the two sets agree in both
directions — no explanation written but never shown, no placement naming an entry that does
not exist.

Two of these guards exist because the test caught the bug. The roman-numeral guard stops `(iii)`
becoming the number 111. And the mid-label repair exists because `canonicalize` splits digit runs
from letter runs, so `1O)` — ten, with the zero read as a letter — arrived as `1|o`, question one
part o, matching nothing.

What the suite does not touch is anything needing the model or a browser canvas. Stubbing Gemini
would only ever prove the stub works, so those paths are exercised end to end against a running
server instead.

## Running it

Requires Node 18.17 or newer.

```bash
npm install
cp .env.example .env.local     # add your key
npm run dev
```

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and put it in
`.env.local`:

```
GEMINI_API_KEY=your_key_here
```

Open http://localhost:3000.

Runs are written to `./.data` (git-ignored). Nothing else is needed to develop against, and
`/api/health` will report `storage: filesystem, durable: true`. To use Postgres instead — which
is what a serverless deployment wants — set `DATABASE_URL` and the schema is created on first
use.

## Deploying

Works on Vercel with no configuration beyond the environment variable.

```bash
vercel
vercel env add GEMINI_API_KEY
vercel env add DATABASE_URL      # optional, but see below
```

Three constraints shaped the deployment approach:

- **Request body limit.** Vercel caps serverless request bodies at 4.5 MB, and base64 adds about
  a third to an image's size. Pages are sent three at a time, which stays clear of the ceiling
  and doubles as an honest progress signal.
- **Execution time.** Routes declare `maxDuration = 60`. Batching keeps any single call well
  inside that.
- **Execution is not shared, and neither is the disk.** Serverless invocations share no memory,
  and a container's filesystem is per-instance scratch that does not survive a redeploy. So the
  run lives in storage rather than in a process, and work is claimed with a persisted lease
  rather than an in-memory flag. Set `DATABASE_URL` on the deployment for real durability; with
  it unset the app still works and `/api/health` reports `durable: false`, which the library
  page surfaces rather than hides.

Fonts load via stylesheet rather than `next/font` on purpose: `next/font` fetches at *build*
time, so a blocked or slow Google Fonts response turns a cosmetic problem into a failed
deployment. A stylesheet link degrades to the fallback stack instead.

## Project layout

```
app/
  page.tsx                    upload, render, hand off to the server
  a/[id]/page.tsx             one run, resumable — the teacher workspace
  s/[id]/page.tsx             the same run, read-only, for the student
  home/page.tsx               dashboard computed from stored runs
  history/page.tsx            the library of past runs
  classroom/page.tsx          stored runs grouped by student
  assignments/page.tsx        stored runs grouped by question paper
  exams/page.tsx              a paper broken open, one row per question
  settings/page.tsx           display identity, live storage and model readings
  layout.tsx                  fonts and document shell
  globals.css                 palette, type roles, highlight styles
  api/
    health/                   storage driver, durability, model config
    exams/                    GET per-question results across scripts
    assessments/              GET list, POST create
      [id]/                   GET, PATCH title/student/paper, DELETE
        pages/                POST a batch of rendered pages
        pages/[kind]/[index]/ GET the stored bytes, immutably cached
        advance/              POST one unit of work
        retry/                POST to resume a failed run
        review/               PUT a teacher correction, DELETE to undo it

server/                       server-only; never imported by the client
  http.ts                     JSON responses and error-to-status mapping
  db/
    types.ts                  the Repository interface both drivers implement
    fs-driver.ts              default: ./.data, no infrastructure
    pg-driver.ts              used when DATABASE_URL is set
    index.ts                  driver selection, once per process
  ai/
    gemini.ts                 REST client, quota policy, backoff, box conversion
    prompts.ts                model instructions and JSON schemas
  services/
    job.ts                    the state machine — one advance, one batch
    lock.ts                   per-run mutex against double-effects and tabs
    assessments.ts            create, read, update details, delete, store pages
    extraction.ts             pages → questions / answer blocks
    matching.ts               label pass, then semantic pass on leftovers
    grading.ts                matched pairs → marks, feedback, summary
    exams.ts                  picks the runs the per-question analysis reads

lib/                          shared by both sides; no I/O, no secrets
  types.ts                    domain model; the Box-is-percentages decision
  job.ts                      batching, step order, progress, lease arithmetic
  api.ts                      the browser's typed view of the backend
  pdf.ts                      the single render; batching
  normalize.ts                canonical keys and the misread-digit repair
  mapping.ts                  label pass, coalescing, 1:1 semantic merge
  display.ts                  question refs, score chips, relative times
  cohort.ts                   groups runs by student or paper and totals them
  exam.ts                     per-question totals across scripts of one paper
  review.ts                   lays teacher corrections over the model's output
  csv.ts                      export formatting; the Excel hazards, handled
  download.ts                 hands the browser a file; the only DOM part of export
  profile.ts                  the display identity kept on this browser
  guide.ts                    guide-mode copy, as data so it can be tested
  guide-mode.ts               the on/off switch, kept per browser

components/
  Shell.tsx                   sidebar + top bar + one scroll region
  Sidebar.tsx                 collapsible product nav; owns the NAV list
  TopBar.tsx                  breadcrumb, help, notifications, phone drawer
  GroupBoard.tsx              one board; My Classroom and Assignments are it
  icons.tsx                   inline SVG set
  GuideTip.tsx                one explanation, pinned beside what it explains
  UploadPanel.tsx             two drop zones, page counts, size guard
  ProcessingProgress.tsx      progress read from the job record
  Workspace.tsx               drives the run, then renders the result
  StudentView.tsx             the read-only result, minimal chrome
  QuestionRail.tsx            question list, statuses, orphans; audience-aware
  MarkEditor.tsx              change a mark, move an answer, leave a note
  SheetViewer.tsx             page stack, overlay, zoom, scroll-to-answer

tests/run.cjs                 297 logic assertions, no network needed
scripts/copy-pdf-worker.mjs   puts the pdf.js worker at a stable URL
```

## Design notes

The interface follows the supplied Figma frames. Where the design and the brief disagreed, both
are noted below along with how it was resolved.

**Light, because the page is the subject.** The chrome is `#F1F1F1` canvas with white panels;
the scanned sheet sits inside that on its own white card. VedaAI's own product uses this
language — Bricolage Grotesque for headings, Figtree for interface text, Fragment Mono for
references, and the orange `#FC5E24` that plates key words in a heading the way a highlighter
would. That plate is reused literally: *Upload **Question Paper & Answer Sheets***.

**Orange is never decorative — it means "you are here".** The selected question's disc turns
orange; nothing else in a resting state is orange. The answer highlight, by contrast, is
**green**, so selection on the left and location on the right are never confused for one another.
Red marks absence and mismatch; amber marks a partial score or a match worth checking.

The highlight uses `mix-blend-mode: multiply` so the handwriting stays readable *through* the
wash rather than veiled by it — the teacher is reading ink through that rectangle. Each active
region carries a small tab reading `Q2` or `Q11a` pinned to its top-left corner, which flips
below the box when the answer starts within 4% of the page top and the tab would otherwise be
clipped.

**Questions read as the paper prints them.** A row is a numbered disc plus, for sub-parts, a
small letter beside it — so `11(a)` and `11(b)` share the disc `11` and read as one question in
two parts, while remaining two separate entries in the data. `lib/display.ts` does that split
for presentation only; the canonical key used for matching is untouched.

**Two deliberate departures from the frames:**

- *The loading screen.* The design shows a sparkle, a heading and one grey line, with no progress
  at all; the brief requires processing progress to be shown. The composition is kept exactly and
  the progress is carried by the heading, the subline and one 3px hairline — real progress, tied
  to renders and request batches completing, never to a timer.
- *The grading toggle is gone.* The frames show a score chip on every question row, so grading is
  always on rather than opt-in. It still runs in its own stage behind its own error boundary: if
  marking fails, extraction and mapping results are still delivered.

**Below `md` the two panes become tabs** (`Questions | Answer Sheet`), as in the phone frames, and
the sidebar drops out entirely. Selecting a question switches to the sheet, since that is where
the teacher was heading anyway.

**Every destination in the chrome goes somewhere.** *My Library* lists past runs, and *Home* is a
dashboard computed from those same stored runs — scripts marked, questions
extracted, answer coverage, average score, and the runs worth a second look. Every number on it
is derived from the repository; there is no seeded data, so an empty account shows an empty
dashboard.

*My Classroom* and *Assignments* are the same stored runs read two other ways. A run carries two
optional fields — the student it belongs to and the paper it was marked against — typed at upload
or added afterwards from the workspace. Grouping on the first gives a class: every student who has
been marked, their average across every paper, and each script underneath. Grouping on the second
gives the paper's side of it: the class average on that paper and how often anybody left a
question blank.

Both boards are one component (`GroupBoard`) over one reduction (`lib/cohort.ts`), because they
differ only in which field they group on and what the copy calls the result. Three rules make them
trustworthy rather than merely populated. A run that stopped part way is excluded from every
total, since a crash has a real question count and a real zero and would otherwise be reported as
a bad result. Buckets are keyed case-insensitively, so `Aarav Sharma` and `aarav sharma` are one
student. And a run with the field blank goes to an *unfiled* list with an inline box to name it,
never into an invented group — the alternative, a page of fabricated students, would look more
finished and be worth less.

*Exams* is the third reading, and the only one that says something the other two cannot. A group
board stops at one percentage, and a percentage is not something a teacher can act on: knowing the
class averaged 70% does not say what to reteach. So Exams opens a paper up and puts one row per
question across every script marked against it — marks earned over marks available, how many
scripts left it blank, and the two or three questions the class found hardest named in the
collapsed header. On the demo data it is immediately the most useful screen in the app: 11(b),
*derive the relation between force and rate of change of momentum*, scored 0 out of 6 because both
students left it blank.

It costs no model call. Every per-question mark was written down when the script was graded, and
this only adds them up — server-side, because the history list carries counts rather than
questions and doing it in the browser would mean pulling every full record across the network to
reach numbers the server already has on disk.

The same honesty rules apply as on the boards, plus one more. A paper sat by exactly one script is
still shown, because one script is what most runs will have — but the panel says so in plain words
rather than calling one student's result a class average.

*Settings* is the same principle applied to the machinery: your display name and school, which
storage driver is live and whether it survives a restart, how many runs and answer pages are
stored, which model reads the scripts and whether a key is configured, why there is nothing to
sign into, and one button that deletes everything. Every reading comes from `/api/health` or the
repository; nothing on it is decorative.

Nothing invents an identity either. There is no account to read a name from, so the sidebar crest
and the avatar come from a display profile kept in this browser's `localStorage`, and until it is
set they say *Add your school* rather than naming a school nobody chose. The *Help* and
*Notifications* buttons in the top bar open real popovers — the first documents the four stages,
the chips and the arrow keys, the second lists runs that stopped or are still working, with its
dot appearing only when there is something in it.

**On a phone the top bar is the only navigation**, since the sidebar is desktop-only. The menu
button opens a drawer built from the sidebar's own nav list, so a destination cannot exist in one
and not the other.

Arrow keys walk the question list, in the student view as well as the teacher one. Marking a
stack of scripts is repetitive, and reaching for the mouse on every question makes it slower than
it needs to be; a student reading a marked script back goes through it in order too. The handler
is scoped to the list rather than to the page, so it cannot fight the sheet's own scrolling, and
it clamps at both ends rather than wrapping — arriving back at question 1 after the last one is
never what the press meant.

## Staying inside the free tier

A free Gemini key is metered two ways at once — requests per minute, and requests per day — and
the two failures want opposite responses. Treating both as "429, wait a moment and try again" is
what makes a key appear to run out far sooner than its allowance should allow, and this build got
that wrong before it got it right.

Three things were compounding. Retries were amplifying: five attempts with sub-second backoff all
landed inside the same sixty-second window, so tripping the per-minute limit once guaranteed all
five failed *and* all five were charged. Daily-quota rejections were retried too, which can never
succeed — a day does not end in twelve seconds — and burned four more requests each time it
happened. And Google says in the rejection itself how long to wait, in a `RetryInfo` field the
code was ignoring in favour of its own 0.8 seconds.

The fix is to read the rejection properly and then treat the two limits differently:

| | Per-minute | Per-day | 5xx |
|---|---|---|---|
| Retried | yes, once the API's own `retryDelay` has passed | **never** | yes, exponential |
| Afterwards | proceeds normally | further calls refused locally until midnight Pacific | proceeds normally |

Refusing locally is the part that matters. Once the daily allowance is gone, every further call is
a certain rejection, so the client stops making them and says when the allowance returns instead
of discovering it one wasted request at a time.

Two things keep it from getting there in the first place. A rolling-window limiter paces requests
to `GEMINI_RPM` (10 by default) — it costs nothing while under the limit and simply waits when a
burst would exceed it. And thinking is set to `low`: the model is a reasoning model that spends
thinking tokens by default, which the extraction and grading prompts do not need, and `minimal`
is available via `GEMINI_THINKING` if the allowance is tight.

Every retry also runs against a 25-second budget, so no single call can outlive the 60-second
limit of the route it is running inside and turn a recoverable hiccup into a dead request.

**What a run actually costs.** Three requests for the demo pair: one to extract the questions, one
to read the handwriting, one to grade. Mapping usually costs nothing at all — the label pass
resolved all eleven answers on the demo script, and the semantic pass only runs on what is left
over. Longer scripts cost one request per three pages per extraction stage.

`/api/health` and *Settings* both report whether the daily allowance is spent and how many
requests went out in the last minute, so the answer to "why did it stop" is on screen rather than
in a log.

## Assumptions and limitations

Named plainly, because knowing where a system breaks is more useful than claiming it does not.

**Handwriting recognition is the accuracy ceiling.** Neat writing transcribes well; cramped,
slanted or heavily corrected writing does not. Every downstream stage inherits whatever the
transcription got wrong. The grading prompt compensates where a misread is plausible, but it
cannot recover text that was never read correctly.

**Diagrams, graphs and geometric constructions are located but not understood.** A region
containing a diagram will be highlighted correctly; its marking will be unreliable. Heavily
diagrammatic papers are outside what this handles well.

**One student per run.** The brief specifies a single answer sheet. Batch processing across a
class would need a queue and a different results view.

**Unlabelled answers rely on the semantic pass.** A student who writes no question numbers at
all is matched purely on content. That works when the questions are topically distinct and
degrades when several ask similar things — which is why low-confidence matches are flagged for
review rather than presented as settled.

**Rotated or skewed scans are not corrected.** Boxes are axis-aligned rectangles, so a page
photographed at an angle produces boxes that enclose the answer loosely. Deskewing before
rendering would fix this and is the obvious next improvement.

**Free-tier rate limits are real.** Retry with exponential backoff and jitter is implemented, and
batching keeps call counts low, but a long paper processed repeatedly in quick succession can
still hit a limit. The error surfaces to the teacher rather than failing silently.

**History is only as durable as the storage behind it.** With `DATABASE_URL` set, runs persist
properly. Without it the filesystem driver is used, which is durable locally but is
per-instance scratch on a serverless host — history survives a reload, not a redeploy. The app
reports which one it is running on rather than letting a teacher discover it by losing work.

**Nothing is scoped to a user.** The brief asks for no authentication, so the library is a single
shared list. Anyone with the URL can open, and delete, any run. That is fine for an assignment
and is the first thing that would have to change for real use.

**The student link is the credential.** `/s/<id>` is unguessable but not secret: whoever holds it
reads that one result. It cannot reach any other run, upload anything or change a mark, so the
blast radius is one script — but it is a share link, not a login, and is described that way in
the UI rather than dressed up as one.

**Deleting is immediate and permanent.** There is a confirmation, but no undo and no soft delete:
the record and its page images go together.

## Submission summary

**Approach.** Render once in the browser so the model and the teacher see identical pixels, and
store those exact bytes rather than re-rasterising anywhere; keep every coordinate as a
percentage of its page. From there the server owns the work: a run is a persisted state machine
where one request does one batch, which keeps every call inside the serverless time limit and
makes progress honest, failures recoverable and the run's URL reloadable. Questions and answer
blocks are extracted with schema-constrained multimodal calls; mapping runs deterministically on
canonical labels first and falls back to a semantic pass only for what is left; grading is a
separable stage behind its own error boundary. Answer regions are arrays from the start, which
turns multi-page answers from an edge case into the default shape. Runs are persisted through a
repository interface with two drivers — filesystem by default so the project clones and runs
with no infrastructure, Postgres when `DATABASE_URL` is set — so past scripts stay in a library
instead of vanishing on refresh. The same record is read by two views — the teacher workspace
that drives the marking, and a read-only student result the teacher shares — so the roles differ
in capability rather than behind a login the brief rules out. Because a marking tool the teacher cannot argue with will not be trusted, every mark and every match can be overruled, with the correction stored beside the model output rather than over it, so the change is reversible and every total in the app resolves through one function. And because the person meeting this tool for the first time is a teacher with a stack of scripts already waiting, an optional guide mode pins a one-line explanation beside each feature rather than filing them all in a help panel in the corner: on for a browser that has never been here, off in one click, and absent from the DOM rather than hidden when off.

**Model.** Google Gemini (`gemini-3.6-flash` by default, configurable via `GEMINI_MODEL`).
Chosen because it does handwriting transcription *and* returns bounding boxes in a single call —
a text-only recogniser would satisfy the extraction requirement while making the highlighting
requirement impossible without a separate detection stage.

**Free-tier behaviour.** A run costs three model requests for a two-page paper and a three-page
script. Per-minute and per-day rejections are handled differently rather than both being retried,
the API's own advised delay is honoured, requests are paced by a rolling-window limiter, and once
the daily allowance is spent the client stops calling until it resets and says so on screen.

**Key limitations.** Handwriting quality caps accuracy; diagrams are located but not marked;
skewed scans yield loose boxes; unlabelled answers depend on semantic matching and are flagged
when uncertain. There is no authentication, so the library is one shared list. Without
`DATABASE_URL` on a serverless deployment, history is scratch storage and does not survive a
redeploy — the app reports this rather than hiding it.
