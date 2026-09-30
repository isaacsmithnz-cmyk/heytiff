/* WHO TO BUY A JOB FROM — a couple of whole-order options, not only the
   lowest line by line.

   Buying the units, the brackets and the trunking from AAD and then going
   to Reece for the pair coil to save a few dollars is a second pickup for
   nothing (Isaac, 2026-09-30). So a job's lines are offered three ways at
   most: every line at its lowest, whoever sells it; and everything from one
   supplier, for each supplier that stocks every line — with what that costs
   over the lowest. Kept simple on purpose: no mixing rules, no thresholds.
   Pure; the Studio's unit browser and the quote's build-up both read it. */

export type BasketOffer = { supplierKey: string; supplierName: string; cents: number };

/** One line of the job: what it is, how many, and who sells it for what. */
export type BasketLine = { key: string; qty: number; offers: BasketOffer[] };

export type BasketOption = {
  /** "lowest", or the one supplier everything comes from */
  kind: "lowest" | "supplier";
  supplierKey: string | null;
  label: string;
  totalCents: number;
  /** over the lowest-each total; 0 for it */
  overCents: number;
  /** each line's supplier under this option */
  picks: Record<string, string>;
};

const MAX_OPTIONS = 3;

export function basketOptions(lines: BasketLine[]): BasketOption[] {
  const priced = lines.filter((l) => l.offers.some((o) => o.cents > 0));
  if (priced.length === 0) return [];

  const lowestOf = (l: BasketLine) =>
    [...l.offers].filter((o) => o.cents > 0).sort((a, b) => a.cents - b.cents)[0]!;
  const lowestPicks: Record<string, string> = {};
  let lowestTotal = 0;
  for (const l of priced) {
    const o = lowestOf(l);
    lowestPicks[l.key] = o.supplierKey;
    lowestTotal += o.cents * l.qty;
  }
  const suppliersUsed = new Set(Object.values(lowestPicks));
  const names = new Map(priced.flatMap((l) => l.offers.map((o) => [o.supplierKey, o.supplierName] as const)));

  const options: BasketOption[] = [
    {
      kind: "lowest",
      supplierKey: suppliersUsed.size === 1 ? [...suppliersUsed][0]! : null,
      label: suppliersUsed.size === 1 ? `All from ${names.get([...suppliersUsed][0]!)}` : "Lowest each",
      totalCents: lowestTotal,
      overCents: 0,
      picks: lowestPicks,
    },
  ];

  /* one supplier for everything, when it stocks every line */
  if (suppliersUsed.size > 1) {
    const singles: BasketOption[] = [];
    for (const [key, name] of names) {
      let total = 0;
      const picks: Record<string, string> = {};
      let covers = true;
      for (const l of priced) {
        const o = l.offers.find((x) => x.supplierKey === key && x.cents > 0);
        if (!o) {
          covers = false;
          break;
        }
        picks[l.key] = key;
        total += o.cents * l.qty;
      }
      if (covers) {
        singles.push({ kind: "supplier", supplierKey: key, label: `All from ${name}`, totalCents: total, overCents: total - lowestTotal, picks });
      }
    }
    singles.sort((a, b) => a.totalCents - b.totalCents);
    options.push(...singles);
  }
  return options.slice(0, MAX_OPTIONS);
}
