import "server-only";

import { revalidatePath } from "next/cache";
import { staffIdFor } from "@/lib/workboard/projects-query";
import type { MobileCtx } from "./auth";
import type { LeaveActor } from "@/lib/timepay/leave-actions";

/* YOUR LEAVE FROM THE PHONE (Isaac, 27 October 2026: "Yes, build leave on
   the phone as mocked"): ask for it and Undo it on the web's own rules
   (lib/timepay/leave-actions), as the person the token names. */

/** The phone's person, as the leave rules take them; null without a card. */
export async function leaveActor(ctx: MobileCtx): Promise<LeaveActor | null> {
  const staffId = await staffIdFor(ctx.orgId, ctx.userId).catch(() => null);
  return staffId ? { orgId: ctx.orgId, staffId } : null;
}

/** The web's screens that read leave, drawn again after a change from the phone. */
export function refreshLeavePages(): void {
  revalidatePath("/dashboard/my-leave");
  revalidatePath("/dashboard/team");
  // the timesheet derives leave days on read — a change here changes it too
  revalidatePath("/dashboard/my-timesheet");
}
