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
   do. Pure. */

export type IndoorStyle = "wall" | "ducted" | "cassette" | "floor" | "bulkhead" | "under-ceiling";

/** A room as Tiff read it, before it's checked against the brief. */
export type ReadRoom = {
  name: string;
  /** the brief's own words this room was read from, verbatim */
  said: string;
  areaM2: number | null;
  /** "6 x 5": the two sides, when the brief gives sides, not an area */
  sidesM: [number, number] | null;
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
  areaM2: number;
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

/** The rooms whose words are in the brief and whose size is in those
    words; everything else Tiff said about a room is kept only if the brief
    could have said it (a style, a facing). */
export function checkRooms(read: ReadBrief, brief: string): { rooms: (ReadRoom & { areaM2: number })[]; dropped: string[] } {
  const text = norm(brief);
  const rooms: (ReadRoom & { areaM2: number })[] = [];
  const dropped: string[] = [];
  for (const r of read.rooms) {
    const said = norm(r.said);
    const inBrief = said.length >= 3 && text.includes(said);
    const area =
      r.areaM2 != null && r.areaM2 > 0 && numberIn(said, r.areaM2)
        ? r.areaM2
        : r.sidesM && r.sidesM.every((s) => s > 0 && numberIn(said, s))
          ? Math.round(r.sidesM[0] * r.sidesM[1] * 10) / 10
          : null;
    if (!inBrief || area == null || area > 500) {
      dropped.push(r.name);
      continue;
    }
    /* a run is kept only when its words are the brief's and hold it */
    const runOk = r.runM != null && r.runM > 0 && r.runM <= 100 && !!r.runSaid && text.includes(norm(r.runSaid)) && numberIn(norm(r.runSaid), r.runM);
    /* a fact is kept only when its words are the brief's */
    const inWords = (w: string | null) => !!w && norm(w).length >= 3 && text.includes(norm(w));
    rooms.push({
      ...r,
      areaM2: area,
      runM: runOk ? r.runM : null,
      runSaid: runOk ? r.runSaid : null,
      outdoorAt: inWords(r.outdoorSaid) ? r.outdoorAt : null,
      drain: inWords(r.drainSaid) ? r.drain : null,
      newCircuit: inWords(r.circuitSaid) ? r.newCircuit : null,
    });
  }
  return { rooms, dropped };
}

const STYLE_OF: Record<string, IndoorStyle> = {
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

/** One room's load, and the pack's split pairs that cover it — the unit
    must cover the load cooling AND heating, as Studio sizes — at the
    smallest size that does, one per series. */
export function sizeRoom(
  room: ReadRoom & { areaM2: number },
  zone: number,
  buildingType: BuildingType,
  pack: Pick<DataPack, "indoor_units" | "pair_tables"> & Partial<Pick<DataPack, "outdoor_units">>,
  limit = 4
): SizedRoom {
  const loadKw = roomHeatLoadKw({
    areaM2: room.areaM2,
    climateZone: zone,
    buildingType,
    glazing: room.glazing ?? undefined,
    condition: room.insulation ?? undefined,
    ceilingHeightM: room.ceilingM ?? undefined,
    orientation: room.facing ?? undefined,
    roomAbove: room.roomAbove ?? undefined,
  });
  const assumed: string[] = (Object.keys(ASK) as (keyof typeof ASK)[]).filter((k) => room[k] == null).map((k) => ASK[k]);
  const style = room.style ?? "wall";
  const ff = new Map(pack.indoor_units.map((u) => [u.model, u.form_factor]));
  const odu = new Map((pack.outdoor_units ?? []).map((u) => [u.model, u]));
  const covering = pack.pair_tables
    .filter((p) => p.rated_cool_kw != null && p.rated_heat_kw != null)
    .filter((p) => STYLE_OF[ff.get(p.idu_model) ?? ""] === style)
    .filter((p) => Math.min(p.rated_cool_kw!, p.rated_heat_kw!) >= loadKw)
    .sort((a, b) => a.rated_cool_kw! - b.rated_cool_kw! || a.idu_model.localeCompare(b.idu_model));
  const smallest = covering[0]?.rated_cool_kw;
  const options = covering
    .filter((p) => p.rated_cool_kw === smallest)
    .slice(0, limit)
    .map((p) => ({
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
    }));
  if (room.runM == null) assumed.push("the pipe run");
  if (room.outdoorAt == null) assumed.push("where the outdoor sits");
  return {
    name: room.name,
    said: room.said,
    areaM2: room.areaM2,
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
