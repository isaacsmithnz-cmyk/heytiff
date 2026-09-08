/** A day on a card: "29 Sep 2027".

    Spelled here rather than by the locale tables, because ICU's en-AU says
    "Sept" and the browser's may not — a date that renders differently in a
    test and on a screen is a date nobody can pin a test to.

    Its own module because it is now shared by two features' record modals
    (the fleet's renewal screens and the organisation's credential wall) and a
    pure date formatter has no business living inside either one's derive. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}
