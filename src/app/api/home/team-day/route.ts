import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { nowMinInZone } from "@/lib/dashboard/day-rail";
import { teamDayFor } from "@/lib/dashboard/team-day-query";
import { plusDays, todayInZone } from "@/lib/workboard/dates";
import { sm8VendorOf } from "@/lib/workboard/query";
import { loadScheduleDay } from "@/lib/workboard/schedule-query";

/* A DAY OF HOME'S SCHEDULE (lib/dashboard/team-day): the team's jobs on a
   day the strip along the top names, for whoever may see the crew's
   bookings (`workboard`), as the Schedule tab is. Home brings today with
   the page; the days after come from here when they're pressed. The day is
   a choice the browser hands in, so it is held to a bare date within the
   next fortnight. */
export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const day = new URL(req.url).searchParams.get("day") ?? "";
  const vendor = await sm8VendorOf(orgId);
  const today = todayInZone(vendor.tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today || day > plusDays(today, 14))
    return Response.json({ error: "Ask for a day in the next fortnight, as YYYY-MM-DD." }, { status: 400 });
  const [payload, staffId, links] = await Promise.all([
    loadScheduleDay(orgId, day, { away: true }),
    staffProfileIdFor(orgId, userId),
    sm8StaffLinkMap(orgId).catch(() => new Map<string, string>()),
  ]);
  const mine = staffId ? ([...links.entries()].find(([, s]) => s === staffId)?.[0] ?? null) : null;
  const team = await teamDayFor(orgId, payload, {
    dayISO: day,
    today: day === today,
    nowMin: day === today ? nowMinInZone(vendor.tz) : null,
    mine,
  });
  return Response.json(team, { headers: { "cache-control": "no-store" } });
}
