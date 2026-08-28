import { repo } from "@/server/db";
import { model, quotaStatus } from "@/server/ai/gemini";
import { ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Reports which storage driver is live and whether the model is configured, so
 * the UI can say plainly that history will not survive a restart rather than
 * quietly losing it.
 *
 * The quota block is here for the same reason. "The daily free-tier allowance
 * is gone" is the single most likely cause of a run failing, and a teacher who
 * can read that on the Settings page before uploading is spared discovering it
 * three minutes into a script.
 */
export async function GET() {
  const r = repo();
  const quota = quotaStatus();

  return ok({
    storage: r.name,
    durable: r.durable,
    // Asked of the client rather than re-read from the environment, so the
    // default cannot drift between what health reports and what runs.
    model: model(),
    modelConfigured: Boolean(process.env.GEMINI_API_KEY),
    quotaBlocked: quota.blocked,
    quotaResetsInMs: quota.resetsInMs,
    requestsLastMinute: quota.recentRequests,
  });
}
