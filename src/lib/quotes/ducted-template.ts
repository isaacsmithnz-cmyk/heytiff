import {
  ductTrunks,
  faceVelocity,
  recommendReturn,
  STANDARD_RETURNS,
  trunkingLengths,
  wallBracketCode,
  type BuildLine,
  type ReturnSize,
} from "./buildup";

/* A DUCTED SYSTEM WITHOUT A DRAWING — the lines a brief like "12.5 kW
   Mitsubishi HAA, five zones, bar grilles in the bulkheads, one return in
   the hallway" turns into, priced from the price book.

   Each rule here came from Isaac on a real job (2026-09-30):
   - trunks off the nose cone, BTOs and Ys by AAD code (job 2330);
   - a Red Zone damper (24 V, MDM…L) and a Red Zone cable per zone;
   - the Mitsubishi linear kit from its brochure: interface by zone count,
     one main controller, a receiver for any wireless device, a sensor per
     zone, batteries not included (2 × AAA a sensor);
   - custom linear grilles from Airfoil by length, each with its JH box;
   - the return sized by the unit's airflow at about 2 m/s, the box with the
     unit's two return runs;
   - the wall bracket by the outdoor's size, not only its weight;
   - Colorbond trunking in whole 2.4 m lengths, no fittings;
   - no drip tray — that's the installer's call on site.
   What a person hasn't said is assumed, and each assumption says so. */

export type Priced = { buyCents: number; supplierKey: string; name: string };
/** A code's price to buy: the preferred or lowest supplier's. */
export type PriceOf = (code: string) => Priced | null;

export type DuctedFacts = {
  indoor: string;
  outdoor: string;
  outdoorWidthMm: number | null;
  outdoorWeightKg: number | null;
  threePhase: boolean;
  /** the unit's supply adaptor, e.g. NCMIT100HAA (2 × 350) */
  noseCone: string;
  zones: number;
  zoneMm: number;
  zoning: "me24" | "meLinear" | "none";
  grilles: "stock" | "custom";
  /** custom grilles only: their length band */
  customBand?: "1.5" | "3.0" | "3.0+";
  /** the indoor's airflow, from the data pack */
  airflowLs: number | null;
  /** a return size a person chose over the recommendation */
  returnSize?: ReturnSize | null;
  pipeM: number | null;
  /** the preferred pair coil's code and what one metre of it costs */
  pairCoil: { code: string; perMetreCents: number };
  powerM: number | null;
  interconnectM: number | null;
  trunkingM: number;
};

const ASSUME = { pipeM: 15, powerM: 20, interconnectM: 15 };

const RETURN_GRILLE: Record<string, string> = { "900x400": "ECF9040", "900x450": "NECF9045", "900x500": "ECF9050", "900x550": "NECF9055", "750x550": "NECF7555" };
const RETURN_BOX_2X400: Record<string, string> = { "900x400": "MRA9040-40X2", "900x450": "MRA9045-2X40", "900x500": "MRA9050-40X2", "900x550": "MRA9055-40X2" };
const sizeKey = (r: ReturnSize) => `${r.wMm}x${r.hMm}`;

export type DuctedResult = { lines: BuildLine[]; missing: string[]; returnSize: ReturnSize | null; returnMs: number | null };

export function ductedLines(f: DuctedFacts, priceOf: PriceOf): DuctedResult {
  const lines: BuildLine[] = [];
  const missing: string[] = [];
  const add = (
    key: string,
    group: string,
    code: string,
    qty: number,
    kind: "unit" | "material",
    extra: Partial<BuildLine> = {}
  ) => {
    const p = priceOf(code);
    if (!p) {
      missing.push(code);
      return;
    }
    lines.push({ key, group, name: p.name, code, supplierKey: p.supplierKey, qty, unitBuyCents: p.buyCents, kind, ...extra });
  };
  const allowance = (key: string, group: string, name: string, qty: number, unitBuyCents: number, extra: Partial<BuildLine> = {}) =>
    lines.push({ key, group, name, code: null, supplierKey: null, qty, unitBuyCents, kind: "material", ...extra });

  /* units */
  add("indoor", "Units", f.indoor, 1, "unit");
  add("outdoor", "Units", f.outdoor, 1, "unit", { swap: "outdoor" });

  /* zoning */
  const z = Math.max(0, Math.round(f.zones));
  if (f.zoning === "me24") add("zone-kit", "Zoning", "PAC-ZC80L-E", 1, "material", { swap: "zoning" });
  if (f.zoning === "meLinear") {
    add("zone-kit", "Zoning", z > 4 ? "PAC-ZC10L240C-A" : "PAC-ZC04L240C-A", 1, "material", { swap: "zoning" });
    add("zone-controller", "Zoning", "PAR-ZM01A-A", 1, "material");
    add("zone-receiver", "Zoning", "PAR-ZR01R-A", Math.ceil(z / 10), "material", { because: "any wireless sensor needs the receiver" });
    add("zone-sensors", "Zoning", "PAR-ZR01S-A", z, "material", { because: "a sensor per zone for its own temperature" });
    allowance("zone-batteries", "Zoning", "Batteries, 2 × AAA per sensor (not included)", z, 300);
  }
  if (f.zoning !== "none" && z > 0) {
    add("zone-dampers", "Zoning", `MDM${f.zoneMm}L`, z, "material");
    add("zone-cables", "Zoning", "RZCAB12", z, "material", { because: "a cable per zone, motor to kit" });
  }

  /* supply ductwork: nose cone, trunks, fittings by code, flex */
  const trunks = ductTrunks(z, f.zoneMm);
  add("nose-cone", "Ductwork and grilles", f.noseCone, 1, "material", { duct: true });
  const fittings = new Map<string, number>();
  for (const t of trunks) for (const c of t.fittings) fittings.set(c, (fittings.get(c) ?? 0) + 1);
  for (const [c, n] of fittings) add(`fitting-${c}`, "Ductwork and grilles", c, n, "material", { duct: true });
  const threes = trunks.filter((t) => t.zones === 3).length;
  add("flex-350", "Ductwork and grilles", "VB350", Math.ceil(trunks.length / 2), "material", { duct: true });
  if (threes > 0) add("flex-300", "Ductwork and grilles", "VB300", Math.ceil(threes / 2), "material", { duct: true });
  add(`flex-${f.zoneMm}`, "Ductwork and grilles", `VB${f.zoneMm}`, z, "material", { duct: true, assumed: "6 m per zone" });

  /* grilles */
  if (f.grilles === "stock") {
    add("grilles", "Ductwork and grilles", "BG10514", z, "material", { duct: true, swap: "grilles" });
    add("grille-boxes", "Ductwork and grilles", "CHB10514", z, "material", { duct: true });
  } else {
    const band = f.customBand ?? "1.5";
    add("grilles", "Ductwork and grilles", `AFLBG-${band}`, z, "material", { duct: true, swap: "grilles" });
    add("grille-boxes", "Ductwork and grilles", `JH-LBOX-${band}`, z, "material", { duct: true, because: "a custom grille needs its custom box" });
  }

  /* the return, by airflow */
  const ret = f.returnSize ?? (f.airflowLs ? recommendReturn(f.airflowLs, STANDARD_RETURNS) : { wMm: 900, hMm: 400 });
  if (ret) {
    const k = sizeKey(ret);
    if (RETURN_GRILLE[k]) add("return-grille", "Ductwork and grilles", RETURN_GRILLE[k]!, 1, "material", { duct: true, swap: "return" });
    if (RETURN_BOX_2X400[k]) add("return-box", "Ductwork and grilles", RETURN_BOX_2X400[k]!, 1, "material", { duct: true });
    else allowance("return-box", "Ductwork and grilles", `Return box ${ret.wMm} × ${ret.hMm}, 2 × 400 (JH)`, 1, 7186, { duct: true });
    add("return-flex", "Ductwork and grilles", "VB400", 2, "material", { duct: true });
  }

  /* pipe and power */
  const pipeM = f.pipeM ?? ASSUME.pipeM;
  lines.push({
    key: "pair-coil",
    group: "Pipe and power",
    name: `Pair coil, ${pipeM} m`,
    code: f.pairCoil.code,
    supplierKey: priceOf(f.pairCoil.code)?.supplierKey ?? null,
    qty: pipeM,
    unitBuyCents: f.pairCoil.perMetreCents,
    kind: "material",
    assumed: f.pipeM == null ? `${ASSUME.pipeM} m` : null,
  });
  const powerM = f.powerM ?? ASSUME.powerM;
  const tps = priceOf("CAB6-0TCE");
  if (tps) lines.push({ key: "power", group: "Pipe and power", name: `6 mm² TPS, ${powerM} m`, code: "CAB6-0TCE", supplierKey: tps.supplierKey, qty: powerM, unitBuyCents: tps.buyCents / 100, kind: "material", assumed: f.powerM == null ? `${ASSUME.powerM} m to the board` : null });
  const icM = f.interconnectM ?? ASSUME.interconnectM;
  add("interconnect", "Pipe and power", "2706201-2", icM, "material", { assumed: f.interconnectM == null ? `${ASSUME.interconnectM} m` : null });
  add("isolator", "Pipe and power", f.threePhase ? "3421175-1" : "3209006-1", 1, "material", f.threePhase ? { because: "the outdoor is three phase" } : {});

  /* mounting, drain, sundries */
  add("bracket", "Mounting, drain, sundries", wallBracketCode(f.outdoorWidthMm, f.outdoorWeightKg), 1, "material", { because: "chosen by the outdoor's size" });
  const lengths = trunkingLengths(f.trunkingM);
  if (lengths > 0) add("trunking", "Mounting, drain, sundries", "1610375-1", lengths, "material");
  add("drain", "Mounting, drain, sundries", "8002396-1", 3, "material");
  allowance("sundries", "Mounting, drain, sundries", "Sundries: fixings, brazing, silicone", 1, 10000);

  return { lines, missing, returnSize: ret, returnMs: ret && f.airflowLs ? Math.round(faceVelocity(f.airflowLs, ret) * 10) / 10 : null };
}
