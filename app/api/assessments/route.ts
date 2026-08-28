import { createAssessment, listAssessments } from "@/server/services/assessments";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assessments — the history list. */
export async function GET(req: Request) {
  try {
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
    const items = await listAssessments(Number.isFinite(limit) ? limit : 50);
    return ok({ items });
  } catch (err) {
    return fail(err, "Could not read history.");
  }
}

/** POST /api/assessments — start a run. Pages are uploaded separately. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const record = await createAssessment({
      title: body?.title,
      student: body?.student,
      paper: body?.paper,
    });
    return ok({ assessment: record }, { status: 201 });
  } catch (err) {
    return fail(err, "Could not start a new assessment.");
  }
}
