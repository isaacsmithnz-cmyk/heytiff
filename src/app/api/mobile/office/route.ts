import { ok, requireMobile } from "@/lib/mobile/auth";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { moveOn, readOfficeLists } from "@/lib/mobile/office-lists";

/* THE OFFICE'S LISTS on the phone's Today (lib/mobile/office-lists-plan):
   Ready to invoice, To book, Parts on order, Quotes waiting, from how each
   visit ended. Behind `workboard_manage`, running the board, as they're the
   office's. POST moves a job on: its parts are in, or it's been checked. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  return ok({ lists: await readOfficeLists(ctx.orgId) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { job?: unknown; day?: unknown; partsIn?: unknown; checked?: unknown } | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  const day = typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : "";
  const move = body?.partsIn === true ? "partsIn" : body?.checked === true ? "checked" : null;
  if (!job || !day || !move) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const staff = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!(await moveOn(ctx.orgId, ctx.userId, staff, job, day, move)))
    return Response.json({ error: move === "partsIn" ? "That job isn't waiting on parts." : "That job isn't finished." }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ lists: await readOfficeLists(ctx.orgId) });
}
