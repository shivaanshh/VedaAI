import { readPage } from "@/server/services/assessments";
import { badRequest, fail } from "@/server/http";
import { NextResponse } from "next/server";
import type { PageKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; kind: string; index: string } };

/**
 * GET /api/assessments/:id/pages/:kind/:index
 *
 * Serves the exact bytes the browser rendered and uploaded. Nothing re-encodes
 * or resamples them on the way through, which is what lets a percentage-based
 * bounding box computed against the model's view land on the same ink here.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    if (params.kind !== "question" && params.kind !== "answer") {
      return badRequest("kind must be 'question' or 'answer'.");
    }

    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0) {
      return badRequest("index must be a non-negative integer.");
    }

    const page = await readPage(params.id, params.kind as PageKind, index);
    if (!page) {
      return NextResponse.json({ error: "No such page." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(page.bytes), {
      headers: {
        "Content-Type": page.mime,
        "Content-Length": String(page.bytes.length),
        // A stored page is immutable — the id and index together never point at
        // different bytes — so the browser can keep it for as long as it likes.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return fail(err, "Could not read that page.");
  }
}
