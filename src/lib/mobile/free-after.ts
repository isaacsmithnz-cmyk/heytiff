import { parseClock, type NormalHours } from "@/components/timepay/logic";

/* FREE AFTER ENDS AT HOME TIME (bug 107, Isaac, 26 November 2026: "Free
   after 3pm is home time. This should be set by standard working hours in
   org"). Someone booked for part of a day is free after their last booking
   only where their normal day (Time & Pay's: their own start and finish, or
   the business's) runs on at least `roomMin` minutes past it. A day booked
   to its finish, or past it, or on into the next day, has no room: they
   aren't free that day, and aren't listed as free. Pure. */

/** When someone is free from, "YYYY-MM-DD HH:MM:SS" (their last booking's
    end), or null where their bookings run to the end of their normal day. */
export function freeAfter(
  dayISO: string,
  spans: readonly { start: string; end: string }[],
  normal: NormalHours,
  roomMin: number
): string | null {
  if (spans.length === 0) return null;
  const last = spans.map((s) => s.end).sort().at(-1)!;
  if (last.slice(0, 10) > dayISO) return null;
  const startMin = parseClock(normal.start);
  const endMin = parseClock(normal.end);
  if (startMin == null || endMin == null) return null;
  const lastMin = Number(last.slice(11, 13)) * 60 + Number(last.slice(14, 16));
  return endMin - Math.max(lastMin, startMin) >= roomMin ? last : null;
}
