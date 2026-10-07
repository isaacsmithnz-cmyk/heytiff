import type { BuildLine, Visit } from "./buildup";
import type { Unpriced } from "./job-price";
import type { LineFields } from "./lines";

/* A QUOTE BROUGHT ACROSS TO ITS KEPT LINES (the engine rebuild) — a quote
   Tiff's builder priced, its lines as they're priced today, kept one row
   each so they can be changed by hand from here: every part at its book
   price, each visit as hours at the business's hour, and what couldn't be
   priced as a line not known yet. Nothing is re-picked: what was on the
   quote is what's kept. Pure. */

export type OldOption = { lines: BuildLine[]; visits: Visit[]; unpriced: Unpriced[] };

/** A part bought by the metre: pipe, cable, drain hose. */
const byTheMetre = (l: BuildLine) => /pair-coil/.test(l.key) || /\bcoil\b|\bcable\b|interconnect|\btps\b|drain\s*hose/i.test(l.name);

export function adoptLines(options: OldOption[], dayHours: number, hourCostCents: number | null): Partial<LineFields>[] {
  const out: Partial<LineFields>[] = [];
  options.forEach((o, optionIndex) => {
    for (const l of o.lines) {
      out.push({
        optionIndex,
        system: "",
        group: l.group,
        name: l.name,
        code: l.code,
        supplierKey: l.supplierKey,
        kind: l.kind,
        qty: l.qty,
        unit: byTheMetre(l) ? "m" : "",
        costCents: l.unitBuyCents,
        sellCents: l.unitSellCents ?? null,
        source: l.assumed ? "assumed" : "said",
        why: l.assumed ? `${l.assumed} assumed` : (l.because ?? ""),
        duct: l.duct === true,
      });
    }
    for (const v of o.visits) {
      const hours = Math.round(v.people * v.days * dayHours * 10) / 10;
      if (hours <= 0) continue;
      out.push({
        optionIndex,
        system: "",
        group: "Labour",
        name: v.people > 1 ? `${v.stage}: ${v.people} people` : v.stage,
        kind: "labour",
        qty: hours,
        unit: "h",
        costCents: hourCostCents ?? 0,
        sellCents: v.rateCents ?? null,
        source: "said",
        why: "",
      });
    }
    for (const u of o.unpriced) {
      const n = Number(/(\d+(?:\.\d+)?)/.exec(u.qty)?.[1] ?? NaN);
      out.push({
        optionIndex,
        system: "",
        group: "Still to price",
        name: u.name,
        kind: "material",
        qty: Number.isFinite(n) ? n : 0,
        unit: /\bm\b/.test(u.qty) ? "m" : "",
        costCents: 0,
        source: "unknown",
        why: u.why,
      });
    }
  });
  return out;
}
