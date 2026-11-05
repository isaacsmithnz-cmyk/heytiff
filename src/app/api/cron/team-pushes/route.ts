import { authorised } from "@/lib/integrations/cron-auth";
import { sendBirthdayPushes, sendEventNudges } from "@/lib/dashboard/event-push";

/* The morning's team pushes: the birthdays people chose to share, and the
   nudge to anyone who hasn't said whether they're coming to an event whose
   answer-by day is two days off (lib/dashboard/event-push).

   LOCKED: it walks every workspace through the service-role client and
   pushes in the app's name. `CRON_SECRET` is the only gate and it fails
   closed when unset (lib/integrations/cron-auth).

   SAFE TO RE-RUN: each push stamps what it sent (birthday_pushed_on,
   event_nudged_at), and the reads skip what is stamped.

   SCHEDULE: 20:00 UTC daily, 07:00 in Sydney under daylight saving, 06:00
   under standard time. It lives in vercel.json, which rejects comments. */

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  const [birthdays, nudges] = await Promise.all([sendBirthdayPushes(), sendEventNudges()]);
  return Response.json({ birthdays, nudges });
}
