/* The Australian financial year — pure.

   1 July to 30 June, which is the only thing on this screen that is not
   negotiable. A year is identified by the year it ENDS in, because that is how
   the ATO names it and how an accountant asks for it: "the 2026 year" means
   1 July 2025 to 30 June 2026. Every other convention here follows from that
   one, so there is a single place to be right.

   No timezone maths. Dates arrive as ISO yyyy-mm-dd from `date` columns — they
   are calendar days, not instants, and turning one into a Date to find out
   which year it belongs to is how a fill at 8pm on 30 June ends up in the
   wrong year on a UTC server. String comparison is exact and needs no clock. */

/** The financial year an ISO date falls in, named by the year it ends in. */
export function fyOf(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 7 ? year + 1 : year;
}

/** The first and last day of a financial year, inclusive, as ISO dates. */
export function fyRange(fy: number): { start: string; end: string } {
  return { start: `${fy - 1}-07-01`, end: `${fy}-06-30` };
}

/** "2025–26", the way it is written on a tax return. En dash, not a hyphen —
    it is a range. */
export function fyLabel(fy: number): string {
  return `${fy - 1}–${String(fy).slice(2)}`;
}

/** True while the given financial year is the one currently running. */
export function fyIsCurrent(fy: number, today: string): boolean {
  return fyOf(today) === fy;
}

/* How many years back the picker offers.

   FIVE, and the number is not arbitrary: the ATO expects records to be kept
   for five years from the date you lodge, which is exactly the window in which
   somebody might have to produce one of these receipts. Offering fewer would
   hide a year that could still be asked about. */
export const FY_HISTORY = 5;

/** The financial years to offer, current first. Years before the workspace
    existed are still listed — an empty year is an answer ("nothing was
    recorded"), and a missing one is a bug the person has to guess at. */
export function fyChoices(today: string, history = FY_HISTORY): number[] {
  const current = fyOf(today);
  return Array.from({ length: history }, (_, i) => current - i);
}

/** How much of a financial year has already happened, as a fraction. Used only
    to say "part-year so far" rather than implying a closed set of books. */
export function fyElapsed(fy: number, today: string): number {
  const { start, end } = fyRange(fy);
  if (today > end) return 1;
  if (today < start) return 0;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  return (day(today) - day(start)) / (day(end) - day(start));
}
