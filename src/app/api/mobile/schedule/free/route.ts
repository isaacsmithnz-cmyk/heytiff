import { ok, requireMobile } from "@/lib/mobile/auth";
import { MOST_DAYS, readFreeDays } from "@/lib/mobile/free-days";

/* SOMEONE'S DAYS, FREE AND BOOKED, for the phone's Change the day or time
   (lib/mobile/free-days): from a day, for so many days, with the visit being
   moved left out. Behind the `workboard` grant, as the Schedule's own day
   is: everyone's bookings are on it already.

   Every value is a CHOICE the phone hands in, so each is held to its shape
   before it rides into a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const q = new URL(request.url).searchParams;
  const staff = q.get("staff") ?? "";
  const from = q.get("from") ?? "";
  const skip = q.get("skip");
  const job = q.get("job");
  const days = Number(q.get("days") ?? "10");
  const minutes = Number(q.get("minutes") ?? "");
  if (!UUID.test(staff) || !DAY.test(from) || (skip && !UUID.test(skip)) || (job && !UUID.test(job)) || !Number.isFinite(days) || days < 1 || days > MOST_DAYS) {
    return Response.json({ error: "Ask for someone's days from YYYY-MM-DD." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const answer = await readFreeDays(ctx, {
    staff,
    skip: skip || null,
    job: job || null,
    minutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : null,
    from,
    count: days,
  });
  if (!answer) return Response.json({ error: "Couldn't read the diary. Try again." }, { status: 503, headers: { "cache-control": "no-store" } });
  return ok(answer);
}
