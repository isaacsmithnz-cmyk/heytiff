import { loadLeaveFor } from "@/lib/timepay/leave-page";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { leaveActor, refreshLeavePages } from "@/lib/mobile/leave";
import { requestOwnLeave } from "@/lib/timepay/leave-actions";
import type { LeaveKind } from "@/lib/timepay/leave";

/* YOUR LEAVE for the phone (GET): your balances (what's booked against them and
   what's left), your requests, and the public holidays from three months back
   to a year on, read by the same loader My leave reads with
   (timepay/leave-page's loadLeaveFor). Your own leave is yours to see, so it
   takes no capability, only a membership, and it is found by the token's own
   user, with no id handed in. POST asks for leave, on the web's own rules
   (lib/timepay/leave-actions): your own, and no grant beyond being a member. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  return ok(await loadLeaveFor({ orgId: ctx.orgId, staffId, today: todayInAu() }));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await leaveActor(ctx);
  if (!actor) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await requestOwnLeave(actor, {
    kind: String(b?.kind ?? "") as LeaveKind,
    startDate: String(b?.startDate ?? ""),
    endDate: String(b?.endDate ?? ""),
    hours: Number(b?.hours),
    note: typeof b?.note === "string" ? b.note : undefined,
    certificateDocumentId: typeof b?.certificateDocumentId === "string" ? b.certificateDocumentId : undefined,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400, headers: { "cache-control": "no-store" } });
  refreshLeavePages();
  return ok({ id: r.id });
}
