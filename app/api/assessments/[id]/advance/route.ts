import { advance } from "@/server/services/job";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/assessments/:id/advance
 *
 * Runs exactly one unit of work and returns the updated record. The client
 * calls it in a loop until the job reports done or failed. Keeping each call
 * short is what keeps the whole run inside the platform's function timeout.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const record = await advance(params.id);
    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Processing failed.");
  }
}
