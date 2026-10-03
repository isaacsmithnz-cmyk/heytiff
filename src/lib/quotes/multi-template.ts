import { trunkingLengths, wallBracketCode, type BuildLine } from "./buildup";
import { brandOfCode, wrongBrand } from "./brand";
import { rollMetresOf } from "./components";
import type { PriceOf } from "./ducted-template";
import { CONSUMABLES_CENTS, PAIR_COIL_ROLL, VOLTEX_35A_CENTS, type SplitFacts } from "./split-template";

/* A MULTI-SPLIT — one outdoor, a head in each room. The wall-split kit, per
   head: its own pair coil run back to the outdoor (longer than a split's,
   10 m unless known), its own trunking and consumables; the outdoor once,
   with its mount and isolator.

   NO LABOUR HERE (Isaac, 2026-10-04): "a day for the outdoor and half a
   day a head" put #1352 — a PUMY, a branch box and five heads in a heritage
   apartment — at 3.5 person-days when it took 13. Labour is read from the
   brief, or suggested from the business's own jobs (brief-labour,
   labour-history). Pure. */

export type MultiHead = { indoor: string; kw: number; pipe: SplitFacts["pipe"]; pipeM?: number | null; pump?: boolean };

export type MultiFacts = {
  outdoor: string;
  heads: MultiHead[];
  mount?: "ground" | "wall";
  outdoorWidthMm?: number | null;
  outdoorWeightKg?: number | null;
  /** a new circuit from the board: an allowance until the electrician prices it */
  newCircuit?: boolean;
};

const ASSUME = { pipeM: 10, trunkingM: 3.6 };
/* What Isaac charges for a new circuit to the switchboard (3310, 3256). */
export const NEW_CIRCUIT_SELL_CENTS = 70000;

export function multiLines(f: MultiFacts, priceOf: PriceOf, materialMarkupPct = 40): { lines: BuildLine[]; missing: string[] } {
  const lines: BuildLine[] = [];
  const missing: string[] = [];
  /* every head must be the outdoor's own brand */
  const brand = brandOfCode(f.outdoor);
  const add = (key: string, group: string, code: string, qty: number, kind: "unit" | "material", extra: Partial<BuildLine> = {}) => {
    const p = priceOf(code);
    if (!p) return void missing.push(code);
    const other = wrongBrand(brand, code, p.name);
    if (other) return void missing.push(`${code} is ${other}, this is a ${brand} system`);
    lines.push({ key, group, name: p.name, code, supplierKey: p.supplierKey, qty, unitBuyCents: p.buyCents, kind, ...extra });
  };
  const allowance = (key: string, group: string, name: string, qty: number, unitBuyCents: number, extra: Partial<BuildLine> = {}) =>
    lines.push({ key, group, name, code: null, supplierKey: null, qty, unitBuyCents, kind: "material", ...extra });

  add("outdoor", "Units", f.outdoor, 1, "unit", { swap: "outdoor" });
  f.heads.forEach((h, i) => {
    add(`head-${i}`, "Units", h.indoor, 1, "unit");
    const roll = PAIR_COIL_ROLL[h.pipe];
    const coil = priceOf(roll);
    const m = h.pipeM ?? ASSUME.pipeM;
    if (coil)
      lines.push({
        key: `pair-coil-${i}`,
        group: "Pipe and power",
        name: `Pair coil ${h.pipe}, ${m} m to the ${h.kw} kW head`,
        code: roll,
        supplierKey: coil.supplierKey,
        qty: m,
        unitBuyCents: coil.buyCents / (rollMetresOf(coil.name) ?? 20),
        kind: "material",
        assumed: h.pipeM == null ? `${ASSUME.pipeM} m` : null,
      });
    else missing.push(roll);
    if (h.pump) add(`pump-${i}`, "Mounting, drain, sundries", "MINIAQUA", 1, "material");
  });
  const heads = f.heads.length;
  if (priceOf("WPS135")) add("isolator", "Pipe and power", "WPS135", 1, "material");
  else allowance("isolator", "Pipe and power", "Voltex isolator 35 A", 1, VOLTEX_35A_CENTS);
  if (f.newCircuit)
    allowance("circuit", "Pipe and power", "New circuit to the switchboard (electrician)", 1, Math.round(NEW_CIRCUIT_SELL_CENTS / (1 + materialMarkupPct / 100)));
  if (f.mount === "wall") add("bracket", "Mounting, drain, sundries", wallBracketCode(f.outdoorWidthMm ?? null, f.outdoorWeightKg ?? null), 1, "material", { swap: "mount" });
  else add("mount", "Mounting, drain, sundries", "CMADJ", 1, "material", { swap: "mount" });
  add("trunking", "Mounting, drain, sundries", "1610375-1", trunkingLengths(ASSUME.trunkingM) * heads, "material");
  allowance("consumables", "Mounting, drain, sundries", "Consumables: interconnect cable, fixings, tape", heads, CONSUMABLES_CENTS);
  return { lines, missing };
}

