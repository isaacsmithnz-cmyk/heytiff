import type { BuildUp } from "./buildup";

/* THE QUOTE CARD'S SUMS (the chat-first quote page, Isaac, 2026-10-13): the
   card on the right says the total, the three parts it splits into and every
   group's figure, and each set adds up to the total to the cent, or the card
   is telling two stories about one quote.

   The parts: the groups that hold a unit are Units; Labour is the hours sold,
   the duct contingency's hours and a hard job's loading among them; Materials
   is the rest, the contingency's share of the ducts included. The groups, in
   one order whatever order the lines went on in: the five a kit builds, then
   any other in the order it first appears, then the labour, its loading, and
   the duct contingency, its parts and its hours at the business's rate. Pure. */

export type SumRow = { key: string; label: string; cents: number };

/** every figure to the cent, so a column of them reads as one */
export const cents2 = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The groups that hold a unit, added up. */
export const unitsOf = (b: BuildUp) => b.groups.filter((g) => g.lines.some((l) => l.kind === "unit")).reduce((n, g) => n + g.sellCents, 0);

/** Labour as the card counts it: the hours sold, the contingency's among
    them, and a loading on them. */
export const labourOf = (b: BuildUp) => b.labour.sellCents + (b.loading?.sellCents ?? 0);

/** Units, Materials and Labour, which add up to the total ex GST. `hours`:
    the option's labour hours, the contingency's included. */
export function quoteParts(b: BuildUp, hours: number): SumRow[] {
  const units = unitsOf(b);
  const labour = labourOf(b);
  return [
    { key: "units", label: "Units", cents: units },
    { key: "materials", label: "Materials", cents: b.exGstCents - units - labour },
    { key: "labour", label: `Labour, ${Math.round(hours * 100) / 100} h`, cents: labour },
  ];
}

