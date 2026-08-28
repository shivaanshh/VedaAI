import type { Box } from "@/lib/types";

/**
 * Thin REST client for the Gemini API.
 *
 * Deliberately not the official SDK: the whole surface used here is one POST
 * with a JSON schema attached, and calling it directly removes a dependency
 * that would otherwise need version-pinning against a fast-moving package.
 *
 * Most of what follows is not about calling the API — it is about not calling
 * it more than the free tier allows. That turned out to be the difference
 * between a demo that finishes and one that dies on page two.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * gemini-2.5-flash was the original default and is now refused for new API
 * keys ("no longer available to new users"), so the default moved forward.
 *
 * 3.6-flash was verified against this project's actual requirement rather than
 * assumed: given an image with rectangles at known pixel coordinates, it
 * returns [ymin, xmin, ymax, xmax] normalised to 0-1000 to within 3 parts in
 * 1000. That convention is what convertBox below depends on, and a model that
 * changed it would put every highlight in the wrong place while still looking
 * like it worked.
 *
 * 3.7-flash was tried and rejected for now: it either times out past 60s on an
 * image-plus-schema call or returns "high demand", both of which are fatal for
 * a batch that has to finish inside a serverless request.
 */
export function model(): string {
  return process.env.GEMINI_MODEL || "gemini-3.6-flash";
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add a key from https://aistudio.google.com/apikey"
    );
  }
  return key;
}

export interface InlineImage {
  mimeType: string;
  /** Base64 WITHOUT the data URL prefix. */
  data: string;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export function imagePart(img: InlineImage): Part {
  return { inline_data: { mime_type: img.mimeType, data: img.data } };
}

export function textPart(text: string): Part {
  return { text };
}

/** Strips the `data:image/jpeg;base64,` prefix that the browser produces. */
export function splitDataUrl(dataUrl: string): InlineImage {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Malformed data URL received from the page renderer.");
  return { mimeType: match[1], data: match[2] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Thinking budget
 * ------------------------------------------------------------------ */

/**
 * This model reasons before it answers, and those thinking tokens are billed,
 * counted against the per-minute token quota, and paid for in latency. Asked
 * to reply with the single word "ok" it spent 107 of them.
 *
 * None of the four calls in this app is a reasoning problem — they are reading
 * tasks with a schema attached — so the budget is turned down rather than left
 * at the default. "minimal" removes thinking entirely and was measured at 0
 * tokens; "low" keeps a little, which is what the two vision calls use because
 * locating ink on a page is the one place a moment's deliberation earns its
 * keep. Override with GEMINI_THINKING if a future model disagrees.
 */
export type ThinkingLevel = "minimal" | "low" | "standard";

function thinkingConfig(level: ThinkingLevel): Record<string, unknown> | undefined {
  const resolved = (process.env.GEMINI_THINKING as ThinkingLevel) || level;
  if (resolved === "standard") return undefined;
  return { thinkingLevel: resolved };
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/**
 * Requests per minute the key is allowed. The free tier is the reason this
 * exists; a paid key can raise it and lose the pacing entirely.
 */
const RPM = Math.max(1, Number(process.env.GEMINI_RPM) || 10);
const WINDOW_MS = 60_000;

/**
 * Timestamps of requests actually sent, oldest first, trimmed to the window.
 *
 * A run fires its calls back to back — question batch, answer batch, mapping,
 * grading — with nothing between them, because the client loop advances the
 * moment the previous step returns. On a small paper that is four requests in
 * about a minute and nothing notices. On a twenty-page script it is ten, and
 * the eleventh is a 429 that used to cost five more.
 *
 * So the gate is a rolling window rather than a fixed delay: under the limit
 * it costs nothing at all, and only at the limit does it wait — and then it
 * waits exactly until the oldest request falls out of the window, which is the
 * shortest wait that can possibly succeed.
 */
const sent: number[] = [];

/** Serialises the check, so two callers cannot both see the last free slot. */
let gate: Promise<void> = Promise.resolve();

function reserveSlot(): Promise<void> {
  const run = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= WINDOW_MS) sent.shift();

      if (sent.length < RPM) {
        sent.push(now);
        return;
      }

      await sleep(WINDOW_MS - (now - sent[0]) + 50);
    }
  });

  gate = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ *
 * The daily-quota circuit breaker
 * ------------------------------------------------------------------ */

/**
 * Once the daily allowance is gone it is gone until midnight Pacific, and
 * every request sent in the meantime is a guaranteed 429.
 *
 * Without this, the second run of the day repeats the first one's discovery
 * from scratch: four steps, each one finding out the hard way, each one
 * costing requests that were never going to work. Remembering the answer for
 * the rest of the day turns that into a single instant, accurate error.
 *
 * Process-local on purpose. It is a cache of something the API already knows,
 * so losing it on restart costs one wasted request, not correctness.
 */
let quotaBlockedUntil = 0;

/** Midnight in Pacific time, which is when Google's free-tier day rolls over. */
function nextPacificReset(from = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date(from));

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // formatToParts renders midnight as hour 24 rather than 0 in some ICU builds.
  const elapsed = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");

  return from + (86_400 - elapsed) * 1000;
}

function describeWait(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `about ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** What the health endpoint reports, so the state is visible without a run. */
export function quotaStatus(): { blocked: boolean; resetsInMs: number; recentRequests: number } {
  const now = Date.now();
  while (sent.length && now - sent[0] >= WINDOW_MS) sent.shift();
  return {
    blocked: now < quotaBlockedUntil,
    resetsInMs: Math.max(0, quotaBlockedUntil - now),
    recentRequests: sent.length,
  };
}

/** Test seam, and an escape hatch if a key is topped up mid-session. */
export function clearQuotaBlock(): void {
  quotaBlockedUntil = 0;
}

/* ------------------------------------------------------------------ *
 * Error parsing
 * ------------------------------------------------------------------ */

interface Fault {
  status: number;
  /** Written for a teacher, not for a log. */
  message: string;
  /** Which allowance ran out, when the API says. */
  scope: "day" | "minute" | "other";
  /** Google's own instruction, in ms, when it sends one. */
  retryAfterMs: number | null;
  retryable: boolean;
}

function parseFault(status: number, body: string): Fault {
  let parsed: {
    error?: { message?: string; details?: Array<Record<string, unknown>> };
  } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* A gateway can return HTML; fall through to the raw text. */
  }

  const detail = parsed?.error?.message || body.slice(0, 400) || `HTTP ${status}`;
  const details = parsed?.error?.details ?? [];

  const typed = (suffix: string) =>
    details.find((d) => String(d["@type"] ?? "").endsWith(suffix)) as
      | Record<string, unknown>
      | undefined;

  // "29s", "1.5s" — seconds with a trailing s, per google.rpc.RetryInfo.
  const raw = String((typed("RetryInfo")?.retryDelay as string) ?? "");
  const secs = Number(/^([\d.]+)s$/.exec(raw)?.[1]);
  const retryAfterMs = Number.isFinite(secs) ? secs * 1000 : null;

  const violations = (typed("QuotaFailure")?.violations ?? []) as Array<Record<string, string>>;
  const ids = violations.map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`).join(" ");

  const scope: Fault["scope"] = /PerDay/i.test(ids)
    ? "day"
    : /PerMinute/i.test(ids)
      ? "minute"
      : "other";

  if (status === 429) {
    if (scope === "day") {
      const wait = nextPacificReset() - Date.now();
      return {
        status,
        scope,
        retryAfterMs,
        retryable: false,
        message:
          `The free tier's daily request allowance for ${model()} is used up. ` +
          `It resets at midnight Pacific time, ${describeWait(wait)} from now. ` +
          "Everything read before this point is saved — press Retry after the reset and " +
          "the run picks up from the step it stopped on.",
      };
    }

    const wait = retryAfterMs ?? 30_000;
    return {
      status,
      scope,
      retryAfterMs,
      retryable: true,
      message:
        `Too many requests to ${model()} in the last minute. ` +
        `The free tier allows ${RPM} — waiting ${Math.ceil(wait / 1000)}s and trying again.`,
    };
  }

  return {
    status,
    scope,
    retryAfterMs,
    retryable: RETRYABLE.has(status),
    message: `Gemini returned ${status}. ${detail.slice(0, 600)}`,
  };
}

const RETRYABLE = new Set([500, 502, 503, 504]);

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

/**
 * Headroom for a full batch of dense pages.
 *
 * The model reasons before it answers and those thinking tokens draw on the
 * same budget, so the cap has to cover both the reasoning and three pages of
 * transcribed handwriting. 8192 covered the answer alone and left the reasoning
 * to eat into it.
 */
const MAX_OUTPUT_TOKENS = 32768;

/**
 * How long the retries of a single call may take in total.
 *
 * The route this runs inside is capped at 60 seconds by the platform, and a
 * batch of three dense pages spends twenty-odd of them in the model. Retrying
 * past this point does not rescue the call — the function is killed mid-wait
 * and the attempt is lost along with the request it spent.
 */
const RETRY_BUDGET_MS = 25_000;

/**
 * Calls the model and returns parsed JSON.
 *
 * The retry policy is deliberately asymmetric, because the failures are not
 * alike. A 503 is the server having a bad second and is worth several quick
 * attempts. A per-minute rate limit is worth exactly one attempt, after the
 * wait the API itself specified. A daily quota is worth none at all: it cannot
 * clear before midnight, and the four extra requests the old code spent
 * discovering that were four requests that would have been available tomorrow.
 */
export async function generateJSON<T>(opts: {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
  /** Lower is more literal. Extraction wants 0; feedback wants a little room. */
  temperature?: number;
  maxRetries?: number;
  thinking?: ThinkingLevel;
}): Promise<T> {
  const { system, parts, schema, temperature = 0, maxRetries = 3, thinking = "low" } = opts;

  // Resolved before the retry loop on purpose. A missing key is a configuration
  // mistake, not a transient fault — retrying it five times with backoff would
  // turn an instant, obvious error into a twelve-second mystery.
  const key = apiKey();

  if (Date.now() < quotaBlockedUntil) {
    throw new Error(
      `The free tier's daily request allowance for ${model()} is used up. It resets at ` +
        `midnight Pacific time, ${describeWait(quotaBlockedUntil - Date.now())} from now. ` +
        "Everything read before this point is saved — press Retry after the reset."
    );
  }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(thinkingConfig(thinking) ? { thinkingConfig: thinkingConfig(thinking) } : {}),
    },
  };

  const deadline = Date.now() + RETRY_BUDGET_MS;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await reserveSlot();

    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}/${model()}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = `Network error contacting Gemini: ${(err as Error).message}`;
      if (!(await backoff(attempt, deadline, null))) break;
      continue;
    }

    if (!res.ok) {
      const fault = parseFault(res.status, await res.text().catch(() => ""));
      lastError = fault.message;

      // A daily quota is remembered so the rest of the run — and the rest of
      // the day — fails instantly instead of rediscovering it four more times.
      if (fault.status === 429 && fault.scope === "day") {
        quotaBlockedUntil = nextPacificReset();
      }

      if (!fault.retryable) throw new Error(fault.message);
      if (!(await backoff(attempt, deadline, fault.retryAfterMs))) break;
      continue;
    }

    const payload = await res.json();
    const candidate = payload?.candidates?.[0];
    const reason: string = candidate?.finishReason ?? "unknown";

    // Every text part, not just the first. These are reasoning models: the
    // answer can arrive split across parts, or behind a thinking part that
    // carries no text of its own. Reading parts[0] blindly turns either case
    // into five retries and a dead run.
    const text: string = (candidate?.content?.parts ?? [])
      .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === "string")
      .map((p: { text: string }) => p.text)
      .join("");

    // Truncation is deterministic: the same prompt will truncate again, so
    // retrying spends three more model calls to arrive back here. Fail on it
    // immediately, and say the thing that would actually fix it.
    if (reason === "MAX_TOKENS") {
      throw new Error(
        `Gemini hit the ${MAX_OUTPUT_TOKENS}-token output cap before finishing. ` +
          "The page is denser than one response can hold — split the document or lower PAGE_BATCH."
      );
    }

    if (!text) {
      lastError = `Gemini returned no content (finishReason: ${reason}).`;
      if (!(await backoff(attempt, deadline, null))) break;
      continue;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Schema-constrained output is nearly always clean, but a truncated
      // response can arrive as a fragment. Retrying is cheaper than repairing.
      lastError = "Gemini returned malformed JSON.";
      if (!(await backoff(attempt, deadline, null))) break;
      continue;
    }
  }

  throw new Error(lastError || "Gemini could not be reached.");
}

/**
 * Waits before the next attempt, and reports whether there is any point.
 *
 * Returns false when the budget for this call is spent, which stops the loop
 * rather than sending a request the surrounding function will not live long
 * enough to read.
 */
async function backoff(
  attempt: number,
  deadline: number,
  advised: number | null
): Promise<boolean> {
  // Google's own retryDelay when it sent one; otherwise 1s, 2s, 4s with jitter
  // so two runs that trip the same limit do not come back in lockstep.
  const wait = advised ?? 1000 * 2 ** attempt + Math.random() * 400;

  if (Date.now() + wait > deadline) return false;

  await sleep(wait);
  return true;
}

/**
 * Gemini reports boxes as [ymin, xmin, ymax, xmax] normalised to 0–1000.
 * The UI wants percentages with an origin at top-left, so divide by ten and
 * reorder. Values are clamped because a model occasionally overshoots the
 * page edge by a pixel or two and an unclamped box would sit outside the
 * image container.
 */
export function toBox(raw: number[] | undefined | null): Box | null {
  if (!raw || raw.length !== 4) return null;

  const [ymin, xmin, ymax, xmax] = raw;
  const clamp = (n: number) => Math.min(100, Math.max(0, n / 10));

  const x = clamp(xmin);
  const y = clamp(ymin);
  const w = clamp(xmax) - x;
  const h = clamp(ymax) - y;

  // A zero-area box is a failed detection, not a highlight worth drawing.
  if (w <= 0.2 || h <= 0.2) return null;

  return { x, y, w, h };
}

/**
 * Grows a box slightly so the highlight breathes around the ink.
 *
 * Wider than it is tall, and not for looks. The model's boxes are consistently
 * a shade narrow on the right — enough to slice the last word off a full line,
 * which reads as a mistake even though the block itself is correct. Vertical
 * padding cannot be raised to match: consecutive answers sit two or three
 * percent apart, so a tall pad would have neighbouring highlights touching.
 */
export function padBox(box: Box, padX = 1.5, padY = 0.8): Box {
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    x,
    y,
    w: Math.min(100 - x, box.w + padX * 2),
    h: Math.min(100 - y, box.h + padY * 2),
  };
}
