import "server-only";

import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { BOOKING_WORDS, BOOKINGS_OPEN_TO_MANAGERS } from "@/lib/integrations/sm8-booking-plan";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import type { MobileCtx } from "./auth";

/* WHO MAY CHANGE THE DAY FROM THE PHONE: Book in's gates
   (actions/booking-sm8), in its order — the deployment books, the person
   may manage the board, an owner while bookings are the owner's
   (BOOKINGS_OPEN_TO_MANAGERS), the workspace offering bookings, and
   ServiceM8's zone known. The Schedule asks it to say whether to offer the
   doors; a change asks it again, with the press its route minted. */

export type ChangeGate = { ok: true; state: Sm8WriteState; zone: string } | { ok: false; error: string; status: number };

export async function changeAllowed(ctx: MobileCtx): Promise<ChangeGate> {
  if (!sm8BookingsAllowed()) return { ok: false, error: BOOKING_WORDS.press.unavailable, status: 409 };
  if (!ctx.caps.has("workboard_manage")) return { ok: false, error: BOOKING_WORDS.press.noManage, status: 403 };
  if (!BOOKINGS_OPEN_TO_MANAGERS && ctx.role !== "owner") return { ok: false, error: BOOKING_WORDS.press.ownerOnly, status: 403 };
  const state = await readSm8WriteState(ctx.orgId);
  if (!offersSend(state, "booking")) {
    return { ok: false, error: sendRefusal(state, "booking") ?? BOOKING_WORDS.press.kindOff, status: 409 };
  }
  const z = await bookingZone(ctx.orgId);
  if (z.zone === null) {
    return { ok: false, error: z.why === "unread" ? BOOKING_WORDS.press.unreadable : BOOKING_WORDS.press.zoneUnknown, status: 409 };
  }
  return { ok: true, state, zone: z.zone };
}
