import { loadScheduleDay } from "@/lib/workboard/schedule-query";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { changeAllowed } from "@/lib/mobile/schedule-gate";
import { crewNotBooked } from "@/lib/mobile/schedule-crew";

/* ONE DAY OF THE DIARY for the phone's Today and Schedule: everyone's
   bookings on the day, with who's off, as the Schedule tab reads it
   (actions/workboard's scheduleDay), behind the same `workboard` grant. The
   phone narrows it to the viewer with /me's sm8StaffUuid.

   With it, the crew with nothing booked (lib/mobile/schedule-crew): `free`
   and `off`. And `canChange` where this person may change the day's
   bookings from the phone (lib/mobile/schedule-gate, Book in's gates): any
   day, as in ServiceM8 (Isaac, 27 October 2026).

   The day is a CHOICE the phone hands in, so it is held to a bare ISO date
   before it rides into a string comparison. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const day = new URL(request.url).searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "Ask for a day as YYYY-MM-DD." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const [payload, gate] = await Promise.all([loadScheduleDay(ctx.orgId, day, { away: true }), changeAllowed(ctx)]);
  const tenant = async () => (gate.ok ? gate.state : await readSm8WriteState(ctx.orgId)).tenantId;
  const crew = await crewNotBooked(ctx.orgId, payload, tenant);
  return ok({ ...payload, ...crew, ...(gate.ok ? { canChange: true } : {}) });
}
