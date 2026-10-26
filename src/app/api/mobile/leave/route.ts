import { loadLeaveFor } from "@/lib/timepay/leave-page";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* YOUR LEAVE for the phone: your balances (what's booked against them and
   what's left), your requests, and the public holidays from three months back
   to a year on, read by the same loader My leave reads with
   (timepay/leave-page's loadLeaveFor). Your own leave is yours to see, so it
   takes no capability, only a membership, and it is found by the token's own
   user, with no id handed in. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  return ok(await loadLeaveFor({ orgId: ctx.orgId, staffId, today: todayInAu() }));
}
