import { ok, requireMobile } from "@/lib/mobile/auth";
import { readCrewWeek } from "@/lib/mobile/crew-days";
import { MOST_DAYS } from "@/lib/mobile/free-days";

/* THE CREW'S DAYS, FREE AND BOOKED, for the phone's Book a visit and Change
   the visit (lib/mobile/crew-days): from a day, for so many days, with the
   visit being changed left out. Behind the `workboard` grant, as the
   Schedule's own day is: everyone's bookings are on it already.

   Every value is a CHOICE the phone hands in, so each is held to its shape
   before it rides into a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const q = new URL(request.url).searchParams;
  const from = q.get("from") ?? "";
  const job = q.get("job");
  const skip = (q.get("skip") ?? "").split(",").filter(Boolean);
  const days = Number(q.get("days") ?? "7");
  const minutes = Number(q.get("minutes") ?? "");
  if (!DAY.test(from) || (job && !UUID.test(job)) || skip.length > 20 || skip.some((s) => !UUID.test(s)) || !Number.isFinite(days) || days < 1 || days > MOST_DAYS) {
    return Response.json({ error: "Ask for the crew's days from YYYY-MM-DD." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const answer = await readCrewWeek(ctx, {
    from,
    count: Math.floor(days),
    job: job || null,
    skip,
    minutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : null,
  });
  if (!answer) return Response.json({ error: "Couldn't read the diary. Try again." }, { status: 503, headers: { "cache-control": "no-store" } });
  return ok(answer);
}
