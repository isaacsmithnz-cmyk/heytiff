import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { jobHeld, readTrips } from "@/lib/mobile/used";

/* WHAT A JOB HAS USED ACROSS ITS TRIPS (lib/mobile/used): every earlier
   day's list, newest first, with who put things on it, and the job so far,
   each thing added up over the trips (Isaac, 4 November 2026: "How does
   used work across multiple trips", then "That's good" to the mock). The
   list's own tier, `workboard`; quantities only, no prices. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  const id = (await params).id.trim().slice(0, 80);
  if (!id) return no(404, "That job isn't here.");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  if (!(await jobHeld(ctx.orgId, parentRemoteId))) return no(404, "That job isn't here.");
  try {
    return ok(await readTrips(ctx, parentRemoteId));
  } catch (err) {
    console.error(`[mobile] couldn't read the job's trips: ${err instanceof Error ? err.message : String(err)}`);
    return no(500, "Couldn't read what the job has used. Try again.");
  }
}
