import { ok, requireMobile } from "@/lib/mobile/auth";
import { leaveActor } from "@/lib/mobile/leave";
import { landSlot } from "@/lib/documents/upload-slots";

/* A MEDICAL CERTIFICATE from the phone, step two: its bytes are in. Only the
   person handed the slot lands it (landSlot); nothing reads it until a
   request of theirs adopts it. */
export async function POST(request: Request, { params }: { params: Promise<{ doc: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await leaveActor(ctx);
  if (!actor) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  const r = await landSlot(actor.orgId, actor.staffId, (await params).doc.trim().slice(0, 80));
  if (!r.ok) return Response.json({ error: r.error }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ landed: true });
}
