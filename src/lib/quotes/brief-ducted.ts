import type { DataPack } from "@/lib/studio/packs/schema";
import type { SizedRoom } from "./brief-rooms";
import { KIT, RUN_TO_ASK, WHERE_TO_ASK, type OutdoorAt } from "./brief-rooms";

/* A DUCTED SYSTEM READ FROM THE BRIEF (Isaac, 2026-10-04: "The brief will
   decide all of this. If I say we will connect all 3 outlets straight to
   the plenum or if I say we will have a single 14 off the front and split
   to 14/10/10/10"; "maybe 4 or 5 grilles, 3 mdo, 1 round and a 3m flangeless
   bar grille @ 150mm high"; zoning).

   One system serves the rooms: the pack's ducted pair that covers their
   loads together. Everything else is the brief's, read literally and kept
   only when its words are the brief's and hold its numbers: the outlets by
   type, count and size; the returns; the ductwork, piece by piece, as
   written; the zoning. What the brief doesn't say is asked — never a layout,
   a size or a count of ours. Each part is priced from the business's own
   items, and a part that comes in sizes waits for its range in the price
   book. Pure. */

export type OutletType = "mdo" | "round" | "square" | "bar" | "slot" | "diffuser";

export type DuctedOutlet = {
  room: string;
  count: number;
  type: OutletType | null;
  /** a diffuser's neck, mm, and the words that give it (they can be
      another sentence: "each room will have a 10 inch supply") */
  neckMm: number | null;
  neckSaid?: string | null;
  /** a bar or slot grille's length and height, mm */
  lengthMm: number | null;
  heightMm: number | null;
  flangeless: boolean;
  said: string;
};

export type DuctedReturn = { room: string; common: boolean; neckMm: number | null; widthMm: number | null; heightMm: number | null; said: string };

/** A piece of ductwork as the brief writes it: a plenum with its spigots, a
    trunk off the unit, a fitting splitting one size into others. */
export type DuctPiece = { piece: "plenum" | "trunk" | "fitting"; inMm: number | null; outsMm: number[]; count: number; said: string };

export type DuctedZoning = {
  zones: number | null;
  control: "temperature" | "on_off" | null;
  /** the controller as the brief names it ("ME zone controller", "AirTouch 5") */
  controller: string | null;
  sensors: { room: string; wireless: boolean }[];
  commonZone: string | null;
  wifi: boolean | null;
  said: string;
};

export type DuctedRead = {
  ducted: boolean;
  unitAt: "roof" | "underfloor" | "bulkhead" | null;
  unitSaid: string | null;
  outlets: DuctedOutlet[];
  /** "maybe 4 or 5 grilles": a count the brief isn't sure of */
  outletsUnsure: { min: number; max: number; said: string } | null;
  returns: DuctedReturn[];
  layout: DuctPiece[];
  zoning: DuctedZoning | null;
  /** the system's run, outdoor, drain and circuit, as the brief says them */
  run: { m: number | null; said: string | null };
  outdoor: { at: OutdoorAt | null; said: string | null };
  drain: { how: "gravity" | "pump" | null; said: string | null };
  circuit: { needed: boolean | null; said: string | null };
};

const norm = (s: string) => s.toLowerCase().replace(/[²]/g, "2").replace(/\s+/g, " ").trim();
const numberIn = (text: string, n: number) =>
  new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}(\\.0+)?(?![\\d])`).test(text);
/* inches as the trade says them ("a 14", "10 inch") are read as mm by Tiff:
   250 for 10, 350 for 14. The words hold the inches. */
const INCH_MM: Record<number, number> = { 6: 150, 8: 200, 10: 250, 12: 300, 14: 350, 16: 400, 18: 450 };
const sizeIn = (text: string, mm: number) =>
  numberIn(text, mm) || Object.entries(INCH_MM).some(([inch, m]) => m === mm && numberIn(text, Number(inch)));

/** Keep what the brief's words hold: a piece whose words aren't the
    brief's is dropped and named; a size its words don't hold is cleared,
    to ask. */
export function checkDucted(read: DuctedRead, brief: string): { read: DuctedRead; dropped: string[] } {
  const text = norm(brief);
  const inBrief = (w: string | null) => !!w && norm(w).length >= 3 && text.includes(norm(w));
  const dropped: string[] = [];
  const size = (said: string, mm: number | null) => (mm != null && mm > 0 && sizeIn(norm(said), mm) ? mm : null);
  const outlets = read.outlets.filter((o) => (inBrief(o.said) ? true : (dropped.push(`outlets "${o.said}"`), false)))
    .map((o) => ({
      ...o,
      count: o.count > 0 && numberIn(norm(o.said), o.count) ? o.count : o.count === 1 ? 1 : 0,
      neckMm: o.neckSaid && inBrief(o.neckSaid) ? size(o.neckSaid, o.neckMm) : size(o.said, o.neckMm),
      lengthMm: o.lengthMm != null && (numberIn(norm(o.said), o.lengthMm) || numberIn(norm(o.said), o.lengthMm / 1000)) ? o.lengthMm : null,
      heightMm: size(o.said, o.heightMm),
    }));
  const returns = read.returns.filter((r) => (inBrief(r.said) ? true : (dropped.push(`return "${r.said}"`), false)))
    .map((r) => ({ ...r, neckMm: size(r.said, r.neckMm), widthMm: size(r.said, r.widthMm), heightMm: size(r.said, r.heightMm) }));
  const layout = read.layout.filter((p) => (inBrief(p.said) ? true : (dropped.push(`ductwork "${p.said}"`), false)))
    .map((p) => ({ ...p, inMm: size(p.said, p.inMm), outsMm: p.outsMm.filter((m) => sizeIn(norm(p.said), m)) }));
  const unsure = read.outletsUnsure && inBrief(read.outletsUnsure.said) ? read.outletsUnsure : null;
  const zoning = read.zoning && inBrief(read.zoning.said) ? read.zoning : null;
  const runOk = read.run.m != null && read.run.m <= 100 && inBrief(read.run.said) && numberIn(norm(read.run.said!), read.run.m);
  return {
    read: {
      ...read,
      run: runOk ? read.run : { m: null, said: null },
      outdoor: inBrief(read.outdoor.said) ? read.outdoor : { at: null, said: null },
      drain: inBrief(read.drain.said) ? read.drain : { how: null, said: null },
      circuit: inBrief(read.circuit.said) ? read.circuit : { needed: null, said: null },
      unitAt: inBrief(read.unitSaid) ? read.unitAt : null,
      outlets,
      outletsUnsure: unsure,
      returns,
      layout,
      zoning: zoning && { ...zoning, zones: zoning.zones != null && numberIn(norm(zoning.said), zoning.zones) ? zoning.zones : null },
    },
    dropped,
  };
}

export type DuctedPair = { indoor: string; outdoor: string; coolKw: number; heatKw: number; airflowLs: number | null; liquidMm: number; gasMm: number; outdoorWidthMm: number | null; outdoorWeightKg: number | null; outdoorAmps: number | null };

/** The pack's ducted pairs that cover the rooms' loads together, cooling
    and heating, at the smallest size that does, one per series. */
export function sizeDucted(rooms: readonly Pick<SizedRoom, "loadKw">[], pack: Pick<DataPack, "indoor_units" | "outdoor_units" | "pair_tables">, limit = 4): { loadKw: number; options: DuctedPair[] } {
  const loadKw = Math.round(rooms.reduce((n, r) => n + r.loadKw, 0) * 10) / 10;
  const idu = new Map(pack.indoor_units.map((u) => [u.model, u]));
  const odu = new Map(pack.outdoor_units.map((u) => [u.model, u]));
  const covering = pack.pair_tables
    .filter((p) => idu.get(p.idu_model)?.form_factor === "ducted" && p.rated_cool_kw != null && p.rated_heat_kw != null)
    .filter((p) => Math.min(p.rated_cool_kw!, p.rated_heat_kw!) >= loadKw)
    .sort((a, b) => a.rated_cool_kw! - b.rated_cool_kw! || a.idu_model.localeCompare(b.idu_model) || a.odu_model.localeCompare(b.odu_model));
  const smallest = covering[0]?.rated_cool_kw;
  return {
    loadKw,
    options: covering
      .filter((p) => p.rated_cool_kw === smallest)
      .slice(0, limit)
      .map((p) => ({
        indoor: p.idu_model,
        outdoor: p.odu_model,
        coolKw: p.rated_cool_kw!,
        heatKw: p.rated_heat_kw!,
        airflowLs: idu.get(p.idu_model)?.airflow_ls ?? null,
        liquidMm: p.pipe_liquid_mm,
        gasMm: p.pipe_gas_mm,
        outdoorWidthMm: odu.get(p.odu_model)?.width_mm ?? null,
        outdoorWeightKg: odu.get(p.odu_model)?.weight_kg ?? null,
        outdoorAmps: odu.get(p.odu_model)?.max_amps_a ?? null,
      })),
  };
}

const OUTLET_WORDS: Record<OutletType, string> = {
  mdo: "MDO",
  round: "Round diffuser",
  square: "Square diffuser",
  bar: "Bar grille",
  slot: "Slot diffuser",
  diffuser: "Supply outlet",
};

/** One outlet line's name: its type and the size the brief gave. */
export function outletName(o: DuctedOutlet): string {
  const kind = o.type ? OUTLET_WORDS[o.type] : "Supply outlet";
  if (o.type === "bar" || o.type === "slot") {
    const dims = o.lengthMm && o.heightMm ? ` ${o.lengthMm} × ${o.heightMm}` : o.lengthMm ? ` ${o.lengthMm} long` : "";
    return `${kind}${dims}${o.flangeless ? ", flangeless" : ""}`;
  }
  return `${kind}${o.neckMm ? `, Ø${o.neckMm} neck` : ""}`;
}

export const DUCT_ASK = {
  outletSize: "Size to ask",
  outletCount: "Count to ask",
  layout: "Layout to ask",
  return: "Return to ask",
  drain: "Drain run to ask",
  zoneSize: "Size to ask",
} as const;

/** Where the air goes, checked against the pack's airflow: a return's air
    speed when its size is known, and the per-room returns' area against the
    unit's own. Said, never a block. */
export function ductedAirWords(pair: Pick<DuctedPair, "airflowLs">, read: Pick<DuctedRead, "returns">): string[] {
  const out: string[] = [];
  if (pair.airflowLs == null) return out;
  const areaOf = (r: DuctedReturn) =>
    r.widthMm && r.heightMm ? (r.widthMm / 1000) * (r.heightMm / 1000) : r.neckMm ? Math.PI * (r.neckMm / 2000) ** 2 : null;
  const areas = read.returns.map(areaOf);
  const unsized = read.returns.filter((_, i) => areas[i] == null).map((r) => (r.common ? "the common return" : r.room));
  if (unsized.length > 0) out.push(`The unit's ${pair.airflowLs} L/s splits across the returns once ${unsized.join(", ")} ${unsized.length === 1 ? "has" : "have"} a size`);
  if (read.returns.length > 0 && areas.every((a) => a != null)) {
    const total = areas.reduce((n, a) => n! + a!, 0)!;
    const each = read.returns.map((r, i) => {
      const share = (pair.airflowLs! * areas[i]!) / total;
      return `${r.common ? "the common return" : r.room}: about ${Math.round(share)} L/s, ${(share / 1000 / areas[i]!).toFixed(1)} m/s`;
    });
    out.push(`The unit's ${pair.airflowLs} L/s through ${read.returns.length === 1 ? "its return" : `${read.returns.length} returns, split by size`}: ${each.join("; ")}`);
  }
  return out;
}

export type DuctedChoices = { runM: number | null; outdoorAt: OutdoorAt | null; newCircuit: boolean | null; drainPump: boolean };

/** The system's kit: the pair and its coil, mount, isolator and circuit as a
    split's; the indoor's hanging kit when it's in the roof; then the air
    side as the brief gives it — each outlet line, each return, each piece
    of ductwork — and the zoning: a damper and its cable a zone, the
    controller and sensors as said. What the brief doesn't give goes on
    asked. */
export function ductedKitRows(pair: DuctedPair, read: DuctedRead, c: DuctedChoices): { name: string; sub: string; qty: string }[] {
  const sys = "the ducted system";
  const run = c.runM != null ? `${c.runM} m` : RUN_TO_ASK;
  const size = [pair.outdoorWidthMm != null ? `${pair.outdoorWidthMm} mm` : null, pair.outdoorWeightKg != null ? `${pair.outdoorWeightKg} kg` : null].filter(Boolean).join(", ");
  const mount = c.outdoorAt ? ({ ground: KIT.groundMount, wall: KIT.wallBracket, roof: KIT.roofStand } as const)[c.outdoorAt] : null;
  const rows = [
    { name: pair.indoor, sub: `Ducted indoor unit, ${sys}`, qty: "1" },
    { name: pair.outdoor, sub: `Outdoor unit, ${sys}`, qty: "1" },
    { name: `ø${pair.liquidMm} / ø${pair.gasMm} pair coil`, sub: `liquid / gas mm, ${sys}`, qty: run },
    mount ? { name: mount, sub: `${size ? `for the outdoor's ${size}, ` : ""}${sys}`, qty: "1" } : { name: KIT.mount, sub: sys, qty: WHERE_TO_ASK },
    { name: KIT.isolator, sub: `${pair.outdoorAmps != null ? `for the outdoor's ${pair.outdoorAmps} A, ` : ""}${sys}`, qty: "1" },
    { name: KIT.pipeCover, sub: `along the run, ${sys}`, qty: run },
  ];
  if (c.newCircuit) rows.push({ name: KIT.newCircuit, sub: sys, qty: "1" });
  if (read.unitAt === "roof") rows.push({ name: "Hanging kit", sub: `the indoor in the roof, ${sys}`, qty: "1" });
  rows.push({ name: c.drainPump ? KIT.pump : "Condensate drain", sub: sys, qty: c.drainPump ? "1" : DUCT_ASK.drain });

  /* the outlets, as the brief gives them */
  if (read.outlets.length === 0) rows.push({ name: "Supply outlets", sub: sys, qty: DUCT_ASK.outletCount });
  for (const o of read.outlets) {
    const sized = o.type === "bar" || o.type === "slot" ? o.lengthMm != null : o.neckMm != null;
    rows.push({ name: outletName(o), sub: o.room || sys, qty: o.count > 0 ? (sized ? String(o.count) : DUCT_ASK.outletSize) : DUCT_ASK.outletCount });
  }
  /* the returns */
  if (read.returns.length === 0) rows.push({ name: "Return grille", sub: sys, qty: DUCT_ASK.return });
  for (const r of read.returns) {
    const dims = r.widthMm && r.heightMm ? ` ${r.widthMm} × ${r.heightMm}` : r.neckMm ? `, Ø${r.neckMm} spigot` : "";
    rows.push({ name: `Return grille${dims}`, sub: r.common ? `common return${r.room ? `, ${r.room}` : ""}` : r.room, qty: dims ? "1" : DUCT_ASK.outletSize });
  }
  /* the ductwork, piece by piece as written — or asked */
  if (read.layout.length === 0) rows.push({ name: "Ductwork layout", sub: sys, qty: DUCT_ASK.layout });
  for (const p of read.layout) {
    const ins = p.inMm ? `Ø${p.inMm}` : "";
    const outs = p.outsMm.length ? p.outsMm.map((m) => `Ø${m}`).join(" / ") : "";
    const name =
      p.piece === "plenum"
        ? `Plenum${outs ? `, spigots ${outs}` : ""}`
        : p.piece === "trunk"
          ? `Trunk ${ins}`.trim()
          : `Fitting ${ins}${outs ? ` → ${outs}` : ""}`.trim();
    rows.push({ name, sub: sys, qty: p.inMm || p.outsMm.length ? String(Math.max(1, p.count)) : DUCT_ASK.outletSize });
  }
  /* the zoning */
  const z = read.zoning;
  if (z) {
    const zoned = z.zones != null ? Math.max(0, z.zones - (z.commonZone ? 1 : 0)) : null;
    const necks = [...new Set(read.outlets.map((o) => o.neckMm).filter((n): n is number => n != null))];
    const damper = necks.length === 1 ? `Zone damper Ø${necks[0]}` : "Zone damper";
    rows.push(
      { name: damper, sub: z.commonZone ? `a zone, not the common zone (${z.commonZone})` : "a zone", qty: zoned != null ? (necks.length === 1 ? String(zoned) : DUCT_ASK.zoneSize) : DUCT_ASK.outletCount },
      { name: "Zone cable", sub: "a damper", qty: zoned != null ? String(zoned) : DUCT_ASK.outletCount },
      { name: z.controller ? `Zone controller: ${z.controller}` : "Zone controller", sub: z.control === "temperature" ? "temperature control" : z.control === "on_off" ? "on/off" : sys, qty: "1" }
    );
    const wireless = z.sensors.filter((s) => s.wireless).length;
    const wired = z.sensors.length - wireless;
    if (wireless) rows.push({ name: "Zone sensor, wireless", sub: z.sensors.filter((s) => s.wireless).map((s) => s.room).join(", "), qty: String(wireless) });
    if (wired) rows.push({ name: "Zone sensor, wired", sub: z.sensors.filter((s) => !s.wireless).map((s) => s.room).join(", "), qty: String(wired) });
    if (z.wifi) rows.push({ name: "Wi-Fi interface", sub: sys, qty: "1" });
  }
  rows.push({ name: KIT.consumables, sub: sys, qty: "1" });
  return rows;
}

/** What the quote asks about the system, from what the brief left out.
    `rooms`: the rooms the brief sized, which are its zones' rooms. */
export function ductedAsks(read: DuctedRead, c: DuctedChoices, rooms: readonly string[] = []): string[] {
  const out: string[] = [];
  if (c.runM == null) out.push("the pipe run");
  if (c.outdoorAt == null) out.push("where the outdoor sits");
  if (read.unitAt == null) out.push("where the indoor goes (roof, underfloor)");
  if (read.outletsUnsure) out.push(`the outlet count ("${read.outletsUnsure.said}")`);
  if (read.outlets.length === 0) out.push("the outlets: type, size and count");
  if (read.returns.length === 0) out.push("the return: where and what size");
  if (read.layout.length === 0) out.push("how the ductwork runs");
  if (read.zoning && read.zoning.zones == null) out.push("how many zones");
  if (read.zoning?.control === "temperature") {
    const low = (r: string) => r.trim().toLowerCase();
    const sensed = new Set(read.zoning.sensors.map((s) => low(s.room)));
    const common = read.zoning.commonZone ? low(read.zoning.commonZone) : null;
    const zoneRooms = rooms.length ? rooms : read.outlets.map((o) => o.room).filter(Boolean);
    const unsensed = [...new Set(zoneRooms.filter((r) => !sensed.has(low(r)) && low(r) !== common))];
    if (unsensed.length) out.push(`a sensor for ${unsensed.join(", ")} (temperature control wants one in every zone), or on/off there`);
  }
  out.push("where the condensate drains");
  return out;
}
