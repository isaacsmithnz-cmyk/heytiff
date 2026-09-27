/* The sending state and the account's zone, ONCE PER REQUEST, for the
   readers that draw bookings (two-way phase 3, PR E review S3) — server
   only.

   A Home load draws bookings in five places: today's day, the next day,
   the list, and the bell's two items. Each asked readSm8WriteState and
   bookingZone for itself, which is the same two rows read up to five times
   over. React cache() makes each one query per server request, the way
   permissions-server reads the membership; outside a request (a cron, a
   test) it is inert and each call reads, as before.

   The write engine is loaded on first use, not at the top: it brings the
   session with it, which a reader that books nothing never needs — and a
   deployment that books nothing never calls either of these. */

import { cache } from "react";
import { bookingZone, type BookingZone } from "./sm8-booking-zone";
import type { Sm8WriteState } from "./sm8-write-plan";

/** readSm8WriteState, once per request. */
export const readBookingWriteState = cache(async (orgId: string): Promise<Sm8WriteState> => {
  const { readSm8WriteState } = await import("./sm8-writes");
  return readSm8WriteState(orgId);
});

/** bookingZone, once per request. */
export const readBookingZone = cache((orgId: string): Promise<BookingZone> => bookingZone(orgId));
