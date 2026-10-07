import "server-only";
import { can, getDbRole } from "@/lib/permissions-server";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readBookingWriteState } from "@/lib/integrations/sm8-booking-request";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { BOOKINGS_OPEN_TO_MANAGERS } from "@/lib/integrations/sm8-booking-plan";

/* THE CLEAN-UP IN SERVICEM8 (Isaac, 2026-10-07: "They can clean up in
   servicem8 too with an extra button"). An answer on To decide that
   ServiceM8 disagrees with can be written back. The one write HeyTiff has
   for it today is a Quote made a Work Order: the job card's Make it a work
   order (actions/booking-sm8 makeWorkOrder), offered here on exactly the
   card's terms. The deployment writes bookings, the owner's Bookings switch
   is on, and the viewer manages the Workboard and, while bookings are the
   owner's, is the owner. "trial" when sending is a trial run: the press is
   checked and listed, and nothing reaches ServiceM8. Anything else ServiceM8
   should change opens the job in ServiceM8. */

export type WorkOrderOffer = "on" | "trial" | null;

export async function workOrderOffer(orgId: string): Promise<WorkOrderOffer> {
  if (!sm8BookingsAllowed()) return null;
  try {
    const state = await readBookingWriteState(orgId);
    if (!offersSend(state, "booking")) return null;
    if (!(await can("workboard_manage"))) return null;
    if (!BOOKINGS_OPEN_TO_MANAGERS && (await getDbRole()) !== "owner") return null;
    return state.mode === "trial" ? "trial" : "on";
  } catch (err) {
    console.error(`[analytics] couldn't read whether work orders can be made in ServiceM8 for org ${orgId}:`, err);
    return null;
  }
}
