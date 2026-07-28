/* Workboard day arithmetic — in the CONNECTED ACCOUNT's timezone.

   Every ServiceM8 timestamp is a naive wall-clock string in the account's
   zone (sm8_vendor.timezone_name), so "today", "overdue" and "next 7 days"
   must be asked on that clock — a Perth account's Monday-morning services
   must not turn overdue while it's still Sunday over there.

   au-dates.ts stays untouched on purpose: its Australia/Sydney anchor is
   load-bearing for timesheets and leave. This helper FALLS BACK to that same
   anchor when no vendor row exists (standalone mode, or first sync pending),
   so the two clocks agree exactly when there's no account to disagree with. */

const FALLBACK_TZ = "Australia/Sydney";

/** Today's date (YYYY-MM-DD) on the given IANA zone's wall clock. An unknown
    or missing zone falls back to the AU anchor rather than throwing — a
    misspelt timezone from upstream must not take the board down. */
export function todayInZone(tz: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || FALLBACK_TZ }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_TZ }).format(now);
  }
}

/** dateISO + n days, calendar-safe (month ends, leap years) — pinned to
    midday UTC so no zone's DST can move the date underneath the add. */
export function plusDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
