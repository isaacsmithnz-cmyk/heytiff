/* Design Studio — what a ducted unit's air side puts on the job: its
   ductwork and its grilles, named the way the price book's common install
   items name them (quotes/install-groups.ts: "Flexible duct", "Ys and BTOs"
   a size each — a junction not yet picked as either is a "Fitting" of its
   sizes, "Supply plenum", "Return plenum", "Square diffuser", "Return
   air grille", "Return air box"), so a line on the sheet, the picklist and
   what Tiff reads is a part a business already prices. Round diffusers and
   linear bar grilles (outlets.ts) the same way, by their size.

   Lengths are the runs the Studio lays out (ductwork.ts), summed by size;
   before the unit is on a calibrated plan the runs are not measured, and the
   flex says so rather than guessing. Everything else is known from the air
   each room gets (airflow.ts) whether or not the unit is placed. Pure. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import { systemAir } from "./airflow";
import { unitDuctLayout } from "./ductwork";
import { outletName, outletPicks, outletSpec } from "./outlets";

export type DuctShelf = "ductwork" | "grilles";

export interface DuctLine {
  shelf: DuctShelf;
  name: string;
  sub: string;
  /** "5.5 m", "3", or "—" for flex not measured yet */
  qty: string;
}

/** a face the data book prints as a size, so a plenum is made for it */
const faceOf = (o: unknown): { w: number; h: number } | null => {
  if (!o || typeof o !== "object") return null;
  const f = o as { w_mm?: unknown; h_mm?: unknown };
  return typeof f.w_mm === "number" && typeof f.h_mm === "number" ? { w: f.w_mm, h: f.h_mm } : null;
};

const sizes = (mm: number[]): string => {
  const by = new Map<number, number>();
  for (const d of mm) by.set(d, (by.get(d) ?? 0) + 1);
  return [...by]
    .sort(([a], [b]) => b - a)
    .map(([d, n]) => `${n} × Ø${d}`)
    .join(", ");
};

/** the ductwork and grilles one system's ducted units put on the job */
export function ductLines(doc: DesignDocument, pack: DataPack, sys: DesignSystem): DuctLine[] {
  const flex = new Map<number, number>();
  let unmeasured = false;
  const fittings = new Map<string, number>();
  /* by name: "Square diffuser, 250 neck", "Linear grille 1500 × 150" */
  const outlets = new Map<string, { n: number; rank: number; size: number }>();
  const picks = outletPicks(sys);
  const lines: DuctLine[] = [];
  const grilles = new Map<string, { sub: string; n: number }>();
  const grille = (name: string, sub: string) => grilles.set(name, { sub, n: (grilles.get(name)?.n ?? 0) + 1 });
  for (const air of systemAir(doc, pack, sys)) {
    const row = pack.indoor_units.find((u) => u.model === air.model);
    const lay = unitDuctLayout(doc, sys, air);
    if (lay) {
      for (const r of [...lay.supply, ...lay.returns]) flex.set(r.diaMm, (flex.get(r.diaMm) ?? 0) + r.lengthM);
      for (const f of lay.fittings) fittings.set(f.name, (fittings.get(f.name) ?? 0) + 1);
    } else {
      unmeasured = true;
    }
    for (const r of air.rooms) {
      for (let i = 0; i < r.outlets.count; i++) {
        const o = outletSpec(picks[`${air.unit.id}/${r.roomId}/${i}`], r.outlets.lsEach, r.outlets.neckMm, { x: 1, y: 0 });
        const name = outletName(o);
        const rank = ["square", "round", "linear"].indexOf(o.kind);
        const size = o.kind === "linear" ? (o.lengthMm ?? 0) * 1000 + (o.heightMm ?? 0) : o.neckMm;
        outlets.set(name, { n: (outlets.get(name)?.n ?? 0) + 1, rank, size });
      }
    }
    const supply = faceOf(row?.supply_opening);
    if (supply) {
      lines.push({
        shelf: "ductwork",
        /* the size is in the NAME: the picklist sums a part by name, and
           plenums made for two faces are two parts */
        name: `Supply plenum ${supply.w} × ${supply.h}`,
        sub: `Made for ${air.model}${lay ? `, ${sizes(lay.collars.map((c) => c.diaMm))}` : ""}`,
        qty: "1",
      });
    }
    const back = faceOf(row?.return_opening);
    if (back) {
      lines.push({
        shelf: "ductwork",
        name: `Return plenum ${back.w} × ${back.h}`,
        sub: `Made for ${air.model}, ${air.ret.runs} × Ø${air.ret.diaMm}`,
        qty: "1",
      });
    }
    grille(
      `Return air grille ${air.ret.grille.wMm} × ${air.ret.grille.hMm}${air.ret.filter ? ", filter" : ""}`,
      air.ret.filter ? "Filter in the grille" : "The unit's own filter"
    );
    grille("Return air box", "Behind the return grille");
  }
  if (!flex.size && !unmeasured && !grilles.size) return [];
  const flexLines: DuctLine[] = [...flex]
    .sort(([a], [b]) => b - a)
    .map(([d, m]) => ({ shelf: "ductwork", name: `Flexible duct Ø${d}`, sub: "As laid out on the plan", qty: `${Math.ceil(m * 10) / 10} m` }));
  if (unmeasured) {
    flexLines.push({ shelf: "ductwork", name: "Flexible duct", sub: "Place the unit on a scaled plan to measure", qty: "—" });
  }
  const fitLines: DuctLine[] = [...fittings]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => ({
      shelf: "ductwork",
      name,
      sub: name.startsWith("Y ") ? "Y" : name.startsWith("BTO ") ? "Branch take-off" : "Y or BTO",
      qty: String(n),
    }));
  /* square, round, then linear; the biggest of each first */
  const outletLines: DuctLine[] = [...outlets]
    .sort(([, a], [, b]) => a.rank - b.rank || b.size - a.size)
    .map(([name, o]) => ({ shelf: "grilles", name, sub: "Supply outlet", qty: String(o.n) }));
  const grilleLines: DuctLine[] = [...grilles].map(([name, g]) => ({ shelf: "grilles", name, sub: g.sub, qty: String(g.n) }));
  return [...flexLines, ...fitLines, ...lines, ...outletLines, ...grilleLines];
}
