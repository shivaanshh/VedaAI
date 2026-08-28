import { repo } from "../db";
import { buildExams, type Exam } from "@/lib/exam";
import type { AssessmentRecord } from "@/lib/types";

/**
 * Per-question analysis, aggregated server-side.
 *
 * The arithmetic lives in lib/exam.ts, which is pure and tested. This module
 * exists only to decide *which* records to feed it, and to do the reading here
 * rather than in the browser.
 *
 * That last part is the whole reason for the endpoint. The history list carries
 * counts, not questions, so a client-side version of this page would have to
 * pull every full record — pages metadata, transcriptions, regions and all —
 * across the network to add up numbers the server already has on disk. One
 * request that returns the answer beats fifty that return the raw material.
 */

/** Matches the history list's own ceiling, so both views cover the same span. */
const MAX_RUNS = 100;

export async function listExams(): Promise<Exam[]> {
  const db = repo();
  await db.init();

  const summaries = await db.list(MAX_RUNS);

  // Narrow before reading. Only finished, filed runs can contribute, and
  // buildExams would discard the rest anyway — this just avoids loading them.
  const wanted = summaries.filter((s) => s.step === "done" && (s.paper ?? "").trim());

  const records = await Promise.all(wanted.map((s) => db.get(s.id)));

  // A record can vanish between the list and the read if it is deleted
  // mid-request. That is a race, not an error: the run is simply gone, and the
  // remaining ones still add up to a truthful page.
  const present = records.filter((r): r is AssessmentRecord => r !== null);

  return buildExams(present);
}
