import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { dayFor, jobHeld } from "@/lib/mobile/used";
import { readEnding, sayEnding } from "@/lib/mobile/visit-ending";
import { endingOf } from "@/lib/mobile/visit-ending-plan";

/* HOW THE VISIT ENDED (lib/mobile/visit-ending): GET is the answer already
   given for the job that day, the next visit booked and how the job is
   charged; POST says it, and it goes into the first line of the stretch's
   note. The job sheet's own tier, `workboard`, as a note on the job. The job
   is a choice the phone hands in, so it's only ever the caller's own
   workspace's, and one its mirror holds. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

async function jobOf(orgId: string, raw: string): Promise<string | null> {
  const id = raw.trim().slice(0, 80);
  if (!id) return null;
  const { parentRemoteId } = await resolveJobCard(orgId, id);
  return (await jobHeld(orgId, parentRemoteId)) ? parentRemoteId : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = await jobOf(ctx.orgId, (await params).id);
  if (!job) return no(404, "That job isn't here.");
  const day = await dayFor(ctx.orgId, new URL(request.url).searchParams.get("day"));
  if (!day) return no(400, "Which day?");
  return ok(await readEnding(ctx.orgId, job, day));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = await jobOf(ctx.orgId, (await params).id);
  if (!job) return no(404, "That job isn't here.");
  const input = (await request.json().catch(() => null)) as { day?: unknown; line?: unknown; ending?: unknown; sendOn?: unknown } | null;
  const day = await dayFor(ctx.orgId, input?.day);
  if (!day) return no(400, "Which day?");
  const ending = endingOf(input?.ending);
  if (!ending) return no(400, "How did it end?");
  const line = typeof input?.line === "string" ? input.line.trim().slice(0, 300) : "";
  if (!line) return no(400, "Which visit?");
  try {
    return ok(await sayEnding(ctx, job, day, line, ending, input?.sendOn === true));
  } catch (err) {
    return no(400, err instanceof Error ? err.message : "Couldn’t keep that. Try again.");
  }
}
