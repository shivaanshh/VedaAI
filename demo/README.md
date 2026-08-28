# Demo paper and script — with the answer key

A fresh question paper and one student's answer script, built to test the app rather than to
flatter it. Nothing here touches the two runs already in `.data/`; upload these as a new run and
compare what comes back against the key below.

```
demo/
  question-paper.pdf      2 pages — 12 question entries, 23 marks
  answer-sheet.pdf        3 pages — one student's script
  images/                 the same five pages as PNGs, if you would rather
                          test the image path than the PDF path
  src/                    the HTML both were rendered from — this is the
                          ground truth, in case you want to check a claim
```

Upload `question-paper.pdf` as the paper and `answer-sheet.pdf` as the script. Student
*Ishaan Verma*, paper *Class IX Physics — Half-Yearly*, if you want it filed.

---

## What the paper contains

Twelve entries, 23 marks. **Ten printed numbers, twelve questions** — that gap is the first test.

| # | Question | Marks |
|---|---|---|
| 1 | Define inertia | 1 |
| 2 | State Newton's third law | 2 |
| 3 (a) | SI unit of momentum | 1 |
| 3 (b) | Momentum of 5 kg at 4 m/s | 2 |
| 4 | Distinguish mass and weight | 2 |
| 5 | Why a fielder lowers his hands | 2 |
| 6 (i) | Law of conservation of momentum | 2 |
| 6 (ii) | An everyday example of it | 1 |
| 7 | F = 10 N on 2 kg — find a and v after 3 s | 3 |
| 8 | Uniform circular motion + example | 2 |
| 9 | Velocity–time graph, and what the slope means | 3 |
| 10 | Two applications of Newton's first law | 2 |

## The order the student answered in

Deliberately jumbled, which is what the mapping stage exists for:

```
page 1   Ans 1.  →  Ans 2.  →  Ans 4.  →  Q 3 (b)
page 2   3 (a)   →  Ans 6 (ii)  →  6 (i)  →  Ans 5.  →  Ans 7. ─┐
page 3   ┌────────────────────────────────────────────────────┘
         └ (Q7 finishes)  →  Ans 8.  →  Ans 10.  →  rough work  →  a note
```

---

## The nine things being tested

**1. Sub-parts split.** `3 (a)` and `3 (b)` are two questions, `6 (i)` and `6 (ii)` are two more.
Twelve entries, not ten. Ten means the extraction collapsed them.

**2. Roman numerals survive.** `6 (i)` and `6 (ii)` must stay roman. If they come back as `6.1`,
`61`, or as questions `1` and `11`, the canonicalizer broke — this is the exact bug the
roman-numeral guard in `lib/normalize.ts` exists for.

**3. Printed order holds.** The rail must read 1, 2, 3(a), 3(b), 4 … 10 regardless of the order
the student wrote in.

**4. Out-of-order mapping.** Q4 is answered before Q3, and Q5 four answers after where it "should"
be. Every one must still land on its own question.

**5. Sub-parts answered backwards.** The student wrote `3 (b)` before `3 (a)`, and `6 (ii)` before
`6 (i)`. Both pairs must map correctly, not swap.

**6. An answer crossing a page break.** Q7 begins in the last three lines of page 2 and finishes in
the first six lines of page 3. Correct behaviour: **one** answer for Q7 carrying **two regions**,
one on each page — not two separate answers, and not page 3 orphaned. Clicking Q7 should take you
to page 2, where the answer starts.

**7. An unanswered question.** Q9 is never attempted. It must show as unanswered, and be graded
**0 out of 3** — which is what keeps the denominator honest.

**8. Two orphans — and one of them is a trap.** The rough work (`10 ÷ 2 = 5`, `5 × 3 = 15`) belongs
to no question. So does the last line: *"Sir, I could not attempt Q9 as the time was over."*
That line **names Q9**, so a mapper matching on mentions rather than on answers will bind it to Q9
and report Q9 as answered. Both blocks belong under *Unmatched writing*, and **Q9 must stay
unanswered**. This is the sharpest test in the set.

**9. Labels written five different ways.** `Ans 1.`, `Ans 2.`, `Q 3 (b)`, `3 (a)`, `Ans 6 (ii)`,
`6 (i)`. All must canonicalise to the same keys the paper produced.

---

## The marking key

The script is written to be genuinely mixed — some right, one wrong, one half-right, one skipped.
A grader that returns full marks is not reading it.

| # | What the student wrote | Should score | Why |
|---|---|---|---|
| 1 | Correct definition | **1 / 1** | |
| 2 | Correct, adds that the pair acts on different bodies | **2 / 2** | |
| 3 (a) | `kg m/s` | **1 / 1** | |
| 3 (b) | `p = m + v = 5 + 4 = 9 kg m/s` | **0 / 2** | **Added instead of multiplying.** Answer is 20 kg m/s. |
| 4 | Mass in kg; weight "also measured in kg" | **1 / 2** | Mass right, weight's unit wrong — it is the newton. |
| 5 | More time → lower rate of change of momentum → less force | **2 / 2** | |
| 6 (i) | Correct statement with the no-external-force condition | **2 / 2** | |
| 6 (ii) | Gun recoil | **1 / 1** | |
| 7 | a = 5 m/s², v = 15 m/s, working shown | **3 / 3** | Both parts right. |
| 8 | Correct, with the direction-changes point and the moon | **2 / 2** | |
| 9 | *(not attempted)* | **0 / 3** | |
| 10 | Bus starting suddenly; dust from a beaten carpet | **2 / 2** | |
| | | **17 / 23 ≈ 74%** | |

Grading has judgement in it, so treat the total as a band, not a number. **15–19 out of 23 is a
good result.** What actually matters is narrower than the total:

- **3 (b) must lose marks.** It is arithmetically wrong in a way a careful marker catches. Full
  marks here means the grader is rewarding the presence of working rather than reading it.
- **4 must lose about one mark.** Right on mass, wrong on weight's unit.
- **9 must be 0 / 3**, and must not be quietly dropped from the denominator.
- **Nothing should score above its printed marks.**

---

## Reading the result honestly

Where to look, and what a failure looks like:

| Look at | Good | Bad |
|---|---|---|
| Question rail | 12 entries, printed order, romans intact | 10 entries, or `6.1`, or reordered |
| Q7 | one answer, highlights on pages 2 and 3 | two answers, or page 3 orphaned |
| Q9 | red, unanswered, 0/3 | answered — the note trapped it |
| Unmatched writing | 2 blocks (rough work, the note) | 0, or the whole of page 3 |
| Click any question | highlight lands on that answer's ink | drifts, or lands a line or two off |
| Total | around 17/23 | 23/23, or Q9 excluded from the denominator |

The highlight is worth checking on all twelve, not one. Box drift shows up on the answers furthest
down a page, so check Q3(b) on page 1 and Q10 on page 3 — those are where it would surface first.

---

## One caveat, stated plainly

**This is a synthetic hand, not a scan.** The script is rendered in Ink Free with per-line rotation
and jitter and a fraction of a degree of skew per page, so it is a fair test of layout, region
detection, mapping and marking — but it is cleaner and more even than real student writing.

So it will flatter transcription accuracy. The structural tests above are the honest part; if you
want a true reading on **handwriting** specifically, photograph a real handwritten page and upload
that instead. The rest of the pipeline is exercised properly either way.
