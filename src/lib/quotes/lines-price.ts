import { priceBuildUp, type BuildLine, type BuildSettings, type BuildUp, type Visit } from "./buildup";
import type { LabourFrom, Unpriced } from "./job-price";
import type { QuoteLine } from "./lines";
import { hourCostOf, profitAt, type Profit } from "./profit";

/* A QUOTE PRICED FROM ITS KEPT LINES (slice 2.2) — into the same build-up
   the quote page, the price block, the progress line and the send already
   read, so a switched quote is shown and sent exactly as one priced the old
   way.

   Each option is its own lines. A unit or material line is bought at its
   cost and sold at the sell a person set, else at the business's markup; a
   labour line is its hours, sold at the rate a person set, else the
   charge-out rate; a line nobody knows the price of yet (an unknown with
   nothing in it) is still to price, never a $0 line. Its profit is the
   price less every line's own cost, an hour's at the line's cost or, for
   the duct contingency's hours, the business's hour. Pure. */

export type LinesOption = {
  name: string;
  build: BuildUp;
  unpriced: Unpriced[];
  rows: number;
  labourFrom: LabourFrom;
  profit: Profit | null;
};

/** A line nobody has a price for yet. */
export const stillUnknown = (l: QuoteLine) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null;

const qtyWords = (l: QuoteLine) => (l.qty > 0 ? `${l.qty}${l.unit ? ` ${l.unit}` : ""}` : "");

/** A part line as the build-up reads it. */
export function buildLineOf(l: QuoteLine): BuildLine {
  return {
    key: l.id,
    group: l.group,
    name: l.name,
    code: l.code,
    supplierKey: l.supplierKey,
    qty: l.qty,
    unitBuyCents: l.costCents,
    unitSellCents: l.sellCents,
    kind: l.kind === "unit" ? "unit" : "material",
    assumed: l.source === "assumed" ? l.why || null : null,
    duct: l.duct,
  };
}

/** A labour line's hours as a visit, at its own rate when a person set one. */
export function visitOf(l: QuoteLine, dayHours: number): Visit {
  const v: Visit = { stage: "Install", people: 1, days: dayHours > 0 ? l.qty / dayHours : 0 };
  if (l.sellCents != null) v.rateCents = l.sellCents;
  return v;
}

export function priceLines(
  lines: QuoteLine[],
  names: string[],
  s: BuildSettings,
  target: { pct: number | null; labourCostCents: number | null }
): LinesOption[] {
  const count = Math.max(names.length, ...lines.map((l) => l.optionIndex + 1), 0);
  const hourCost = hourCostOf(s.chargeOutCents, target.pct, target.labourCostCents);
  const out: LinesOption[] = [];
  for (let i = 0; i < count; i++) {
    const mine = lines.filter((l) => l.optionIndex === i);
    const unpriced: Unpriced[] = mine.filter(stillUnknown).map((l) => ({ name: l.name, qty: qtyWords(l), why: l.why || "Not known yet" }));
    const known = mine.filter((l) => !stillUnknown(l));
    const parts = known.filter((l) => l.kind !== "labour");
    const labour = known.filter((l) => l.kind === "labour");
    const build = priceBuildUp(parts.map(buildLineOf), labour.map((l) => visitOf(l, s.dayHours)), s);
    /* every line's own cost: parts at what one costs, an hour at its line's
       cost; the contingency's share at buy and its hours at the business's
       hour, when it has one */
    const contingencyHours = build.contingency?.hours ?? 0;
    const lineCost = known.reduce((n, l) => n + l.costCents * l.qty, 0);
    const profit =
      hourCost == null && contingencyHours > 0
        ? null
        : profitAt(build.exGstCents, Math.round(lineCost + (build.contingency?.buyCents ?? 0) + contingencyHours * (hourCost ?? 0)), target.pct, hourCost ?? 0);
    out.push({
      name: names[i] || `Option ${i + 1}`,
      build,
      unpriced,
      rows: mine.length,
      labourFrom: labour.length > 0 ? "you" : "none",
      profit: target.pct == null && target.labourCostCents == null ? null : profit,
    });
  }
  return out;
}
