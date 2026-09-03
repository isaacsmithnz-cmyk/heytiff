import { authorised } from "@/lib/integrations/cron-auth";
import { sendReminderDigests } from "@/lib/dashboard/reminder-mail";

/* The morning reminder email.

   WHY IT EXISTS: the bell nudges anyone who is in the app when a reminder's
   time arrives. Nobody is in the app at 6:30 on the day the rego reminder
   falls due, which is the whole reason they asked to be reminded. This is the
   delivery that reaches them anyway — one letter a day, listing what they
   asked to be reminded about today (lib/dashboard/reminder-mail).

   WHY IT IS LOCKED: it walks every workspace's tasks through the service-role
   client and sends mail in the app's name. `CRON_SECRET` is the only gate and
   it fails closed when unset — see lib/integrations/cron-auth.

   WHY IT IS SAFE TO RE-RUN: a reminder is stamped `reminder_emailed_at` when
   its letter leaves, and the read skips stamped rows. A second run in a
   morning sends nothing twice; a run that failed to send stamps nothing. */

/* SCHEDULE: 21:00 UTC daily — 07:00 in Sydney under standard time, 08:00
   under daylight saving, 06:30 in Adelaide, 05:00 in Perth. Before the day's
   work in every Australian zone the app serves. It lives in vercel.json, which
   rejects comments, so the reasoning lives here. */

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    // No detail: an unauthorised caller learns nothing about whether the
    // secret is set, only that they don't have it.
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  /* The letter's links must point at the deployment people actually use —
     APP_BASE_URL first, as the invitation does, and the request's own origin
     when it is unset. */
  const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const result = await sendReminderDigests(baseUrl);
  return Response.json(result);
}
