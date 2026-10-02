import {
  ductTrunks,
  faceVelocity,
  recommendReturn,
  STANDARD_RETURNS,
  trunkingLengths,
  wallBracketCode,
  type BuildLine,
  type ReturnSize,
  type Visit,
} from "./buildup";
import { rollMetresOf } from "./components";
import { CONSUMABLES_CENTS, PAIR_COIL_ROLL, VOLTEX_35A_CENTS, type SplitFacts } from "./split-template";

/* A DUCTED SYSTEM WITHOUT A DRAWING — the lines a brief like "12.5 kW
   Mitsubishi HAA, five zones, bar grilles in the bulkheads, one return in
   the hallway" turns into, priced from the price book.

   Isaac's own ducted quotes carry one kit (3283, 3372, 1170): two standard
   plenums, each feeding a run of three BTOs (14-14-12, 14-14-10, 14-10-10)
   on 14 and 12 inch flex, a 10 inch bag per outlet, cone diffusers,
   the return box and its filter, a 20 m roll of pair coil, the unit hung
   on timber and threaded rod, a 20 mm PVC drain, one rubber mount, a Voltex
   isolator, two lengths of trunking and the consumables. Labour 4
   person-days.

   Each rule besides came from Isaac on a real job (2026-09-30):
   - trunks off the nose cone instead, BTOs and Ys by AAD code (job 2330);
   - a Red Zone damper (24 V, MDM…L) and a Red Zone cable per zone;
   - the Mitsubishi linear kit from its brochure: interface by zone count,
     one main controller, a receiver for any wireless device, a sensor per
     zone, batteries not included (2 × AAA a sensor);
   - custom linear grilles from Airfoil by length, each with its JH box;
   - the return sized by the unit's airflow at about 2 m/s;
   - the wall bracket by the outdoor's size, not only its weight;
   - Colorbond trunking by the half length, no fittings;
   - no drip tray — that's the installer's call on site.
   What a person hasn't said is assumed, and each assumption says so. */

export type Priced = { buyCents: number; supplierKey: string; name: string };
/** A code's price to buy: the preferred or lowest supplier's. */
export type PriceOf = (code: string) => Priced | null;

/** Whose unit it is, by the indoor's code: Daikin's start with F (FDYAN71,
    FBA71), Mitsubishi's with PE (PEA-M125HAA). Decides the controller. */
export const brandOf = (indoor: string): "daikin" | "mitsubishi" => (/^F[A-Z]/i.test(indoor) ? "daikin" : "mitsubishi");

export type DuctedFacts = {
  indoor: string;
  /** a person's call over the code's guess */
  brand?: "daikin" | "mitsubishi";
  outdoor: string;
  outdoorWidthMm: number | null;
  outdoorWeightKg: number | null;
  threePhase: boolean;
  /** "plenums" (Isaac's standard) or off the unit's nose cone (2330) */
  supply?: "plenums" | "noseCone";
  /** the unit's supply adaptor, e.g. NCMIT100HAA (2 × 350) */
  noseCone?: string;
  zones: number;
  /** supply outlets; one per zone unless a zone has two */
  outlets?: number;
  zoneMm: number;
  zoning: "me24" | "meLinear" | "none";
  grilles: "stock" | "custom" | "cone";
  /** custom grilles only: their length band */
  customBand?: "1.5" | "3.0" | "3.0+";
  /** the indoor's airflow, from the data pack */
  airflowLs: number | null;
  /** a return size a person chose over the recommendation */
  returnSize?: ReturnSize | null;
  pipe?: SplitFacts["pipe"];
  pipeM: number | null;
  /** only when the job runs a new circuit */
  powerM?: number | null;
  /** its cable, by the outdoor's current: 2.5, 4 or 6 mm² (6 unsaid) */
  powerMm2?: 2.5 | 4 | 6;
  /** only when it's more than the consumables cover */
  interconnectM?: number | null;
  mount?: "ground" | "wall";
  /** the indoor hung from the roof on timber and threaded rod */
  hang?: boolean;
  trunkingM?: number | null;
  /** a swap: what stays from the old system; kept pipe is flushed unless
      the scope says it won't be (an R410A line going on to R32) */
  reuse?: { pipe?: boolean; flush?: boolean; ductwork?: boolean; zoneMotors?: boolean };
  /** a swap that still needs new ductwork parts: a new supply plenum
      (2749's double-14), an access panel set and plastered in */
  swapNew?: { plenum?: boolean; accessPanel?: boolean };
  /** who the brief says it takes on the install day; unsaid, the builder
      suggests (see suggestedCrew) and a person confirms */
  crew?: number;
  /** a visit back to finish, in person-days: patching, plaster and paint,
      commissioning. Ducted jobs average about one person-day of it (past
      jobs); 2749 took half a day to set and plaster an access panel. */
  returnDays?: number;
  /** an old system comes out: its refrigerant recovered, the units gone */
  replacing?: boolean;
  /** a new build: the ductwork and pipe roughed in before the ceilings go up */
  newBuild?: boolean;
  /** an existing house on two levels: ductwork run to both */
  storeys?: number;
};

/* A swap (3210, 3282, 3304): kept pipes are flushed ($630 on 2130), kept
   ductwork is reconnected to the new unit's spigots, and the old system's
   refrigerant is recovered and the units taken away ($750 on 1588). */
export const FLUSH_SELL_CENTS = 63000;
export const RECOVERY_SELL_CENTS = 75000;
const RECONNECT_CENTS = 6000;
const POWER_CABLE: Record<2.5 | 4 | 6, string> = { 2.5: "CAB2-5TCE", 4: "CAB4-0TCE", 6: "CAB6-0TCE" };

const ASSUME = { pipeM: 15, trunkingM: 4.8 };
const TIMBER_CENTS = 1834;
const PLENUM_CENTS = 5500;

const RETURN_GRILLE: Record<string, string> = { "900x400": "ECF9040", "900x450": "NECF9045", "900x500": "ECF9050", "900x550": "NECF9055", "750x550": "NECF7555" };
const RETURN_BOX_2X400: Record<string, string> = {
  "900x400": "MRA9040-40X2",
  "900x450": "MRA9045-2X40",
  "900x500": "MRA9050-40X2",
  "900x550": "MRA9055-40X2",
  "750x550": "MRA7555-40X2",
};
const sizeKey = (r: ReturnSize) => `${r.wMm}x${r.hMm}`;

/** A plenum run's BTOs for the outlets it feeds (up to three). */
export function plenumRunFittings(outlets: number, zoneMm = 250): string[] {
  const z = String((({ 150: 6, 200: 8, 250: 10, 300: 12 }) as Record<number, number>)[zoneMm] ?? 10).padStart(2, "0");
  if (outlets >= 3) return ["MB141412", `MB1414${z}`, `MB14${z}${z}`];
  if (outlets === 2) return [`MB1414${z}`, `MB14${z}${z}`];
  return [];
}

export type DuctedResult = { lines: BuildLine[]; missing: string[]; returnSize: ReturnSize | null; returnMs: number | null };

export function ductedLines(f: DuctedFacts, priceOf: PriceOf, materialMarkupPct = 40): DuctedResult {
  const atCost = (sellCents: number) => Math.round(sellCents / (1 + materialMarkupPct / 100));
  const reuse = f.reuse ?? {};
  const lines: BuildLine[] = [];
  const missing: string[] = [];
  const DUCT = "Ductwork and grilles";
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

  /* zoning — or the unit's own controller when there is none */
  const z = Math.max(0, Math.round(f.zones));
  const outlets = Math.max(z, Math.round(f.outlets ?? z));
  if (f.zoning === "me24") add("zone-kit", "Zoning", "PAC-ZC80L-E", 1, "material", { swap: "zoning" });
  if (f.zoning === "meLinear") {
    add("zone-kit", "Zoning", z > 4 ? "PAC-ZC10L240C-A" : "PAC-ZC04L240C-A", 1, "material", { swap: "zoning" });
    add("zone-controller", "Zoning", "PAR-ZM01A-A", 1, "material");
    add("zone-receiver", "Zoning", "PAR-ZR01R-A", Math.ceil(z / 10), "material", { because: "any wireless sensor needs the receiver" });
    add("zone-sensors", "Zoning", "PAR-ZR01S-A", z, "material", { because: "a sensor per zone for its own temperature" });
    allowance("zone-batteries", "Zoning", "Batteries, 2 × AAA per sensor (not included)", z, 300);
  }
  if (f.zoning !== "none" && z > 0 && !reuse.zoneMotors) {
    add("zone-dampers", "Zoning", `MDM${f.zoneMm}L`, z, "material");
    add("zone-cables", "Zoning", "RZCAB12", z, "material", { because: "a cable per zone, motor to kit" });
  }
  const brand = f.brand ?? brandOf(f.indoor);
  if (f.zoning === "none") add("controller", "Zoning", brand === "daikin" ? "BRC1E63" : "PAR-41MAAM", 1, "material", { because: "no zone kit, so the unit's own wall controller" });
  else if (brand === "daikin") missing.push("a zone kit for a Daikin (the zoning kits here are Mitsubishi's)");

  /* supply ductwork, outlets and the return — or the old ductwork kept */
  let ret: ReturnSize | null = null;
  if (reuse.ductwork) {
    allowance("reconnect", DUCT, "Reconnect the existing ductwork: collars, tape, sealant", 1, RECONNECT_CENTS);
    if (f.swapNew?.plenum) allowance("plenum", DUCT, "Supply plenum, new (JH)", 1, PLENUM_CENTS);
    if (f.swapNew?.accessPanel) add("access-panel", DUCT, "JH-ACCESS", 1, "material", { because: "set in and plastered over on the return visit" });
  } else {
    const fittings = new Map<string, number>();
    const bags = new Map<string, number>();
    const bag = (mm: number, n: number) => bags.set(`VB${mm}`, (bags.get(`VB${mm}`) ?? 0) + n);
    if ((f.supply ?? "plenums") === "plenums") {
      const runs = Math.ceil(outlets / 3);
      allowance("plenums", DUCT, "Plenum, standard (JH)", runs, PLENUM_CENTS, { duct: true });
      let left = outlets;
      for (let r = 0; r < runs; r++) {
        const take = Math.ceil(left / (runs - r));
        left -= take;
        for (const c of plenumRunFittings(take, f.zoneMm)) fittings.set(c, (fittings.get(c) ?? 0) + 1);
        bag(350, 1);
        if (take >= 3) bag(300, 1);
      }
    } else {
      if (f.noseCone) add("nose-cone", DUCT, f.noseCone, 1, "material", { duct: true });
      else missing.push("nose cone");
      const trunks = ductTrunks(outlets, f.zoneMm);
      for (const t of trunks) for (const c of t.fittings) fittings.set(c, (fittings.get(c) ?? 0) + 1);
      bag(350, Math.ceil(trunks.length / 2));
      const threes = trunks.filter((t) => t.zones === 3).length;
      if (threes > 0) bag(300, Math.ceil(threes / 2));
    }
    for (const [c, n] of fittings) add(`fitting-${c}`, DUCT, c, n, "material", { duct: true });
    for (const [c, n] of bags) add(`flex-${c}`, DUCT, c, n, "material", { duct: true });
    add(`flex-outlets`, DUCT, `VB${f.zoneMm}`, outlets, "material", { duct: true, assumed: "a 6 m bag per outlet" });

    /* outlets */
    if (f.grilles === "stock") {
      add("grilles", DUCT, "BG10514", outlets, "material", { duct: true, swap: "grilles" });
      add("grille-boxes", DUCT, "CHB10514", outlets, "material", { duct: true });
    } else if (f.grilles === "cone") {
      add("grilles", DUCT, `CD${f.zoneMm}`, outlets, "material", { duct: true, swap: "grilles" });
    } else {
      const band = f.customBand ?? "1.5";
      add("grilles", DUCT, `AFLBG-${band}`, outlets, "material", { duct: true, swap: "grilles" });
      add("grille-boxes", DUCT, `JH-LBOX-${band}`, outlets, "material", { duct: true, because: "a custom grille needs its custom box" });
    }

    /* the return, by airflow */
    ret = f.returnSize ?? (f.airflowLs ? recommendReturn(f.airflowLs, STANDARD_RETURNS) : { wMm: 900, hMm: 400 });
    if (ret) {
      const k = sizeKey(ret);
      if (RETURN_GRILLE[k]) add("return-grille", DUCT, RETURN_GRILLE[k]!, 1, "material", { duct: true, swap: "return" });
      const box = RETURN_BOX_2X400[k];
      if (box && priceOf(box)) add("return-box", DUCT, box, 1, "material", { duct: true });
      else allowance("return-box", DUCT, `Return box ${ret.wMm} × ${ret.hMm}, 2 × 400 (JH)`, 1, 7186, { duct: true });
      add("return-flex", DUCT, "VB400", 2, "material", { duct: true });
    }
  }

  /* pipe and power */
  if (reuse.pipe) {
    if (reuse.flush !== false) allowance("flush", "Pipe and power", "Flush the kept pipework: flushing kit and nitrogen", 1, atCost(FLUSH_SELL_CENTS));
  } else {
    const pipeM = f.pipeM ?? ASSUME.pipeM;
    const roll = PAIR_COIL_ROLL[f.pipe ?? "3/8+5/8"];
    const rollM = rollMetresOf(priceOf(roll)?.name) ?? 20;
    add("pair-coil", "Pipe and power", roll, Math.max(1, Math.ceil(pipeM / rollM - 1e-9)), "material", {
      assumed: f.pipeM == null ? `${ASSUME.pipeM} m, one ${rollM} m roll` : null,
    });
  }
  if (f.replacing) allowance("recovery", "Pipe and power", "Recover the old system's refrigerant, remove and dispose of the old units", 1, atCost(RECOVERY_SELL_CENTS));
  if (f.powerM) {
    const mm2 = f.powerMm2 ?? 6;
    const code = POWER_CABLE[mm2];
    const tps = priceOf(code);
    if (tps) lines.push({ key: "power", group: "Pipe and power", name: `${mm2} mm² TPS, ${f.powerM} m`, code, supplierKey: tps.supplierKey, qty: f.powerM, unitBuyCents: tps.buyCents / (rollMetresOf(tps.name) ?? 100), kind: "material" });
    else missing.push(code);
  }
  if (f.interconnectM) add("interconnect", "Pipe and power", "2706201-2", f.interconnectM, "material");
  if (f.threePhase) add("isolator", "Pipe and power", "3421175-1", 1, "material", { because: "the outdoor is three phase" });
  else if (priceOf("WPS135")) add("isolator", "Pipe and power", "WPS135", 1, "material");
  else allowance("isolator", "Pipe and power", "Voltex isolator 35 A", 1, VOLTEX_35A_CENTS);

  /* mounting, drain, sundries */
  const M = "Mounting, drain, sundries";
  if (f.mount === "wall") add("bracket", M, wallBracketCode(f.outdoorWidthMm, f.outdoorWeightKg), 1, "material", { swap: "mount", because: "chosen by the outdoor's size" });
  else add("mount", M, "CMADJ", 1, "material", { swap: "mount" });
  if (f.hang ?? true) {
    allowance("hang-timber", M, "Timber 90 × 45, 2.7 m", 1, TIMBER_CENTS);
    add("hang-plates", M, "CMP", 4, "material");
    add("hang-rod", M, "TR1003", 1, "material");
  }
  const lengths = trunkingLengths(f.trunkingM ?? (reuse.pipe ? 0 : ASSUME.trunkingM));
  if (lengths > 0) add("trunking", M, "1610375-1", lengths, "material");
  add("drain", M, "PVC20", 4, "material");
  add("drain-90", M, "PVC90E20", 4, "material");
  add("drain-45", M, "PVC45E20", 4, "material");
  allowance("consumables", M, "Consumables: interconnect cable, fixings, tape", 1, CONSUMABLES_CENTS);

  return { lines, missing, returnSize: ret, returnMs: ret && f.airflowLs ? Math.round(faceVelocity(f.airflowLs, ret) * 10) / 10 : null };
}

/** What the builder suggests for the install day: four for a new install
    (Isaac's own figure on 3283 and 3372), three for a swap into the old
    ductwork ("2 x trades + TA", 3210). The brief overrides it — 2749, an
    apartment changeover, took five — and a person confirms. */
export const suggestedCrew = (f: Partial<Pick<DuctedFacts, "reuse">> = {}) => (f.reuse?.ductwork ? 3 : 4);

/** The visits: the install day with the brief's crew (else the suggestion),
    a day more to fit new zone motors into a swap, a rough-in first on a new
    build, and a second pair a day to run the upper floor of a house on two
    levels (2716, 3272: both within 1% with the day, 14% under without it).
    A return visit is added when the job needs one. */
export function ductedVisits(f: Partial<Pick<DuctedFacts, "reuse" | "zoning" | "newBuild" | "storeys" | "crew" | "returnDays">> = {}): Visit[] {
  const swap = !!f.reuse?.ductwork;
  const visits: Visit[] = [];
  if (f.newBuild) visits.push({ stage: "Rough-in", people: 2, days: 1 });
  visits.push({ stage: "Install", people: f.crew && f.crew > 0 ? Math.round(f.crew) : suggestedCrew(f), days: 1 });
  if (swap && f.zoning && f.zoning !== "none" && !f.reuse?.zoneMotors) visits.push({ stage: "Install", people: 1, days: 1 });
  if (!f.newBuild && (f.storeys ?? 1) > 1) visits.push({ stage: "Install", people: 2, days: 1 });
  if (f.returnDays && f.returnDays > 0) visits.push({ stage: "Return", people: 1, days: f.returnDays });
  return visits;
}
