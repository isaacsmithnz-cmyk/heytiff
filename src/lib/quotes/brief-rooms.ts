import type { DataPack } from "@/lib/studio/packs/schema";
import {
  CLIMATE_ZONES,
  roomHeatLoadKw,
  type BuildingType,
  type GlazingLevel,
  type Orientation,
  type RoomCondition,
} from "@/lib/studio/loads";
import { formFactorLabel } from "@/lib/studio/form-factors";
import { proposeMultiIdus, proposeMultiOdus } from "@/lib/studio/multi";
import type { DuctedRead } from "./brief-ducted";

/* ROOMS READ FROM THE BRIEF, SIZED (Isaac, 2026-10-04: "What if I said the
   room is 30m2?… API call should be able to gauge based on the size of the
   unit and brief description").

   Tiff reads the brief for the rooms it gives a size for, and the words it
   read each from. HeyTiff keeps a room only when those words are in the
   brief and its size is in those words — a size Tiff made up is dropped,
   never used. Each kept room is sized the way Studio sizes a drawn one:
   the NCC climate zone's watts a square metre (the industry table, shared
   by every business), then glass, insulation, ceiling and aspect where the
   brief says them. What it doesn't say is counted as standard and listed
   to ask. The data pack's split pairs that cover the load are the options,
   smallest first, for a person to pick; nothing goes on the job until they
   do. Pure.

   A UNIT SIZE THE BRIEF NAMES is a size too (Isaac's walk, 2026-10-05:
   "6kw Kitchen, 2.5kw x 2" read as no rooms at all). The brief decides: a
   room whose words name its unit's kW is kept on those words, and its pair
   is the pack's nearest to that size — no load is worked out for it, and
   a multi's outdoor is the one the combination table takes the heads on,
   never one sized to their sum. */

export type IndoorStyle = "wall" | "ducted" | "cassette" | "floor" | "bulkhead" | "under-ceiling";

/** A room as Tiff read it, before it's checked against the brief. */
export type ReadRoom = {
  name: string;
  /** the brief's own words this room was read from, verbatim */
  said: string;
  areaM2: number | null;
  /** "6 x 5": the two sides, when the brief gives sides, not an area */
  sidesM: [number, number] | null;
  /** the unit's capacity the brief names for this room ("6kw Kitchen"), in
      kW; null when it names none */
  unitKw: number | null;
  ceilingM: number | null;
  glazing: GlazingLevel | null;
  insulation: RoomCondition | null;
  facing: Orientation | null;
  roomAbove: boolean | null;
  style: IndoorStyle | null;
  /** the pipe run, indoor to outdoor, when the brief states it, and the
      words it's in */
  runM: number | null;
  runSaid: string | null;
  /** where the outdoor sits, how the head drains, and a new circuit — each
      only when the brief says, with the words it's in */
  outdoorAt: OutdoorAt | null;
  outdoorSaid: string | null;
  drain: "gravity" | "pump" | null;
  drainSaid: string | null;
  newCircuit: boolean | null;
  circuitSaid: string | null;
};

export type OutdoorAt = "ground" | "wall" | "roof";

export type ReadBrief = {
  rooms: ReadRoom[];
  /** one ducted system for the rooms, when the brief describes one */
  ducted: DuctedRead | null;
  /** the brief names a VRF, VRV, PUMY or City Multi system */
  vrf: boolean;
  /** how it says the heads connect: a branch box, or City Multi on joints */
  vrfHeads: "box" | "joint" | null;
  /** a swap: an old system comes out, the existing pipe is kept — each only
      when the brief says, with its words */
  swap: { replacing: boolean | null; replacingSaid: string | null; keepPipe: boolean | null; keepPipeSaid: string | null };
  buildingType: BuildingType | null;
  /** the NCC climate zone Tiff reads off the site address, and the town */
  zone: { zone: number; town: string } | null;
};

export type PairOption = {
  indoor: string;
  outdoor: string;
  style: string;
  /** the pair's rated output, cooling and heating */
  coolKw: number;
  heatKw: number;
  /** the pair's pipe, liquid and gas, from the pack */
  liquidMm: number;
  gasMm: number;
  /** the outdoor's size, weight and current, from the pack: what its mount
      and its isolator must take */
  outdoorWidthMm: number | null;
  outdoorWeightKg: number | null;
  outdoorAmps: number | null;
};

export type SizedRoom = {
  name: string;
  said: string;
  /** the area the brief gives; null when it names the unit's size instead */
  areaM2: number | null;
  /** the unit's size the brief names; the room's units are matched to it */
  statedKw: number | null;
  /** the load worked out from the area, or the stated size */
  loadKw: number;
  /** what the brief didn't say, counted as standard: to ask */
  assumed: string[];
  style: IndoorStyle;
  /** the pipe run the brief states, checked; null to ask */
  runM: number | null;
  outdoorAt: OutdoorAt | null;
  drain: "gravity" | "pump" | null;
  newCircuit: boolean | null;
  options: PairOption[];
};

const norm = (s: string) => s.toLowerCase().replace(/[²]/g, "2").replace(/\s+/g, " ").trim();
/** a number as it might be written: 30, 30.0, 4.5 */
const numberIn = (text: string, n: number) =>
  new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}(\\.0+)?(?![\\d])`).test(text);

/** How many rooms one clause can hold: "2.5kw x 2" and "2 x 2.5kw" are
    two; anything else is one. */
export function countIn(said: string): number {
  const counts = [...said.matchAll(/(?:^|[^\d.])(\d{1,2})\s*[x×](?![a-z])|(?<![a-z])[x×]\s*(\d{1,2})(?![\d.])/gi)]
    .map((m) => Number(m[1] ?? m[2]))
    .filter((n) => n >= 1 && n <= 10);
  return counts.length ? Math.max(...counts) : 1;
}

/** The largest single head a stated size can be, in kW. */
export const MAX_HEAD_KW = 30;

/** The rooms whose words are in the brief and whose size — an area, two
    sides, or the unit's kW — is in those words; everything else Tiff said
    about a room is kept only if the brief could have said it (a style, a
    facing). One clause holds only as many rooms as it counts. */
export function checkRooms(read: ReadBrief, brief: string): { rooms: ReadRoom[]; dropped: string[] } {
  const text = norm(brief);
  const rooms: ReadRoom[] = [];
  const dropped: string[] = [];
  const perClause = new Map<string, number>();
  const names = new Set<string>();
  for (const r of read.rooms) {
    const said = norm(r.said);
    const inBrief = said.length >= 3 && text.includes(said);
    const area =
      r.areaM2 != null && r.areaM2 > 0 && numberIn(said, r.areaM2)
        ? r.areaM2
        : r.sidesM && r.sidesM.every((s) => s > 0 && numberIn(said, s))
          ? Math.round(r.sidesM[0] * r.sidesM[1] * 10) / 10
          : null;
    const unitKw = r.unitKw != null && r.unitKw > 0 && r.unitKw <= MAX_HEAD_KW && numberIn(said, r.unitKw) ? r.unitKw : null;
    const seen = perClause.get(said) ?? 0;
    if (!inBrief || (area == null && unitKw == null) || (area != null && area > 500) || seen >= countIn(said)) {
      dropped.push(r.name);
      continue;
    }
    perClause.set(said, seen + 1);
    /* each room its own name: the runs and the multi's heads go by it */
    let name = r.name;
    for (let n = 2; names.has(name); n++) name = `${r.name} ${n}`;
    names.add(name);
    /* a run is kept only when its words are the brief's and hold it */
    const runOk = r.runM != null && r.runM > 0 && r.runM <= 100 && !!r.runSaid && text.includes(norm(r.runSaid)) && numberIn(norm(r.runSaid), r.runM);
    /* a fact is kept only when its words are the brief's */
    const inWords = (w: string | null) => !!w && norm(w).length >= 3 && text.includes(norm(w));
    rooms.push({
      ...r,
      name,
      areaM2: area,
      unitKw,
      runM: runOk ? r.runM : null,
      runSaid: runOk ? r.runSaid : null,
      outdoorAt: inWords(r.outdoorSaid) ? r.outdoorAt : null,
      drain: inWords(r.drainSaid) ? r.drain : null,
      newCircuit: inWords(r.circuitSaid) ? r.newCircuit : null,
    });
  }
  return { rooms, dropped };
}

export const STYLE_OF: Record<string, IndoorStyle> = {
  wall: "wall",
  ducted: "ducted",
  bulkhead: "bulkhead",
  "cassette-4way": "cassette",
  "cassette-1way": "cassette",
  "floor-console": "floor",
  "floor-concealed": "floor",
  "under-ceiling": "under-ceiling",
};

const ASK = {
  glazing: "how much glass",
  insulation: "how well it's insulated",
  ceilingM: "the ceiling height",
  facing: "which way it faces",
  roomAbove: "whether there's a floor above",
  style: "the style of unit (counted as a wall split)",
} as const;

/** The size nearest a stated one among those given: "7kw" is 7.1, "5.2kw"
    is 5.0; a tie goes to the larger. */
export function nearestKw(sizes: readonly number[], statedKw: number): number | undefined {
  return [...new Set(sizes)].sort((a, b) => Math.abs(a - statedKw) - Math.abs(b - statedKw) || b - a)[0];
}

/** One room's load, and the pack's split pairs that cover it — the unit
    must cover the load cooling AND heating, as Studio sizes — at the
    smallest size that does, one per series. A room whose brief names its
    unit's size takes the pack's pairs nearest that size instead, and has
    no load to ask about. */
export function sizeRoom(
  room: ReadRoom,
  zone: number,
  buildingType: BuildingType,
  pack: Pick<DataPack, "indoor_units" | "pair_tables"> & Partial<Pick<DataPack, "outdoor_units">>,
  limit = 4
): SizedRoom {
  const style = room.style ?? "wall";
  const ff = new Map(pack.indoor_units.map((u) => [u.model, u.form_factor]));
  const odu = new Map((pack.outdoor_units ?? []).map((u) => [u.model, u]));
  const ofStyle = pack.pair_tables
    .filter((p) => p.rated_cool_kw != null && p.rated_heat_kw != null)
    .filter((p) => STYLE_OF[ff.get(p.idu_model) ?? ""] === style);
  const optionOf = (p: (typeof ofStyle)[number]): PairOption => ({
    indoor: p.idu_model,
    outdoor: p.odu_model,
    style: formFactorLabel(ff.get(p.idu_model)) ?? "Indoor",
    coolKw: p.rated_cool_kw!,
    heatKw: p.rated_heat_kw!,
    liquidMm: p.pipe_liquid_mm,
    gasMm: p.pipe_gas_mm,
    outdoorWidthMm: odu.get(p.odu_model)?.width_mm ?? null,
    outdoorWeightKg: odu.get(p.odu_model)?.weight_kg ?? null,
    outdoorAmps: odu.get(p.odu_model)?.max_amps_a ?? null,
  });
  const fitAsked = () => [...(room.runM == null ? ["the pipe run"] : []), ...(room.outdoorAt == null ? ["where the outdoor sits"] : [])];

  if (room.areaM2 == null && room.unitKw != null) {
    const stated = room.unitKw;
    const at = nearestKw(ofStyle.map((p) => p.rated_cool_kw!), stated);
    return {
      name: room.name,
      said: room.said,
      areaM2: null,
      statedKw: stated,
      loadKw: stated,
      assumed: [...(room.style == null ? [ASK.style] : []), ...fitAsked()],
      style,
      runM: room.runM,
      outdoorAt: room.outdoorAt,
      drain: room.drain,
      newCircuit: room.newCircuit,
      options: ofStyle
        .filter((p) => p.rated_cool_kw === at)
        .sort((a, b) => a.idu_model.localeCompare(b.idu_model))
        .slice(0, limit)
        .map(optionOf),
    };
  }

  const areaM2 = room.areaM2 ?? 0;
  const loadKw = roomHeatLoadKw({
    areaM2,
    climateZone: zone,
    buildingType,
    glazing: room.glazing ?? undefined,
    condition: room.insulation ?? undefined,
    ceilingHeightM: room.ceilingM ?? undefined,
    orientation: room.facing ?? undefined,
    roomAbove: room.roomAbove ?? undefined,
  });
  const assumed: string[] = [...(Object.keys(ASK) as (keyof typeof ASK)[]).filter((k) => room[k] == null).map((k) => ASK[k]), ...fitAsked()];
  const covering = ofStyle
    .filter((p) => Math.min(p.rated_cool_kw!, p.rated_heat_kw!) >= loadKw)
    .sort((a, b) => a.rated_cool_kw! - b.rated_cool_kw! || a.idu_model.localeCompare(b.idu_model));
  const smallest = covering[0]?.rated_cool_kw;
  const options = covering
    .filter((p) => p.rated_cool_kw === smallest)
    .slice(0, limit)
    .map(optionOf);
  return {
    name: room.name,
    said: room.said,
    areaM2,
    statedKw: null,
    loadKw: Math.round(loadKw * 10) / 10,
    assumed,
    style,
    runM: room.runM,
    outdoorAt: room.outdoorAt,
    drain: room.drain,
    newCircuit: room.newCircuit,
    options,
  };
}

export const ZONE_LABEL = (z: number) => CLIMATE_ZONES[z]?.label ?? `Zone ${z}`;
export const isZone = (z: unknown): z is number => typeof z === "number" && Number.isInteger(z) && !!CLIMATE_ZONES[z];

/** What a person settled for the room before adding it: the run and where
    the outdoor sits, over what the brief said. */
export type KitChoices = { runM: number | null; outdoorAt: OutdoorAt | null };

/* The rows a kit adds, by name. A row is priced by the business's own item
   for its part (job-price.ts), or by its own allowance. */
export const KIT = {
  groundMount: "Ground mount",
  wallBracket: "Wall bracket",
  roofStand: "Roof stand",
  mount: "Outdoor mount",
  isolator: "Isolator",
  pipeCover: "Pipe cover",
  drainHose: "Drain hose",
  pump: "Condensate pump",
  consumables: "Consumables",
  newCircuit: "New circuit",
} as const;

export const RUN_TO_ASK = "Run to ask";
export const WHERE_TO_ASK = "Where it sits: ask";

const MOUNT_NAME = { ground: KIT.groundMount, wall: KIT.wallBracket, roof: KIT.roofStand } as const;

/** A single split's kit: the two units, the pair coil at the pack's sizes,
    the outdoor's mount and isolator for its size and current, pipe cover
    and drain along the run, a condensate pump only when the brief says it
    can't drain, consumables for the head, and a new circuit only when the
    brief says. What isn't known goes on asked, and the Price says so. */
export function kitRows(room: Pick<SizedRoom, "name" | "drain" | "newCircuit">, o: PairOption, c: KitChoices): { name: string; sub: string; qty: string }[] {
  const run = c.runM != null ? `${c.runM} m` : RUN_TO_ASK;
  const size = [o.outdoorWidthMm != null ? `${o.outdoorWidthMm} mm` : null, o.outdoorWeightKg != null ? `${o.outdoorWeightKg} kg` : null].filter(Boolean).join(", ");
  const rows = [
    { name: o.indoor, sub: `${o.style} indoor unit, ${room.name}`, qty: "1" },
    { name: o.outdoor, sub: `Outdoor unit, ${room.name}`, qty: "1" },
    { name: `ø${o.liquidMm} / ø${o.gasMm} pair coil`, sub: `liquid / gas mm, ${room.name}`, qty: run },
    c.outdoorAt
      ? { name: MOUNT_NAME[c.outdoorAt], sub: `${size ? `for the outdoor's ${size}, ` : ""}${room.name}`, qty: "1" }
      : { name: KIT.mount, sub: room.name, qty: WHERE_TO_ASK },
    { name: KIT.isolator, sub: `${o.outdoorAmps != null ? `for the outdoor's ${o.outdoorAmps} A, ` : ""}${room.name}`, qty: "1" },
    { name: KIT.pipeCover, sub: `along the run, ${room.name}`, qty: run },
    { name: KIT.drainHose, sub: `along the run, ${room.name}`, qty: run },
  ];
  if (room.drain === "pump") rows.push({ name: KIT.pump, sub: `it can't drain by gravity, ${room.name}`, qty: "1" });
  rows.push({ name: KIT.consumables, sub: `a head, ${room.name}`, qty: "1" });
  if (room.newCircuit) rows.push({ name: KIT.newCircuit, sub: room.name, qty: "1" });
  return rows;
}

/* ── ONE MULTI FOR THE ROOMS ─────────────────────────────────────────────
   The same rooms on one outdoor, as Studio sizes a multi: each room's head
   the smallest of its style that covers its load (proposeMultiIdus), the
   outdoor the smallest the pack's combination table takes them on and that
   covers their loads together (proposeMultiOdus) — the table, never a
   ratio. The pack's pipe limits are checked against the runs known. */

export type MultiHead = { room: string; indoor: string; style: string; coolKw: number; heatKw: number; liquidMm: number; gasMm: number };

export type MultiOption = {
  outdoor: string;
  coolKw: number;
  heatKw: number;
  outdoorWidthMm: number | null;
  outdoorWeightKg: number | null;
  outdoorAmps: number | null;
  heads: MultiHead[];
  /** the pack's limits on pipe, in metres */
  maxTotalM: number | null;
  maxBranchM: number | null;
};

export type MultiProposal = { ok: true; multi: MultiOption } | { ok: false; why: string };

export function sizeMulti(rooms: readonly SizedRoom[], pack: DataPack): MultiProposal | null {
  if (rooms.length < 2) return null;
  const heads: { room: SizedRoom; idu: DataPack["indoor_units"][number] }[] = [];
  for (const r of rooms) {
    const mine = proposeMultiIdus(pack, r.statedKw ?? r.loadKw, "worst-of-both").filter((p) => STYLE_OF[p.idu.form_factor] === r.style);
    /* a head the brief names: the nearest of that style to its size */
    if (r.statedKw != null) {
      const at = nearestKw(mine.map((p) => p.idu.capacity_cool_kw), r.statedKw);
      const named = mine.find((p) => p.idu.capacity_cool_kw === at);
      if (!named) return { ok: false, why: `No multi head of that style in the data pack for ${r.name}'s ${r.statedKw} kW` };
      heads.push({ room: r, idu: named.idu });
      continue;
    }
    /* the smallest that suits; else, for a room smaller than any head, the
       smallest that covers it — there is nothing smaller to buy */
    const fit = mine.find((p) => p.fit === "fits") ?? mine.find((p) => p.capacityKw >= r.loadKw);
    if (!fit) return { ok: false, why: `No multi head of that style in the data pack covers ${r.name}'s ${r.loadKw} kW` };
    heads.push({ room: r, idu: fit.idu });
  }
  /* rooms with loads worked out must be covered together (a named head
     counting at its size beside them); heads the brief names, all of them,
     bring no load, and take the smallest outdoor the combination table
     takes them on */
  const required = rooms.some((r) => r.statedKw == null) ? rooms.reduce((n, r) => n + r.loadKw, 0) : null;
  const pick = proposeMultiOdus(pack, heads.map((h) => h.idu), "worst-of-both", { requiredKw: required }).find((p) => p.recommended);
  if (!pick) return { ok: false, why: "No multi outdoor in the data pack takes these heads together" };
  return {
    ok: true,
    multi: {
      outdoor: pick.odu.model,
      coolKw: pick.odu.capacity_cool_kw,
      heatKw: pick.odu.capacity_heat_kw,
      outdoorWidthMm: pick.odu.width_mm ?? null,
      outdoorWeightKg: pick.odu.weight_kg ?? null,
      outdoorAmps: pick.odu.max_amps_a ?? null,
      heads: heads.map(({ room, idu }) => ({
        room: room.name,
        indoor: idu.model,
        style: formFactorLabel(idu.form_factor) ?? "Indoor",
        coolKw: idu.capacity_cool_kw,
        heatKw: idu.capacity_heat_kw,
        liquidMm: idu.conn_liquid_mm,
        gasMm: idu.conn_gas_mm,
      })),
      maxTotalM: pick.rule.max_total_pipe_m ?? null,
      maxBranchM: pick.rule.max_per_branch_m ?? null,
    },
  };
}

/** The pack's pipe limits against the runs: said when one is over, and the
    total once every run is known. */
export function multiPipeWords(m: MultiOption, runs: readonly { room: string; runM: number | null }[]): string[] {
  const out: string[] = [];
  for (const r of runs) {
    if (r.runM != null && m.maxBranchM != null && r.runM > m.maxBranchM) out.push(`${r.room}'s ${r.runM} m is over the ${m.maxBranchM} m a branch takes`);
  }
  if (runs.every((r) => r.runM != null) && m.maxTotalM != null) {
    const total = Math.round(runs.reduce((n, r) => n + (r.runM ?? 0), 0) * 10) / 10;
    out.push(total > m.maxTotalM ? `${total} m of pipe is over the ${m.maxTotalM} m it takes` : `${total} m of pipe, of the ${m.maxTotalM} m it takes`);
  }
  return out;
}

/** A multi's kit: the outdoor once, with its mount, isolator and a new
    circuit when the brief says; then each head with its own coil at its
    sizes, pipe cover and drain along its run, consumables, and a pump when
    the brief says its room can't drain. */
export function multiKitRows(
  m: MultiOption,
  rooms: readonly Pick<SizedRoom, "name" | "drain" | "newCircuit">[],
  c: { runs: Record<string, number | null>; outdoorAt: OutdoorAt | null }
): { name: string; sub: string; qty: string }[] {
  const size = [m.outdoorWidthMm != null ? `${m.outdoorWidthMm} mm` : null, m.outdoorWeightKg != null ? `${m.outdoorWeightKg} kg` : null].filter(Boolean).join(", ");
  const system = `the multi`;
  const rows = [
    { name: m.outdoor, sub: `Multi outdoor unit, ${m.heads.length} heads`, qty: "1" },
    c.outdoorAt
      ? { name: MOUNT_NAME[c.outdoorAt], sub: `${size ? `for the outdoor's ${size}, ` : ""}${system}`, qty: "1" }
      : { name: KIT.mount, sub: system, qty: WHERE_TO_ASK },
    { name: KIT.isolator, sub: `${m.outdoorAmps != null ? `for the outdoor's ${m.outdoorAmps} A, ` : ""}${system}`, qty: "1" },
  ];
  if (rooms.some((r) => r.newCircuit)) rows.push({ name: KIT.newCircuit, sub: system, qty: "1" });
  for (const h of m.heads) {
    const room = rooms.find((r) => r.name === h.room);
    const runM = c.runs[h.room] ?? null;
    const run = runM != null ? `${runM} m` : RUN_TO_ASK;
    rows.push(
      { name: h.indoor, sub: `${h.style} indoor unit, ${h.room}`, qty: "1" },
      { name: `ø${h.liquidMm} / ø${h.gasMm} pair coil`, sub: `liquid / gas mm, ${h.room}`, qty: run },
      { name: KIT.pipeCover, sub: `along the run, ${h.room}`, qty: run },
      { name: KIT.drainHose, sub: `along the run, ${h.room}`, qty: run }
    );
    if (room?.drain === "pump") rows.push({ name: KIT.pump, sub: `it can't drain by gravity, ${h.room}`, qty: "1" });
    rows.push({ name: KIT.consumables, sub: `a head, ${h.room}`, qty: "1" });
  }
  return rows;
}

/* ── A SWAP, ON ANY KIT ──────────────────────────────────────────────────
   When the old system comes out, its refrigerant is recovered and it's taken
   away; when the existing pipe is kept, it's flushed instead of new coil
   and cover going in. Each is the business's own allowance (Quoting), and
   only when the brief says it, or a person ticks it. */

export type Swap = { replacing: boolean; keepPipe: boolean };

/** A kit's rows with the swap applied: the existing pipe flushed in place
    of new coil and cover, and the old system recovered and removed. */
export function withSwap(rows: readonly { name: string; sub: string; qty: string }[], swap: Swap, system: string): { name: string; sub: string; qty: string }[] {
  const out = swap.keepPipe ? rows.filter((r) => !/pair coil$/.test(r.name) && r.name !== KIT.pipeCover) : [...rows];
  const units = out.findIndex((r) => !/indoor unit|outdoor unit/i.test(r.sub));
  const at = units === -1 ? out.length : units;
  const added = [
    ...(swap.keepPipe ? [{ name: "Pipe flush", sub: `the existing pipe, ${system}`, qty: "1" }] : []),
    ...(swap.replacing ? [{ name: "Recovery and removal", sub: `the old system, ${system}`, qty: "1" }] : []),
  ];
  return [...out.slice(0, at), ...added, ...out.slice(at)];
}
