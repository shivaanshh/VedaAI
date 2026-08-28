import { storePages } from "@/server/services/assessments";
import { badRequest, fail, ok } from "@/server/http";
import type { PageKind, RenderedPage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/assessments/:id/pages
 *
 * Takes a batch of pages the browser has already rendered. Batched rather than
 * sent whole because serverless request bodies cap at 4.5 MB and base64 inflates
 * an image by about a third.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json()) as { kind?: PageKind; pages?: RenderedPage[] };

    if (body?.kind !== "question" && body?.kind !== "answer") {
      return badRequest("kind must be 'question' or 'answer'.");
    }
    if (!Array.isArray(body.pages) || body.pages.length === 0) {
      return badRequest("No pages were sent.");
    }

    const record = await storePages(params.id, body.kind, body.pages);
    return ok({ assessment: record });
  } catch (err) {
    return fail(err, "Could not store those pages.");
  }
}
