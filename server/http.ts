import { NextResponse } from "next/server";
import { BadRequestError, NotFoundError } from "./db";

/**
 * One place that turns a thrown error into a response, so every route reports
 * failure the same way and the client only has to understand one shape.
 *
 * Getting the status right matters more than it looks. The client retries some
 * failures and not others, and a teacher reading "500" concludes the app is
 * broken — so a request that was simply malformed, or a key that has run out of
 * free quota, must not arrive dressed as a server fault.
 */

export function ok<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function fail(err: unknown, fallback = "Request failed.") {
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }

  if (err instanceof BadRequestError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const message = (err as Error)?.message || fallback;

  return NextResponse.json({ error: message }, { status: statusFor(message) });
}

/**
 * Failures that reach here as plain Errors, sorted by whose problem they are.
 *
 * Matching on message text is not elegant, but these come from the Gemini
 * client and the image decoder, and threading a typed error through the model
 * layer to satisfy the HTTP layer would put a web concern inside it.
 */
function statusFor(message: string): number {
  // A missing key is the one failure a teacher can actually act on, so it is
  // reported as a configuration problem rather than a generic server error.
  if (/GEMINI_API_KEY/.test(message)) return 503;

  // Free-tier exhaustion is upstream saying "not now", not this app failing.
  // 429 also tells the client it is a wait, not a bug.
  if (/daily request allowance|Too many requests/i.test(message)) return 429;

  if (/^Malformed |arrived empty/i.test(message)) return 400;

  return 500;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
