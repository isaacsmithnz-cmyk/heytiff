import { ok, requireMobile } from "@/lib/mobile/auth";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { partsAreIn, readOfficeLists } from "@/lib/mobile/office-lists";

/* THE OFFICE'S LISTS on the phone's Today (lib/mobile/office-lists-plan):
   Ready to invoice, To book, Parts on order, Quotes waiting, from how each
   visit ended. Behind `workboard_manage`, running the board, as they're the
   office's. POST says a job's parts are in. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  return ok({ lists: await readOfficeLists(ctx.orgId) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { job?: unknown; day?: unknown; partsIn?: unknown } | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  const day = typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : "";
  if (!job || !day || body?.partsIn !== true) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const staff = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!(await partsAreIn(ctx.orgId, ctx.userId, staff, job, day))) return Response.json({ error: "That job isn't waiting on parts." }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ lists: await readOfficeLists(ctx.orgId) });
}
