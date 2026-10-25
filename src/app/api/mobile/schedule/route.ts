import { loadScheduleDay } from "@/lib/workboard/schedule-query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* ONE DAY OF THE DIARY for the phone's Today and Schedule: everyone's
   bookings on the day, with who's off, as the Schedule tab reads it
   (actions/workboard's scheduleDay), behind the same `workboard` grant. The
   phone narrows it to the viewer with /me's sm8StaffUuid. Read only: no
   write state and no Clear, because the phone offers neither yet.

   The day is a CHOICE the phone hands in, so it is held to a bare ISO date
   before it rides into a string comparison. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const day = new URL(request.url).searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "Ask for a day as YYYY-MM-DD." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return ok(await loadScheduleDay(ctx.orgId, day, { away: true }));
}
