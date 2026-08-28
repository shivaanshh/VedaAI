import { clearReview, saveReview } from "@/server/services/assessments";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * PUT /api/assessments/:id/review — the teacher's correction to one question.
 *
 * Idempotent per question: sending it twice leaves one review, not two, so a
 * double-submitted form or a retried request cannot stack corrections on top of
 * each other. The whole record comes back rather than just the review, because
 * changing a mark changes the totals and the client would otherwise have to
 * recompute them and risk disagreeing with the server.
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const record = await saveReview(params.id, {
      questionId: body.questionId,
      // Spread rather than assigned, so "key absent" stays distinguishable from
      // "key present and null". For the reassignment those mean opposite things:
      // absent leaves the matcher alone, null says nothing answers this.
      ...("awarded" in body ? { awarded: body.awarded } : {}),
      ...("note" in body ? { note: body.note } : {}),
      ...("answerBlockId" in body ? { answerBlockId: body.answerBlockId } : {}),
    });

    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Could not save that change.");
  }
}

/** DELETE /api/assessments/:id/review?questionId=… — hand the question back to the model. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const questionId = new URL(req.url).searchParams.get("questionId") ?? "";
    const record = await clearReview(params.id, questionId);
    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Could not undo that change.");
  }
}
