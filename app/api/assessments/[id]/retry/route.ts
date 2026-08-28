import { retry } from "@/server/services/job";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/assessments/:id/retry
 *
 * Clears a failure and resumes from the step that failed. Everything extracted
 * before the failure is kept.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok({ assessment: await retry(params.id) });
  } catch (err) {
    return fail(err, "Could not resume that run.");
  }
}
