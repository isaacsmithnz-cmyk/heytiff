import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { leaveActor, refreshLeavePages } from "@/lib/mobile/leave";
import { cancelOwnLeave } from "@/lib/timepay/leave-actions";

/* ONE OF YOUR LEAVE REQUESTS from the phone: `cancel` withdraws it, on the
   web's own rules (Ask for leave's Undo). Approved leave may be on the
   ServiceM8 board, and comes off it with a press minted from this token
   check; that never fails the cancel, which has landed. */
const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await leaveActor(ctx);
  if (!actor) return no(404, "There's no staff card for you here yet.");
  const body = (await request.json().catch(() => null)) as { do?: unknown } | null;
  if (body?.do !== "cancel") return no(400, "Say cancel.");
  const id = (await params).id.trim().slice(0, 80);
  const r = await cancelOwnLeave(actor, id);
  if (!r.ok) return no(409, r.error);
  refreshLeavePages();
  if (r.wasApproved && sm8LeaveAllowed()) {
    const press = await sm8PressFromMobile(ctx);
    const { queueLeaveOffBoard } = await import("@/app/actions/sm8-leave-queue");
    if (press) await queueLeaveOffBoard(press, { source: "leave", id }).catch(() => null);
  }
  return ok({ cancelled: true });
}
