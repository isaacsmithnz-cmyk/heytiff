import { trunkingLengths, wallBracketCode, type BuildLine, type Visit } from "./buildup";
import { brandOfCode, wrongBrand } from "./brand";
import { rollMetresOf } from "./components";
import type { PriceOf } from "./ducted-template";

/* A WALL SPLIT — the kit every one of Isaac's wall-split quotes carries,
   read off 39 of them in ServiceM8 (Sept 2024 – Sept 2026):

   - the indoor and the outdoor;
   - one adjustable rubber mount under the outdoor (a wall bracket when the
     outdoor goes on the wall);
   - a Voltex 35 A isolator;
   - 7 m of pair coil, per metre off the 20 m roll (10 m when the run is
     known to be longer);
   - 1.5 lengths of Colorbond trunking;
   - "Consumables (Cables, fixings etc.)" — the interconnect cable, fixings
     and tape;
   - labour in person-days: 1.5 up to a 3.5 kW, 2 above, half a day less
     when the outdoor goes straight through the wall behind the indoor
     (back to back, as on 1880). 33 of the 39 jobs sit exactly there; the
     rest were quoted around what was found on site.

   A condensate pump only when the indoor can't drain by gravity. Pure. */

export type SplitFacts = {
  indoor: string;
  outdoor: string;
  kw: number;
  /** liquid + gas, from the pack */
  pipe: "1/4+3/8" | "1/4+1/2" | "1/4+5/8" | "3/8+5/8";
  pipeM?: number | null;
  mount?: "ground" | "wall";
  outdoorWidthMm?: number | null;
  outdoorWeightKg?: number | null;
  trunkingM?: number | null;
  pump?: boolean;
  /** the outdoor straight through the wall behind the indoor */
  backToBack?: boolean;
  /** who the brief says it takes: one installer, or a second pair of hands
      for the lift or the run. Unsaid, it goes by the unit's size. */
  crew?: 1 | 2;
};

/** AAD's 20 m rolls, by liquid + gas. */
export const PAIR_COIL_ROLL: Record<SplitFacts["pipe"], string> = {
  "1/4+3/8": "PC1438",
  "1/4+1/2": "PC1412",
  "1/4+5/8": "PC1458",
  "3/8+5/8": "PC3858",
};

/* What ServiceM8's catalogue pays for the two items no supplier list in the
   price book carries yet. */
export const VOLTEX_35A_CENTS = 1455;
export const CONSUMABLES_CENTS = 3182;

const ASSUME = { pipeM: 7, trunkingM: 3.6 };

export type TemplateResult = { lines: BuildLine[]; missing: string[] };

export function splitLines(f: SplitFacts, priceOf: PriceOf): TemplateResult {
  const lines: BuildLine[] = [];
  const missing: string[] = [];
  const G = { units: "Units", pipe: "Pipe and power", mount: "Mounting, drain, sundries" };
  const brand = brandOfCode(f.indoor);
  const add = (key: string, group: string, code: string, qty: number, kind: "unit" | "material", extra: Partial<BuildLine> = {}) => {
    const p = priceOf(code);
    if (!p) return void missing.push(code);
    const other = wrongBrand(brand, code, p.name);
    if (other) return void missing.push(`${code} is ${other}, this is a ${brand} system`);
    lines.push({ key, group, name: p.name, code, supplierKey: p.supplierKey, qty, unitBuyCents: p.buyCents, kind, ...extra });
  };
  const allowance = (key: string, group: string, name: string, qty: number, unitBuyCents: number, extra: Partial<BuildLine> = {}) =>
    lines.push({ key, group, name, code: null, supplierKey: null, qty, unitBuyCents, kind: "material", ...extra });

  add("indoor", G.units, f.indoor, 1, "unit");
  add("outdoor", G.units, f.outdoor, 1, "unit", { swap: "outdoor" });

  const pipeM = f.pipeM ?? ASSUME.pipeM;
  const roll = PAIR_COIL_ROLL[f.pipe];
  const coil = priceOf(roll);
  if (coil) {
    lines.push({
      key: "pair-coil",
      group: G.pipe,
      name: `Pair coil ${f.pipe}, ${pipeM} m`,
      code: roll,
      supplierKey: coil.supplierKey,
      qty: pipeM,
      unitBuyCents: coil.buyCents / (rollMetresOf(coil.name) ?? 20),
      kind: "material",
      assumed: f.pipeM == null ? `${ASSUME.pipeM} m` : null,
    });
  } else missing.push(roll);
  if (priceOf("WPS135")) add("isolator", G.pipe, "WPS135", 1, "material");
  else allowance("isolator", G.pipe, "Voltex isolator 35 A", 1, VOLTEX_35A_CENTS);

  if (f.mount === "wall") add("bracket", G.mount, wallBracketCode(f.outdoorWidthMm ?? null, f.outdoorWeightKg ?? null), 1, "material", { swap: "mount", because: "chosen by the outdoor's size" });
  else add("mount", G.mount, "CMADJ", 1, "material", { swap: "mount" });
  const lengths = trunkingLengths(f.trunkingM ?? ASSUME.trunkingM);
  if (lengths > 0) add("trunking", G.mount, "1610375-1", lengths, "material");
  if (f.pump) add("pump", G.mount, "MINIAQUA", 1, "material", { because: "the indoor can't drain by gravity" });
  allowance("consumables", G.mount, "Consumables: interconnect cable, fixings, tape", 1, CONSUMABLES_CENTS);

  return { lines, missing };
}

/** Person-days on site, by who the brief says it takes (Isaac, 2026-10-01:
    "if one person can do the installation it will sit about 3600; if two
    it will be higher"). One installer is 1.5 person-days, which puts a
    4.2 kW at $3,697; two are 2, $4,357. Unsaid, a split up to 3.5 kW is a
    one-person job and a bigger one takes two. Half a day less back to back.
    As visits: the installer for the day, and the rest of the time. */
export function splitVisits(f: Pick<SplitFacts, "kw" | "backToBack" | "crew">): Visit[] {
  const crew = f.crew ?? (f.kw <= 3.5 ? 1 : 2);
  const helper = (crew === 1 ? 0.5 : 1) - (f.backToBack ? 0.5 : 0);
  const visits: Visit[] = [{ stage: "Install", people: 1, days: 1 }];
  if (helper > 0) visits.push({ stage: "Install", people: 1, days: helper });
  return visits;
}
