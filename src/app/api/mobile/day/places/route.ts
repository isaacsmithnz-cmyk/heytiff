import { ok, requireMobile } from "@/lib/mobile/auth";
import { placesFor } from "@/lib/mobile/day";

/* THE PLACES YOUR PHONE WATCHES FOR on your day: the office, today's
   bookings, and the open jobs you could pass, each with ServiceM8's own
   geocode where it has one. Never where you are: the phone keeps that. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await placesFor(ctx));
}
