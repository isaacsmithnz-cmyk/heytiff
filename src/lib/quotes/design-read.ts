import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { buildDesignSnapshot, buildSummaryModel, designBasis, type SummaryRoomRow, type SummarySystem } from "@/lib/studio/summary";
import { systemCover } from "@/lib/studio/coverage";
import { allocationsOf, hasAllocations } from "@/lib/studio/allocations";
import { buildSystemGraph, findPath } from "@/lib/studio/graph";
import { systemVrfTree } from "@/lib/studio/vrf-tree";
import { systemComponents } from "@/lib/studio/components";
import { blockingFindings, combinationWord, systemFindings } from "@/lib/studio/verdict";
import { shortKw } from "@/lib/studio/fit";
import { headPipeMm } from "@/lib/studio/pipe-sizes";
import { spigotsOf } from "@/lib/studio/ducted";
import { formFactorLabel } from "@/lib/studio/form-factors";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { KIND_WORD, servedRoomIds, systemKind, zoneIdsOf } from "@/lib/studio/zones";
import { dayOf } from "./session/job-sources";
import { READ_BUDGET } from "./session/read-fit";

/* WHAT TIFF READS OF A STUDIO DESIGN (Isaac, 2026-10-17, on 27 Milroy: "I
   think Tiff can already read the studio design. Or can she not?" She
   couldn't: she saw a design only as a PDF someone had put on the job, and
   then only as a picture).

   The job's design as the Studio's own Summary derives it (buildSummaryModel),
   in words and numbers for a quote: each system's kind, brand and outdoor;
   each room with its area, its design load, the unit serving it, what that
   gives it and whether it covers it (fit.ts, through the summary); the pipe
   drawn to each head (graph.ts), its size (pipe-sizes.ts), the total and the
   farthest run; the takeoff's joints, boxes and parts; a ducted system's
   zones and what's drawn of its air side; the extra refrigerant the Studio
   works out (components.ts); and what fails its checks, in its own words
   (verdict.ts). Nothing is worked out here that the Studio doesn't: every
   figure is the design's or its pack's. No geometry. Pure. */

/** One room as she reads it: what serves it in this system, and how well. */
export type DesignRoom = {
  room: string;
  floor: string;
  area_m2: number | null;
  /** the room's design load by the Studio's load method; its share where two systems serve it */
  load_kw: number | null;
  /** the unit or units serving it, by model */
  unit?: string;
  style?: string;
  /** what this system gives the room: the heads' ratings, capped at its outdoor; a ducted zone's share */
  capacity_kw?: number;
  /** judged as the Studio judges it (fit.ts): short only by 0.1 kW or more */
  covers?: "yes" | "no" | "not known";
  short_kw?: number;
  /** the pipe drawn to its head from the outdoor, and the head's pipe size */
  pipe?: string;
};

export type DesignSystemRead = {
  name: string;
  /** what the system is, as the Summary says it: "Multi-split, 3 heads on one outdoor" */
  kind: string;
  brand: string;
  outdoor: string | null;
  outdoor_kw?: number;
  /** a unit serving the whole system (a ducted unit): its model, style, rating and pipe */
  indoor?: string;
  /** the Studio's word on the combination */
  combination?: "valid" | "fails";
  load_kw: number | null;
  capacity_kw: number | null;
  covers: "yes" | "no" | "not known";
  rooms: DesignRoom[];
  pipe: { drawn: boolean; total_m?: number; farthest_m?: number; by_size?: string[]; said?: string };
  refrigerant?: string;
  precharged_kg?: number;
  /** what the Studio works out goes in on site, beyond the pre-charge */
  extra_charge_kg?: number;
  /** the charge in the Studio's words: "Pre-charged + 0.30 kg top-up", "Pre-charged, pipe not drawn" */
  charge?: string;
  /** the sheet's takeoff: joints, headers, branch boxes and the parts the install answers put on */
  takeoff?: string[];
  takeoff_not_shown?: number;
  /** a ducted system's plenums, outlets and runs as drawn */
  air_side?: string[];
  /** what fails its checks: the Studio's red findings, in its words */
  fails?: string[];
  note?: string;
};

export type DesignRead = {
  design: { id: string; name: string; saved: string; option?: string };
  basis: string;
  rooms: number;
  area_m2: number | null;
  load_kw: number | null;
  systems: DesignSystemRead[];
  rooms_with_no_system?: DesignRoom[];
  notes?: string[];
};

/** A design on a job, as the list of them says it. */
export type DesignOnJob = { id: string; name: string; saved: string };

/** What the store hands back: the job's design read, or why there's none. */
export type JobDesign =
  | { found: false; reason: string; designs?: DesignOnJob[] }
  | { found: true; read: DesignRead; others: DesignOnJob[] };

export const NO_DESIGN = "There's no Studio design linked to this job.";

const r1 = (n: number): number => Math.round(n * 10) / 10;
const oneDp = (n: number | null): number | null => (n == null ? null : r1(n));
const coversWord = (s: SummaryRoomRow["status"]): "yes" | "no" | "not known" => (s === "covered" ? "yes" : s === "under" ? "no" : "not known");

/** The design as Tiff reads it, every figure the Studio's off `pack` (the
    design's brands' packs, merged; null when none is installed). */
export function designRead(doc: DesignDocument, pack: DataPack | null): DesignRead {
  const model = buildSummaryModel(doc, pack);
  const basis = designBasis(doc);
  const snap = buildDesignSnapshot(doc);
  const floorName = new Map(doc.floors.map((f) => [f.id, f.name || `Level ${f.level}`]));

  const systems = doc.systems.flatMap((sys) => {
    const shown = model.systems.find((s) => s.systemId === sys.id);
    return shown ? [systemRead(doc, pack, sys, shown)] : [];
  });

  const notes: string[] = [];
  /* a floor not to scale has rooms with no area or load, and pipe with no length */
  for (const f of doc.floors) {
    if (f.scaleMmPerUnit != null) continue;
    if (doc.objects.some((o) => o.floorId === f.id && (o.type === "room" || o.type === "pipe-run")))
      notes.push(`${floorName.get(f.id)} isn't to scale: its rooms have no area or load, and pipe drawn on it has no length`);
  }
  if (!doc.settings.climateZone) notes.push(`The design's climate zone isn't set: its loads are on the Studio's default, zone ${basis.zone}`);
  /* with no pack nothing is credited to a room: a room a system holds is still its */
  const held = new Set(doc.systems.flatMap((s) => servedRoomIds(s, zoneIdsOf(s))));
  const unserved = pack ? model.unserved : model.unserved.filter((r) => !held.has(r.roomId));

  return {
    design: { id: doc.id, name: doc.meta.name, saved: dayOf(doc.meta.updatedAt), ...(doc.meta.variantLabel ? { option: doc.meta.variantLabel } : {}) },
    basis: `Zone ${basis.zone} (${basis.zoneCity}), ${basis.buildingLabel.toLowerCase()}, sized on ${basis.basisShort.toLowerCase()}`,
    rooms: snap.roomCount,
    area_m2: snap.areaM2,
    load_kw: snap.totalLoadKw,
    systems,
    ...(unserved.length ? { rooms_with_no_system: unserved.map((r) => ({ room: r.name, floor: r.level, area_m2: oneDp(r.areaM2), load_kw: oneDp(r.loadKw) })) } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function systemRead(doc: DesignDocument, pack: DataPack | null, sys: DesignSystem, shown: SummarySystem): DesignSystemRead {
  /* only a pack that knows the brand can check, size and charge it */
  const book = pack && pack.brands.some((b) => b.id === sys.brand) ? pack : null;
  const allocs = hasAllocations(sys) ? allocationsOf(sys) : [];
  const mine = doc.objects.filter((o) => o.systemId === sys.id);
  const oduId = allocs.find((a) => a.role === "odu")?.id ?? mine.find((o) => o.type === "unit" && o.props.role === "odu")?.id ?? null;
  const tree = book ? systemVrfTree(book, sys, doc) : null;

  /* each head's pipe from the outdoor as drawn, and its size */
  const graph = buildSystemGraph(doc.objects, doc.floors, sys.id);
  const runs: (number | null)[] = [];
  const pipeOf = (head: { id: string; model: string }): string => {
    const path = oduId ? findPath(graph, oduId, head.id) : null;
    runs.push(path?.lengthM ?? null);
    const size = book ? headPipeMm(book, sys, head, shown.outdoorModel, tree) : null;
    const length = !path ? "not drawn" : path.lengthM == null ? "drawn, the floor isn't to scale" : `${r1(path.lengthM)} m`;
    return [length, size ? `${size.liquidMm} / ${size.gasMm} mm` : ""].filter(Boolean).join(", ");
  };

  /* a unit serving the whole system (ducted) is the system's; a head is its room's */
  const whole = new Set(allocs.filter((a) => a.role === "idu" && a.serves === "system").map((a) => a.id));
  const cover = systemCover(doc, pack, sys, doc.settings.sizingBasis);
  const pipesSaid = (heads: { id: string; model: string }[]) => {
    const said = heads.map((h) => ({ model: h.model, said: pipeOf(h) }));
    return said.length ? { pipe: said.length === 1 ? said[0]!.said : said.map((p) => `${p.model}: ${p.said}`).join("; ") } : {};
  };
  const rooms: DesignRoom[] = book
    ? shown.rooms.map((row) => {
        const heads = (cover.rooms.find((r) => r.room.id === row.roomId)?.contributors ?? []).filter((c) => !whole.has(c.unitId));
        return {
          room: row.name,
          floor: row.level,
          area_m2: oneDp(row.areaM2),
          load_kw: oneDp(row.loadKw),
          ...(row.indoorModel ? { unit: row.indoorModel } : {}),
          ...(row.styleLabel ? { style: row.styleLabel } : {}),
          ...(row.capacityKw != null ? { capacity_kw: r1(row.capacityKw) } : {}),
          covers: coversWord(row.status),
          ...(row.status === "under" && row.loadKw != null && row.capacityKw != null ? { short_kw: shortKw(row.loadKw, row.capacityKw) } : {}),
          ...pipesSaid(heads.map((c) => ({ id: c.unitId, model: c.model }))),
        };
      })
    : /* no pack for its brand: the rooms it serves and the units in them, as
         the design holds them, with no capacity and no verdict */
      unbookedRooms(doc, sys).map(({ row, heads, whole: all }) => ({
        ...row,
        ...(heads.length || all.length ? { unit: [...heads, ...all].map((h) => h.model).join(", ") } : {}),
        covers: "not known" as const,
        ...pipesSaid(heads),
      }));
  const indoor = allocs
    .filter((a) => whole.has(a.id) && a.model)
    .map((a) => {
      const style = book ? formFactorLabel(book.indoor_units.find((u) => u.model === a.model)?.form_factor) : null;
      return [a.model, style, shown.capacityKw != null ? `${shown.capacityKw} kW` : null, `pipe ${pipeOf(a)}`].filter(Boolean).join(", ");
    });

  /* the pipe in all: a VRF's by size off its sized tree, the farthest its
     tree's; any other's farthest the longest run to a head, once every one is drawn */
  const drawn = mine.some((o) => o.type === "pipe-run");
  const bySize = shown.pipeBySize?.map((p) => `ø${p.liquidMm} / ø${p.gasMm}: ${p.m == null ? "not drawn to every head" : `${p.m} m`}`);
  const farthest = tree ? tree.farthestM : runs.length && runs.every((m) => m != null) ? Math.max(...(runs as number[])) : null;
  const pipe: DesignSystemRead["pipe"] = {
    drawn,
    ...(drawn && shown.totalPipeM != null ? { total_m: shown.totalPipeM } : {}),
    ...(drawn && shown.totalPipeM == null ? { said: "drawn, but a floor it's on isn't to scale" } : {}),
    ...(drawn && farthest != null ? { farthest_m: r1(farthest) } : {}),
    ...(bySize ? { by_size: bySize } : {}),
  };

  /* the charge as the Studio works it out (components.ts) */
  const chargeRow = book ? systemComponents(doc, book, sys, doc.settings.sizingBasis).find((c) => c.kind === "charge") : undefined;
  const pre = chargeRow?.charge?.prechargeKg ?? shown.prechargedKg;
  const extra = chargeRow?.charge?.topupKg;

  /* the sheet's takeoff, less the pipe and the top-up said above */
  const takeoff = shown.lines
    .filter((l) => !/pair coil$/i.test(l.name) && l.name !== "Additional refrigerant")
    .map((l) => `${l.name}: ${l.qty}${l.sub && l.sub !== "liquid / gas mm" ? ` (${l.sub})` : ""}`);

  const air = airSide(doc, sys);
  const fails = book ? blockingFindings(systemFindings(doc, book, sys)).map((f) => (f.fix ? `${f.message}. ${f.fix}` : f.message)) : [];
  const word = book ? combinationWord(doc, book, sys) : null;

  return {
    name: sys.name,
    /* a system with zones and no units yet is no kind of system yet */
    kind: systemKind(doc, sys) === "empty" ? KIND_WORD.empty : shown.kindLabel,
    brand: shown.brandLabel,
    outdoor: shown.outdoorModel,
    ...(shown.outdoorCapacityKw != null ? { outdoor_kw: r1(shown.outdoorCapacityKw) } : {}),
    ...(indoor.length ? { indoor: indoor.join("; ") } : {}),
    ...(word ? { combination: word === "Valid" ? ("valid" as const) : ("fails" as const) } : {}),
    load_kw: book ? shown.loadKw : null,
    capacity_kw: book ? shown.capacityKw : null,
    covers: book ? coversWord(shown.status) : "not known",
    rooms,
    pipe,
    ...(shown.refrigerant ? { refrigerant: shown.refrigerant } : {}),
    ...(pre != null ? { precharged_kg: pre } : {}),
    ...(extra != null ? { extra_charge_kg: Math.round(extra * 100) / 100 } : {}),
    ...(chargeRow?.sub ? { charge: chargeRow.sub } : {}),
    ...(takeoff.length ? { takeoff } : {}),
    ...(air.length ? { air_side: air } : {}),
    ...(fails.length ? { fails } : {}),
    ...(book ? {} : { note: `HeyTiff has no data pack for ${shown.brandLabel}: its capacities, pipe sizes and checks aren't read` }),
  };
}

/** The rooms a system serves and the units in them, as the design holds them
    (its zones, and the rooms its units were given): what can be said of a
    system without its pack, which alone rates the units. */
function unbookedRooms(doc: DesignDocument, sys: DesignSystem): { row: DesignRoom; heads: { id: string; model: string }[]; whole: { id: string; model: string }[] }[] {
  const allocs = hasAllocations(sys) ? allocationsOf(sys) : [];
  const units = allocs.length
    ? allocs.filter((a) => a.role === "idu" && a.model).map((a) => ({ id: a.id, model: a.model, roomId: a.roomId }))
    : doc.objects
        .filter((o) => o.systemId === sys.id && o.type === "unit" && o.props.role === "idu")
        .map((o) => ({ id: o.id, model: String(o.props.model ?? ""), roomId: typeof o.props.roomId === "string" ? o.props.roomId : null }));
  const whole = units.filter((u) => u.roomId == null).map(({ id, model }) => ({ id, model }));
  const floorName = new Map(doc.floors.map((f) => [f.id, f.name || `Level ${f.level}`]));
  return servedRoomIds(sys, zoneIdsOf(sys), allocs).flatMap((id) => {
    const room = doc.objects.find((o): o is RoomObj => o.id === id && o.type === "room" && o.geometry.kind === "polygon");
    if (!room) return [];
    return [
      {
        row: { room: String(room.props.name ?? "Room"), floor: floorName.get(room.floorId) ?? "", area_m2: oneDp(roomAreaM2(doc, room)), load_kw: oneDp(roomLoadKw(doc, room)) },
        heads: units.filter((u) => u.roomId === id).map(({ id: unitId, model }) => ({ id: unitId, model })),
        whole,
      },
    ];
  });
}

/** A system's air side as drawn: its plenums and their takeoffs, its
    outlets and duct runs; a ducted one says plainly when none is drawn. */
function airSide(doc: DesignDocument, sys: DesignSystem): string[] {
  const mine = doc.objects.filter((o) => o.systemId === sys.id);
  const count = (type: string, one: string, many: string) => {
    const n = mine.filter((o) => o.type === type).length;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  };
  const plenums = mine
    .filter((o) => o.type === "plenum")
    .map((o) => {
      const spigots = spigotsOf(o.props).filter((s) => !s.capped);
      const stream = o.props.stream === "return" ? "Return" : "Supply";
      return `${stream} plenum${spigots.length ? `, ${spigots.length} ${spigots.length === 1 ? "takeoff" : "takeoffs"}: ${spigots.map((s) => `Ø${s.diaMm}`).join(", ")}` : ""}`;
    });
  const outlets = [...count("grille", "grille", "grilles"), ...count("duct-run", "duct run", "duct runs"), ...count("duct-fitting", "duct fitting", "duct fittings")];
  if (sys.type !== "ducted") return [...plenums, ...outlets];
  return [...plenums, ...(outlets.length ? outlets : ["No outlets, duct runs or return grille drawn"])];
}

/** A system named only, when the read is one system at a time. */
export type SystemNamed = { name: string; kind: string; outdoor: string | null; rooms: number; read_with: { system: string } };

export type FittedDesignRead<T extends DesignRead> = Omit<T, "systems"> & { systems: (DesignSystemRead | SystemNamed)[]; read_with?: string };

/** The read as it is when it fits what a tool can hand her (read-fit.ts);
    else without the takeoffs, counted; else one system whole, `ask.system`
    or the first, the others by name to read next. */
export function fitDesignRead<T extends DesignRead>(read: T, ask: { system?: string | null } = {}, budget = READ_BUDGET): FittedDesignRead<T> {
  const size = (v: unknown) => JSON.stringify(v).length;
  const want = (ask.system ?? "").trim().toLowerCase();
  if (!want && size(read) <= budget) return read;
  const lean = (s: DesignSystemRead): DesignSystemRead => {
    if (!s.takeoff) return s;
    const { takeoff, ...rest } = s;
    return { ...rest, takeoff_not_shown: takeoff.length };
  };
  const short = { ...read, systems: read.systems.map(lean) };
  if ((!want && size(short) <= budget) || read.systems.length === 0) return short;
  const at = Math.max(0, read.systems.findIndex((s) => s.name.toLowerCase() === want));
  const named = (s: DesignSystemRead): SystemNamed => ({ name: s.name, kind: s.kind, outdoor: s.outdoor, rooms: s.rooms.length, read_with: { system: s.name } });
  const one = (s: DesignSystemRead): FittedDesignRead<T> => ({
    ...read,
    systems: read.systems.map((x, i) => (i === at ? s : named(x))),
    ...(read.systems.length > 1 ? { read_with: "One system at a time: read another by its name (system)" } : {}),
  });
  const whole = one(read.systems[at]!);
  return size(whole) <= budget ? whole : one(lean(read.systems[at]!));
}
