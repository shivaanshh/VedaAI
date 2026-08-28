import {
  deleteAssessment,
  getAssessment,
  updateDetails,
} from "@/server/services/assessments";
import { fail, ok } from "@/server/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** GET /api/assessments/:id — the whole record, including results so far. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const record = await getAssessment(params.id);
    if (!record) {
      return NextResponse.json({ error: "That assessment no longer exists." }, { status: 404 });
    }
    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Could not load that assessment.");
  }
}

/**
 * PATCH /api/assessments/:id — title, and how the run is filed.
 *
 * Keys absent from the body are left untouched, so a caller that only knows
 * about one field cannot blank the others.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const record = await updateDetails(params.id, {
      ...("title" in body ? { title: body.title } : {}),
      ...("student" in body ? { student: body.student } : {}),
      ...("paper" in body ? { paper: body.paper } : {}),
    });
    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Could not update that assessment.");
  }
}

/** DELETE /api/assessments/:id — record and every stored page. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await deleteAssessment(params.id);
    return ok({ deleted: true });
  } catch (err) {
    return fail(err, "Could not delete that assessment.");
  }
}
