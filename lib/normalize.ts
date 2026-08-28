/**
 * Turning printed and handwritten question labels into a single comparable key.
 *
 * A paper prints "11 (a)". A student writes "Q.11 a", or "11a)", or "5b)".
 * These are the same reference written six ways. Canonicalising both sides to
 * "11|a" lets the first mapping pass be exact, cheap and order-independent —
 * which is what makes "answered out of order" a non-problem rather than a
 * special case.
 *
 * The original string is never mutated in place; `Question.number` keeps the
 * printed form for display, because preserving the paper's own numbering is a
 * requirement.
 */

/** Words that appear around a label without being part of it. */
const NOISE = new Set([
  "question",
  "questions",
  "ques",
  "qn",
  "q",
  "ans",
  "answer",
  "answers",
  "sol",
  "soln",
  "solution",
  "part",
  "no",
  "num",
  "number",
  "sub",
  "attempt",
]);

/**
 * "Q.11 (a)" -> "11|a"
 * "5b)"      -> "5|b"
 * "17 (iii)" -> "17|iii"
 * "4."       -> "4"
 * ""         -> ""
 */
export function canonicalize(raw: string | null | undefined): string {
  if (!raw) return "";

  const tokens = raw
    .toLowerCase()
    .match(/[0-9]+|[a-z]+/g);

  if (!tokens) return "";

  const kept = tokens.filter((t) => !NOISE.has(t));
  return kept.join("|");
}

/**
 * Common confusions when a digit is read out of handwriting.
 * Applied only to a token we already expect to be numeric, so roman numerals
 * like "i" and "x" in later slots are never touched.
 */
const DIGIT_LOOKALIKE: Record<string, string> = {
  l: "1",
  i: "1",
  o: "0",
  s: "5",
  z: "2",
  b: "8",
  g: "9",
};

/** Roman numerals i–xxxix, the range sub-parts realistically use. */
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/;

function isRoman(token: string): boolean {
  return token.length > 0 && ROMAN.test(token);
}

/**
 * The lookalikes that are safe to repair in the middle of a label.
 *
 * Deliberately narrower than the table above. "b" and "i" are also how papers
 * label sub-parts, so repairing them here would read "5b)" as fifty-eight and
 * lose a perfectly good reference to question 5 part b. These four are the
 * lookalikes no paper uses as a sub-part marker — you would need twelve
 * sub-parts before reaching (l) — so one of them pressed against a digit is a
 * misread digit rather than a part label.
 */
const ADJACENT_LOOKALIKE = /[loszLOSZ]/g;

/**
 * Repairs lookalikes that sit directly against a digit, before tokenising
 * separates them.
 *
 * canonicalize splits a label into digit runs and letter runs, so "1O)" — ten,
 * with the zero read as a letter — comes out as "1|o": question one, part o.
 * That matches no question, and on a paper that really does have a part (o) it
 * would match the wrong one. By the time the existing repair sees the key the
 * head token is already a clean "1" and it returns untouched.
 */
function repairAdjacent(raw: string): string {
  const swap = (run: string) =>
    run.replace(ADJACENT_LOOKALIKE, (ch) => DIGIT_LOOKALIKE[ch.toLowerCase()] ?? ch);

  return raw
    .replace(/([0-9])([loszLOSZ]+)/g, (_, digit: string, run: string) => digit + swap(run))
    .replace(/([loszLOSZ]+)([0-9])/g, (_, run: string, digit: string) => swap(run) + digit);
}

/**
 * A more forgiving key used only as a second pass, after exact matching has
 * had its turn. Repairs a digit that handwriting recognition turned into a
 * letter, whether it sits mid-label — "1O)" back into "10" — or takes the whole
 * leading token — "ll(a)" back into "11|a".
 *
 * Three guards keep the repair from doing damage. Mid-label it only touches
 * letters no paper uses as a sub-part marker. A roman numeral is left alone, or
 * "(iii)" would become the number 111. And only a short leading token is
 * repaired, because a longer run of letters is a word, not a misread number.
 *
 * That this pass runs second is itself a guard: anything it gets wrong was
 * already unmatched by exact comparison, so a bad repair costs a match that did
 * not exist rather than spoiling one that did.
 */
export function fuzzyCanonical(raw: string | null | undefined): string {
  const base = canonicalize(raw);
  if (!base) return "";

  /**
   * Repaired before canonicalising, because the split into tokens is what hides
   * the damage: by the time "1O" is "1|o" the misread letter is no longer next
   * to the digit it belongs with.
   *
   * The result is taken only when it yields FEWER tokens than the plain key.
   * That is the exact shape of the mistake this undoes — a digit torn away from
   * the run it belongs to — and refusing every other outcome keeps the repair
   * off text that was never a misread number. "No1" would otherwise come back
   * as "n|01" when the plain key already had it right at "1".
   */
  const joined = canonicalize(repairAdjacent(String(raw)));
  const rejoined = joined !== "" && joined.split("|").length < base.split("|").length;

  const parts = (rejoined ? joined : base).split("|");
  const head = parts[0];

  // Whatever the leading-token repair below decides, the rejoin above stands.
  const adjusted = parts.join("|");

  if (/^[0-9]+$/.test(head)) return adjusted;
  if (isRoman(head)) return adjusted;
  if (head.length > 3) return adjusted;

  const repaired = head
    .split("")
    .map((ch) => DIGIT_LOOKALIKE[ch] ?? ch)
    .join("");

  if (!/^[0-9]+$/.test(repaired)) return adjusted;

  parts[0] = repaired;
  return parts.join("|");
}
