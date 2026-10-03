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
};

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
};

export type SizedRoom = {
  name: string;
  said: string;
  areaM2: number;
  loadKw: number;
  /** what the brief didn't say, counted as standard: to ask */
  assumed: string[];
  style: IndoorStyle;
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
    rooms.push({ ...r, areaM2: area });
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
  pack: Pick<DataPack, "indoor_units" | "pair_tables">,
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
  const assumed = (Object.keys(ASK) as (keyof typeof ASK)[]).filter((k) => room[k] == null).map((k) => ASK[k]);
  const style = room.style ?? "wall";
  const ff = new Map(pack.indoor_units.map((u) => [u.model, u.form_factor]));
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
    }));
  return { name: room.name, said: room.said, areaM2: room.areaM2, loadKw: Math.round(loadKw * 10) / 10, assumed, style, options };
}

export const ZONE_LABEL = (z: number) => CLIMATE_ZONES[z]?.label ?? `Zone ${z}`;
export const isZone = (z: unknown): z is number => typeof z === "number" && Number.isInteger(z) && !!CLIMATE_ZONES[z];
