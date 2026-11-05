import { staffIdFor } from "@/lib/workboard/projects-query";
import { dayExtras } from "@/lib/dashboard/event-mobile";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* TODAY'S EXTRAS for the phone (Isaac, 6 November 2026, "Build" on the
   events mock): the noticeboard's events on the day, with your own answer,
   and the birthdays people chose to share, yours left out. A membership is
   enough: the noticeboard is the whole team's. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const day = new URL(request.url).searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "Ask for a day as YYYY-MM-DD." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  return ok(await dayExtras(ctx.orgId, staffId, day));
}
