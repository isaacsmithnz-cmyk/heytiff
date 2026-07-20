/* Values the Team directory and the profile header show but never store —
   derived from the stored card so they can't drift out of sync. */

/** Whole-ish years of service, one decimal. "—" when there's no start date. */
export function yearsSince(startIso: string | null | undefined, now = new Date()): string {
  if (!startIso) return "—";
  const start = new Date(String(startIso).slice(0, 10));
  if (Number.isNaN(start.getTime())) return "—";
  const years = (now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 0) return "—";
  return years.toFixed(1);
}
