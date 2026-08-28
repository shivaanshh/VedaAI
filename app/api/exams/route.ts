import { listExams } from "@/server/services/exams";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/exams - one row per paper, broken down by question. */
export async function GET() {
  try {
    return ok({ exams: await listExams() });
  } catch (err) {
    return fail(err, "Could not read exam results.");
  }
}
