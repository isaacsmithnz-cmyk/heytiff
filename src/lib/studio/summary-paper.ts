/* Design Studio — the Summary as the next flow's document says it: the boards
   "Summary-1" (the figures, a block per system) and "Summary-2" (Materials,
   the notes on the plans).

   Pure, and part of the one derivation: buildSummaryModel calls this with what
   it has already worked out, and the document renders what comes back. Nothing
   here is a new figure. It is the same capacities, covers and takeoff lines,
   said the way the boards say them, plus the three things the sheet never
   carried: the air and grilles in a ducted room (airflow.ts, duct-materials.ts),
   who each part is for, and the notes the person wrote on the plans. */

import type { DesignDocument, DesignObject, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { sizingCapacityKw } from "./loads";
import type { DesignBasis, DesignSnapshot, SheetGroup, SummaryRoomRow, SummarySystem } from "./summary";
import { allocationsOf, hasAllocations, roomsServed } from "./allocations";
import { roomAir, systemAir } from "./airflow";
import { roomAtPoint } from "./coverage";
import { isDevice } from "./devices";
import { grilleLine, grilleLineRooms, grilleRoomId } from "./duct-materials";
import { capacityFit, shortKw } from "./fit";
import { formFactorLabel } from "./form-factors";
import { grilleStream, isGrille } from "./grilles";
import { NOT_SURE_VALUE } from "./install";
import { NOTE_TYPE, noteText } from "./notes";
import { floorDisplayName } from "./plans";
import { OVERSIZE_CAP } from "./select";
import { isUnderFloor } from "./unit-where";
import { zoningOf, zonesOf } from "./zoning";

/** how a state word reads: good, needs a look, for your information */
export type PaperTone = "ok" | "look" | "info";

export interface PaperFigures {
  loadKw: number | null;
  /** "7 rooms, 166 m²" */
  loadLine: string;
  /** "Cooling installed", or Heating on a design sized on heating */
  installedLabel: string;
  installedKw: number | null;
  /** "2 systems" */
  installedLine: string;
  /** "Zone 5" */
  climate: string;
  /** "Sydney, residential" */
  climateLine: string;
  /** "Heat and cool" */
  sizedOn: string;
  /** "Each unit's smaller rating" */
  sizedOnLine: string;
}

export interface PaperRoom {
  roomId: string;
  name: string;
  level: string;
  areaM2: number | null;
  loadKw: number | null;
  capacityKw: number | null;
  /** "PEFY-P63VMX-E and PEFY-P50VMX-E" */
  indoor: string | null;
  /** "2 wall, linear bar grille 600 × 100": the supply grilles placed in it */
  grilles: string | null;
  /** its share of the unit's air, L/s, whole */
  airLs: number | null;
  pct: number | null;
  coverTone: PaperTone;
}

export interface PaperSystem {
  systemId: string;
  colour: string;
  /** "System 2, ducted" */
  heading: string;
  /** "Mitsubishi Electric PEA-M125HAA with PUZ-M125VKA-A, 12.0 kW, R32" */
  description: string;
  /** "Covered", "1.8 kW short" or "Not sized yet" */
  stateWord: string;
  stateTone: PaperTone;
  /** a ducted system's rooms read by grilles and air, the rest by indoor unit */
  form: "air" | "units";
  rooms: PaperRoom[];
  /** "Zoned by temperature: 5 zones, a wireless sensor in each." */
  zoning: string | null;
}

export type MaterialGroup = "units" | "pipework" | "ductwork" | "grilles" | "zoning" | "electrical" | "components";

/** the board's five shelves in its order, then the two the takeoff also has */
export const MATERIAL_GROUPS: { key: MaterialGroup; label: string }[] = [
  { key: "units", label: "Units" },
  { key: "pipework", label: "Pipework" },
  { key: "ductwork", label: "Ductwork" },
  { key: "grilles", label: "Grilles" },
  { key: "zoning", label: "Zoning" },
  { key: "electrical", label: "Electrical" },
  { key: "components", label: "Components" },
];

export interface MaterialRow {
  group: MaterialGroup;
  item: string;
  /** "System 1", "Kitchen / Dining / Living", "Bedroom 02, Bedroom 03 and Study" */
  forWhat: string;
  /** "13.6 m", "2", or the words for a quantity there isn't yet */
  qty: string;
  /** a quantity not known yet: a grey word and dot, never a figure */
  pending: boolean;
}

export interface SheetPaper {
  figures: PaperFigures;
  systems: PaperSystem[];
  /** rooms no system serves, the gap in the design */
  unserved: PaperRoom[];
  materials: MaterialRow[];
  /** "Riser location for the study duct. Ground floor." */
  notes: string[];
}

/* THE WORDS FOR THE SIZING BASIS. The figure's heading already says "Sized on".
   The line under it is what the engine does (sizingCapacityKw, loads.ts): on
   both duties a unit counts for the SMALLER of its two ratings. */
const BASIS_WORDS = {
  cooling: { value: "Cooling", line: "Each unit's cooling rating" },
  heating: { value: "Heating", line: "Each unit's heating rating" },
  "worst-of-both": { value: "Heat and cool", line: "Each unit's smaller rating" },
} satisfies Record<SizingBasis, { value: string; line: string }>;

const KIND_WORD = {
  split: "split",
  "multi-split": "multi-split",
  ducted: "ducted",
  vrf: "VRF",
  ventilation: "ventilation",
  "sheet-metal": "sheet metal",
} satisfies Record<DesignSystem["type"], string>;

/** "A", "A and B", "A, B and C" */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Wall bracket" → "wall bracket"; a name that opens on a code ("MUZ-AP25VG2's …") stays */
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;
const kw = (n: number): string => `${n.toFixed(1)} kW`;

/** a floor's name as a place: "Ground" reads "Ground floor", "Level 2" stands */
export function floorPlace(name: string): string {
  return /floor|level|basement|storey|roof|attic|mezzanine/i.test(name) ? name : `${name} floor`;
}

function figuresOf(systems: SummarySystem[], snapshot: DesignSnapshot, basis: DesignBasis): PaperFigures {
  const installed = systems.reduce<number | null>((a, s) => (s.capacityKw == null ? a : (a ?? 0) + s.capacityKw), null);
  const measured = snapshot.roomCount - snapshot.unmeasuredRoomCount;
  const rooms = snapshot.unmeasuredRoomCount > 0 ? `${measured} of ${plural(snapshot.roomCount, "room")} measured` : plural(snapshot.roomCount, "room");
  const words = BASIS_WORDS[basis.basis];
  return {
    loadKw: snapshot.totalLoadKw,
    loadLine: snapshot.areaM2 == null ? rooms : `${rooms}, ${Math.round(snapshot.areaM2)} m²`,
    installedLabel: basis.basis === "heating" ? "Heating installed" : "Cooling installed",
    installedKw: installed == null ? null : Math.round(installed * 10) / 10,
    installedLine: plural(systems.length, "system"),
    climate: `Zone ${basis.zone}`,
    climateLine: `${basis.zoneCity}, ${basis.buildingLabel.toLowerCase()}`,
    sizedOn: words.value,
    sizedOnLine: words.line,
  };
}

/* ── a system's units, counted the way the picklist counts them ─────────── */

interface PaperUnit {
  role: "idu" | "odu";
  model: string;
  /** the rooms it is in, empty for an outdoor or a unit on the whole system */
  rooms: string[];
  underFloorOf: string | null;
}

function unitsOf(doc: DesignDocument, sys: DesignSystem): PaperUnit[] {
  const roomName = (id: string) => {
    const o = doc.objects.find((x) => x.id === id && x.type === "room");
    return o ? String(o.props.name ?? "Room") : null;
  };
  const named = (ids: string[]) => ids.map(roomName).filter((n): n is string => n != null);
  const underFloorOf = (o: DesignObject | undefined): string | null => {
    if (!o || !isUnderFloor(o)) return null;
    const f = doc.floors.find((x) => x.id === o.floorId);
    return f ? floorDisplayName(f) : null;
  };
  if (hasAllocations(sys)) {
    return allocationsOf(sys)
      .filter((a) => a.model)
      .map((a) => ({
        role: a.role,
        model: a.model,
        rooms: named(roomsServed(a)),
        underFloorOf: underFloorOf(doc.objects.find((o) => o.id === a.id)),
      }));
  }
  return doc.objects
    .filter((o) => o.systemId === sys.id && o.type === "unit" && String(o.props.model ?? ""))
    .map((o) => ({
      role: o.props.role === "odu" ? ("odu" as const) : ("idu" as const),
      model: String(o.props.model),
      rooms: typeof o.props.roomId === "string" ? named([o.props.roomId]) : [],
      underFloorOf: underFloorOf(o),
    }));
}

/** "Mitsubishi Electric PUMY-SP125VKMD2-A, 14.0 kW, R410A, 3 bulkhead heads" */
function descriptionOf(s: SummarySystem, units: PaperUnit[], pack: DataPack | null): string {
  const indoors = units.filter((u) => u.role === "idu");
  const outdoor = s.outdoorModel;
  const single = indoors.length === 1 ? indoors[0].model : null;
  const models = single && outdoor ? `${single} with ${outdoor}` : (outdoor ?? single);
  const styles = [...new Set(indoors.map((u) => formFactorLabel(pack?.indoor_units.find((r) => r.model === u.model)?.form_factor)))];
  const style = styles.length === 1 && styles[0] ? `${lowerFirst(styles[0])} ` : "";
  const under = units.find((u) => u.underFloorOf)?.underFloorOf;
  return [
    models ? `${s.brandLabel} ${models}` : s.brandLabel,
    s.outdoorCapacityKw != null ? kw(s.outdoorCapacityKw) : null,
    s.refrigerant,
    indoors.length > 1 ? `${indoors.length} ${style}heads` : null,
    under ? `under the ${lowerFirst(floorPlace(under))}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** "Zoned by temperature: 5 zones, a wireless sensor in each, the controller
    on the Hallway wall." What Edit system was told, and where the controller
    was put when somebody put it. */
function zoningOfSystem(doc: DesignDocument, pack: DataPack, sys: DesignSystem): string | null {
  const said: string[] = [];
  const controller = doc.objects.find((o) => o.systemId === sys.id && isDevice(o) && o.type === "wall-controller");
  const at = controller && controller.geometry.kind === "point" ? controller.geometry.at : null;
  const room = controller && at ? roomAtPoint(doc.objects, controller.floorId, at) : null;
  for (const air of systemAir(doc, pack, sys)) {
    const z = zoningOf(sys, air.unit.id);
    const zones = zonesOf(air, z);
    if (!zones.length) continue;
    const parts = [plural(zones.length, "zone")];
    if (z.control === "temperature") parts.push(`a ${z.sensors} sensor in each`);
    if (room) parts.push(`the controller on the ${String(room.props.name ?? "room")} wall`);
    said.push(`Zoned ${z.control === "temperature" ? "by temperature" : "on and off"}: ${parts.join(", ")}.`);
  }
  return said.length ? said.join(" ") : null;
}

/** the supply grilles placed in each room, in words: only what was placed */
function grillesByRoom(doc: DesignDocument, sys: DesignSystem): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const o of doc.objects) {
    if (o.systemId !== sys.id || !isGrille(o) || grilleStream(o) !== "supply") continue;
    const id = grilleRoomId(doc, o);
    if (!id) continue;
    const { name, mount } = grilleLine(o);
    const words = `${mount ? `${mount}, ` : ""}${lowerFirst(name)}`;
    const here = counts.get(id) ?? new Map<string, number>();
    here.set(words, (here.get(words) ?? 0) + 1);
    counts.set(id, here);
  }
  const out = new Map<string, string>();
  for (const [id, here] of counts) out.set(id, joinWords([...here].map(([words, n]) => `${n} ${words}`)));
  return out;
}

/** a room row as the document reads it */
function roomOf(r: SummaryRoomRow, airLs: number | null, grilles: string | null): PaperRoom {
  const oversized = r.capacityKw != null && r.status === "covered" && capacityFit(r.capacityKw, r.loadKw, OVERSIZE_CAP) === "oversized";
  return {
    roomId: r.roomId,
    name: r.name,
    level: r.level,
    areaM2: r.areaM2,
    loadKw: r.loadKw,
    capacityKw: r.capacityKw,
    indoor: r.indoorModel ? joinWords(r.indoorModel.split(", ")) : null,
    grilles,
    airLs,
    pct: r.pct,
    coverTone: r.pct == null ? "info" : r.status === "covered" && !oversized ? "ok" : "look",
  };
}

function paperSystem(doc: DesignDocument, pack: DataPack | null, sys: DesignSystem, s: SummarySystem): PaperSystem {
  const units = unitsOf(doc, sys);
  const grilles = grillesByRoom(doc, sys);
  const known = s.pct != null && s.loadKw != null && s.capacityKw != null;
  const kindWord = KIND_WORD[s.type];
  return {
    systemId: s.systemId,
    colour: s.colour,
    heading: s.name.toLowerCase().includes(kindWord.toLowerCase()) ? s.name : `${s.name}, ${kindWord}`,
    description: descriptionOf(s, units, pack),
    stateWord: !known ? "Not sized yet" : s.status === "covered" ? "Covered" : `${kw(shortKw(s.loadKw!, s.capacityKw!))} short`,
    stateTone: !known ? "info" : s.status === "covered" ? "ok" : "look",
    form: s.type === "ducted" ? "air" : "units",
    rooms: s.rooms.map((r) => {
      const air = pack ? roomAir(doc, pack, sys, r.roomId) : null;
      return roomOf(r, air ? Math.round(air.ls) : null, grilles.get(r.roomId) ?? null);
    }),
    zoning: pack ? zoningOfSystem(doc, pack, sys) : null,
  };
}

/* ── Materials ───────────────────────────────────────────────────────────── */

const SHELF_OF: Record<SheetGroup, MaterialGroup> = {
  pipe: "pipework",
  electrical: "electrical",
  components: "components",
  ductwork: "ductwork",
  grilles: "grilles",
  controls: "zoning",
};

/* WHAT THE SUB LINE ONLY TOLD THE PERSON DRAWING. "As drawn" is true of every
   duct on the sheet, and a line that isn't measured says so in its quantity. */
const plainSub = (sub: string): string => sub.replace(/,? ?(as drawn|set the plan's scale to measure)$/i, "");

const isCoil = (name: string): boolean => name === "Pair coil" || name.endsWith("pair coil");

function unitRows(sys: DesignSystem, units: PaperUnit[], pack: DataPack | null, basis: SizingBasis): MaterialRow[] {
  const rows = new Map<string, MaterialRow & { n: number }>();
  for (const u of units) {
    const indoor = pack?.indoor_units.find((r) => r.model === u.model);
    const outdoor = pack?.outdoor_units.find((r) => r.model === u.model);
    const row = indoor ?? outdoor;
    const form = indoor ? `${lowerFirst(formFactorLabel(indoor.form_factor) ?? "")} indoor unit`.trim() : outdoor ? "outdoor unit" : null;
    const item = form && row ? `${u.model} ${form}, ${kw(sizingCapacityKw(row, basis))}` : u.model;
    const forWhat = u.rooms.length ? joinWords(u.rooms) : u.underFloorOf ? `${sys.name}, under the floor` : sys.name;
    const key = `${item}/${forWhat}`;
    const cur = rows.get(key) ?? { group: "units" as const, item, forWhat, qty: "", pending: false, n: 0 };
    cur.n += 1;
    rows.set(key, cur);
  }
  /* the outdoor first: it is what the system is */
  return [...rows.values()]
    .map(({ n, ...r }) => ({ ...r, qty: String(n) }))
    .sort((a, b) => Number(b.item.includes("outdoor unit")) - Number(a.item.includes("outdoor unit")));
}

function lineRows(doc: DesignDocument, sys: DesignSystem, s: SummarySystem): MaterialRow[] {
  const grilleRooms = grilleLineRooms(doc, sys);
  const rows: MaterialRow[] = s.lines.map((l) => {
    const pendingWord =
      l.qty === NOT_SURE_VALUE
        ? l.qty
        : l.qty !== "—"
          ? null
          : l.group === "pipe" && l.name !== "Pair coil"
            ? "Not drawn yet"
            : l.group === "pipe" || l.group === "ductwork"
              ? "Not measured yet"
              : "Not set yet";
    /* the sub of a line with no quantity is what to do about it: the word says that */
    const sub = pendingWord && l.qty === "—" ? "" : plainSub(l.sub);
    const rooms = l.group === "grilles" ? grilleRooms.get(`${l.name}/${l.sub}`) : null;
    return {
      /* a damper is a zoning part on the page, wherever it is shelved to buy */
      group: l.name === "Zone damper" ? "zoning" : SHELF_OF[l.group],
      item: sub ? `${l.name}, ${lowerFirst(sub)}` : l.name,
      forWhat: rooms?.length ? joinWords(rooms) : s.name,
      qty: pendingWord ?? l.qty,
      pending: pendingWord != null,
    };
  });
  /* A SYSTEM WITH NO RUN STILL NEEDS ITS PIPE. The takeoff lists only what is
     drawn, which is right for a pick; a document silent about the pipe reads
     as a job with none. The size is the outdoor's own connection. */
  if (s.pipeLiquidMm != null && s.pipeGasMm != null && !s.lines.some((l) => isCoil(l.name))) {
    rows.unshift({
      group: "pipework",
      item: `ø${s.pipeLiquidMm} / ø${s.pipeGasMm} pair coil`,
      forWhat: s.name,
      qty: "Not drawn yet",
      pending: true,
    });
  }
  return rows;
}

/** the notes the person wrote on the plans, floor by floor */
function notesOf(doc: DesignDocument): string[] {
  const floors = [...doc.floors].sort((a, b) => a.level - b.level);
  const out: string[] = [];
  for (const f of floors) {
    for (const o of doc.objects) {
      if (o.type !== NOTE_TYPE || o.floorId !== f.id) continue;
      const text = noteText(o).replace(/\s*\n\s*/g, " ").trim();
      if (text) out.push(`${/[.?!]$/.test(text) ? text : `${text}.`} ${floorPlace(floorDisplayName(f))}.`);
    }
  }
  return out;
}

/** The document's model. `systems` are buildSummaryModel's own, in doc order. */
export function buildPaper(
  doc: DesignDocument,
  pack: DataPack | null,
  parts: { systems: SummarySystem[]; unserved: SummaryRoomRow[]; snapshot: DesignSnapshot; basis: DesignBasis }
): SheetPaper {
  const { systems, unserved, snapshot, basis } = parts;
  const pairs = systems.flatMap((s) => {
    const sys = doc.systems.find((x) => x.id === s.systemId);
    return sys ? [{ sys, s }] : [];
  });
  const materials = pairs.flatMap(({ sys, s }) => [
    ...unitRows(sys, unitsOf(doc, sys), pack, basis.basis),
    ...lineRows(doc, sys, s),
  ]);
  return {
    figures: figuresOf(systems, snapshot, basis),
    systems: pairs.map(({ sys, s }) => paperSystem(doc, pack, sys, s)),
    unserved: unserved.map((r) => roomOf(r, null, null)),
    materials: MATERIAL_GROUPS.flatMap((g) => materials.filter((m) => m.group === g.key)),
    notes: notesOf(doc),
  };
}
