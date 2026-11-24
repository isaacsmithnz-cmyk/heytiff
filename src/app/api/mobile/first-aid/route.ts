import { ok, requireMobile } from "@/lib/mobile/auth";
import { readFirstAid } from "@/lib/mobile/first-aid";

/* FIRST AID'S "ON TODAY'S JOB", for the phone (lib/mobile/first-aid): the job you're on today or
   going to next, and what its latest SWMS names for an emergency. Your own bookings need no grant
   beyond being a member. The phone asks with `?day=` (its own date) so what it keeps for no signal
   is that day's and never yesterday's; the day itself is the workspace's, worked out here. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  try {
    return ok(await readFirstAid(ctx));
  } catch (err) {
    console.error(`[mobile] first aid for org ${ctx.orgId} wasn't read: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "HeyTiff couldn't read today's job. Try again." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
