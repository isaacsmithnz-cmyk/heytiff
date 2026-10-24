
/* WHAT A QUOTE KEEPS — its profit against the business's own target (Isaac,
   2026-10-07: "Just have a profit target, if it's over then great, if it's
   under it needs a warning").

   Profit is the price less what the job costs the business: the parts at
   what they're bought for, and the hours at what an hour costs. The
   charge-out rate already carries profit (Isaac: "the 140 rate includes
   profit per hour"), so an hour costs the rate less the target unless the
   business says what it costs.

   It never changes a price or a margin: under the target it says by how
   much, and the price that would meet it. With no target there's nothing to
   check, and with no hour's cost there's no profit to show. Pure. */

export type Profit = {
  /** what the job costs: parts bought plus hours at their cost */
  costCents: number;
  profitCents: number;
  /** profit as a share of the price, percent, one decimal */
  pct: number;
  targetPct: number | null;
  /** what an hour of labour costs, as used */
  hourCostCents: number;
  /** under the target: how far short, and the price that would meet it */
  short: { cents: number; priceCents: number } | null;
};

/** An hour's cost: the business's own figure, else the rate less the target. */
export function hourCostOf(chargeOutCents: number, targetPct: number | null, labourCostCents: number | null): number | null {
  if (labourCostCents != null && labourCostCents > 0) return labourCostCents;
  if (targetPct == null) return null;
  return Math.round(chargeOutCents * (1 - targetPct / 100));
}

/** Profit on a price whose cost is already known (a quote's kept lines carry
    each line's own cost, an hour's included: lines-price.ts). */
export function profitAt(priceCents: number, costCents: number, targetPct: number | null, hourCostCents: number): Profit | null {
  if (priceCents <= 0) return null;
  const profitCents = priceCents - costCents;
  const pct = Math.round((profitCents / priceCents) * 1000) / 10;
  let short: Profit["short"] = null;
  if (targetPct != null && targetPct < 100) {
    const meets = Math.ceil(costCents / (1 - targetPct / 100));
    if (priceCents < meets) short = { cents: meets - priceCents, priceCents: meets };
  }
  return { costCents, profitCents, pct, targetPct, hourCostCents, short };
}
