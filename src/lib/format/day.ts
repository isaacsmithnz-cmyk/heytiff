/** A day on a card: "29 Sep 2027".

    Spelled here rather than by the locale tables, because ICU's en-AU says
    "Sept" and the browser's may not — a date that renders differently in a
    test and on a screen is a date nobody can pin a test to.

    Its own module because it is now shared by two features' record modals
    (the fleet's renewal screens and the organisation's credential wall) and a
    pure date formatter has no business living inside either one's derive.

    A ZONED TIMESTAMP IS A MOMENT, NOT A DAY. Callers hand this `created_at`
    and `issued_at` (timestamptz: "2026-10-12T21:30:00+00:00") as well as
    real dates, and the first ten characters of a timestamp are its UTC day —
    yesterday in the yard for anything before about 10am. So a stamp that
    names its zone is read as the AU day it fell on; a bare date, or a naive
    local stamp with no zone, already is its own day. */

import { auDayOf } from "@/lib/au-dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time of day followed by a zone: "Z", "+00:00", "+0000" or "+10". */
const ZONED = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export function fmtDay(iso: string): string {
  const day = (ZONED.test(iso) && auDayOf(iso)) || iso.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}
