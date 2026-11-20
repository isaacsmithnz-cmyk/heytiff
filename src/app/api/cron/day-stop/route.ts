import { authorised } from "@/lib/integrations/cron-auth";
import { stopOverdueDays } from "@/lib/mobile/day";

/* THE CLOCK STOPS ITSELF, FOR A PHONE THAT CAN'T (Isaac, 20 November 2026:
   "It should automatically stop the clock if no other method has worked").
   Every day still on past its stop (fourteen hours after Clock on, the
   team's setting, or later while Still here holds it) stops at the last
   thing seen, as the phone's own read would stop it (lib/mobile/day-stop).
   Nothing is sent from here: there's no press, so the person's phone sends
   the day on to ServiceM8 and the timesheet the next time it asks.

   LOCKED by CRON_SECRET, failing closed (lib/integrations/cron-auth).
   SAFE TO RE-RUN: a stopped day isn't on any more, so it isn't read again.

   SCHEDULE: every 15 minutes from the database (pg_cron with pg_net, as
   the sm8-drain heartbeat, docs/plans/queues.md), and once a day from
   vercel.json at 19:00 UTC, before the morning, in case the database's
   call has no secret. */

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  return Response.json({ stopped: await stopOverdueDays() });
}
