import { ok, requireMobile } from "@/lib/mobile/auth";
import { readJobTracker } from "@/lib/jobs/job-tracker-server";
import { phoneTracker } from "@/lib/mobile/job-tracker-rings";

/* A JOB'S TRACKER on the phone, at the top of its Money (Isaac, 17 November
   2026: "just put it in the money, and that way it's gated"): the web's
   three rings, labour, materials and equipment against the quote, worked
   out here (lib/mobile/job-tracker-rings) so the phone only draws them.
   The same gate as the job's Money (`workboard_money`); the dollars are at
   cost, so they come only with `financials` too, which the read decides. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard_money");
  if (ctx instanceof Response) return ctx;
  const read = await readJobTracker(ctx.orgId, ctx.caps, (await params).id);
  return read ? ok(phoneTracker(read)) : Response.json({ error: "That job isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });
}
