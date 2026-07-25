/* The Payroll card's cost-split sliders always total 100.

   Extracted verbatim from the old delegated input handler (which did the maths
   against live DOM nodes) so the rule is one pure function: drag one slider,
   the others take up the remainder in the proportion they already held, and
   any rounding drift lands on the first of them. buildAdminPatch re-checks the
   total server-side, so this is convenience — but it is the reason a drag can
   never produce a split the action would reject. */

/** New values for every slider after `idx` was dragged to `v`. Always sums 100. */
export function rebalance(vals: readonly number[], idx: number, v: number): number[] {
  const out = vals.map((n) => Math.round(n));
  if (idx < 0 || idx >= out.length) return out;

  const value = Math.round(v);
  const others = out.map((val, i) => ({ i, val })).filter((o) => o.i !== idx);
  out[idx] = value;
  if (others.length === 0) return out;

  const othersTotal = others.reduce((a, o) => a + o.val, 0);
  const remaining = 100 - value;
  // all-zero others can't hold a proportion — share the remainder evenly
  const next = others.map((o) => ({
    i: o.i,
    newVal:
      othersTotal === 0
        ? Math.round(remaining / others.length)
        : Math.round(remaining * (o.val / othersTotal)),
  }));

  const total = value + next.reduce((a, o) => a + o.newVal, 0);
  next[0].newVal += 100 - total;

  for (const o of next) out[o.i] = o.newVal;
  return out;
}

/** Read the three stored percentages out of the cost_split jsonb. */
export function splitFrom(cost: unknown, fallback: [number, number, number] = [34, 33, 33]) {
  const obj = cost && typeof cost === "object" ? (cost as Record<string, unknown>) : null;
  const read = (k: string, dflt: number) => {
    const v = obj ? obj[k] : null;
    return typeof v === "number" ? Math.round(v) : dflt;
  };
  return [
    read("install", fallback[0]),
    read("service", fallback[1]),
    read("admin", fallback[2]),
  ] as [number, number, number];
}
