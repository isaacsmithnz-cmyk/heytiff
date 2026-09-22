/* Design Studio — the system builder's engine (spec: Studio System Builder).

   Pure functions over (document, pack): every change the builder, the tray and
   Swap make to a design, and every verdict they show. No React, no canvas.

   The model is allocations (allocations.ts): a system holds every unit it has,
   placed or not, and a unit on the plan is an object with its allocation's id.
   Each write below also keeps the settings the older engines read in step —
   `pairIdu`/`pairOdu`/`roomId` for a split, `pairOdu`/`multiOdu`/`multiIdus`
   for a multi, `roomIds` for both — so components, materials, the summary and
   the simulation keep working on a design the builder has touched.

   Scope is split and multi (the spec's scope). Other system types are left
   exactly as they are. */

import { newId, type DesignDocument, type DesignObject, type DesignSystem, type Point } from "./document";
import type { DataPack, IndoorUnit, OutdoorUnit, PairTable } from "./packs/schema";
import { allocationsOf, hasAllocations, type Allocation } from "./allocations";
import { roomAtPoint, roomCoverage, type CoverageCap } from "./coverage";
import { checkMultiCompatibility, multiCapableIdus } from "./multi";
import { outdoorReadiness } from "./packs/ready";
import { stripAttachesTo } from "./attach";
import { OVERSIZE_CAP } from "./select";
import { nextSystemColour } from "./modules";
import { ATTACHED_RUN_TYPES } from "./attach";
import { attachOf } from "./graph";
import { claimZone, claimedZoneIds, familyOf, newSystem, systemTypeFor, unclaimZone, zoneIdsOf } from "./zones";
import type { SizingBasis } from "./loads";
import type { RoomObj } from "./loads-room";
import { boundsOfPoints, pointInPolygon, polygonCentroid } from "./geometry";

export { allocationsOf, hasAllocations, type Allocation } from "./allocations";

const BRAND = "mitsubishi-electric";

/* ─────────────────────────── helpers ─────────────────────────── */

const iduRow = (pack: DataPack, model: string): IndoorUnit | null =>
  pack.indoor_units.find((u) => u.model === model) ?? null;
const oduRow = (pack: DataPack, model: string): OutdoorUnit | null =>
  pack.outdoor_units.find((u) => u.model === model) ?? null;

const isRoom = (o: DesignObject): o is RoomObj =>
  o.type === "room" && o.geometry.kind === "polygon";

function systemName(doc: DesignDocument): string {
  let n = 0;
  for (const s of doc.systems) {
    const m = /^System (\d+)$/.exec(s.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `System ${Math.max(n, doc.systems.length) + 1}`;
}

/** the settings the older engines read, derived from the allocations */
function legacyFor(sys: DesignSystem, allocs: Allocation[]): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...sys.settings, allocations: allocs };
  for (const k of ["pairIdu", "pairOdu", "roomId", "multiIdus", "multiOdu", "roomIds"]) {
    delete settings[k];
  }
  const odu = allocs.find((a) => a.role === "odu");
  const heads = allocs.filter((a) => a.role === "idu" && a.model);
  const rooms: string[] = [...claimedZoneIds(sys)];
  for (const h of heads) if (h.roomId && !rooms.includes(h.roomId)) rooms.push(h.roomId);
  settings.roomIds = rooms;
  if (sys.type === "split" || sys.type === "ducted") {
    const idu = heads[0];
    if (idu) settings.pairIdu = idu.model;
    if (odu?.model) settings.pairOdu = odu.model;
    if (idu?.roomId) settings.roomId = idu.roomId;
  } else {
    if (odu?.model) {
      settings.pairOdu = odu.model;
      settings.multiOdu = odu.model;
    }
    const perRoom: Record<string, string> = {};
    for (const h of heads) if (h.roomId && !(h.roomId in perRoom)) perRoom[h.roomId] = h.model;
    settings.multiIdus = perRoom;
  }
  return settings;
}

/** the system with these allocations: its type is what they say it is
    (zones.ts systemTypeFor), and the older settings follow from that */
function withAllocations(sys: DesignSystem, allocs: Allocation[], pack: DataPack | null = null): DesignSystem {
  const typed: DesignSystem = { ...sys, type: systemTypeFor(sys, allocs, pack) };
  return { ...typed, settings: legacyFor(typed, allocs) };
}

function mapSystem(
  doc: DesignDocument,
  systemId: string,
  fn: (s: DesignSystem) => DesignSystem
): DesignDocument {
  return { ...doc, systems: doc.systems.map((s) => (s.id === systemId ? fn(s) : s)) };
}

/** carry a model change onto the placed object of the same id, if any */
function restampPlaced(doc: DesignDocument, pack: DataPack, a: Allocation): DesignDocument {
  if (!doc.objects.some((o) => o.id === a.id)) return doc;
  const spec = a.role === "idu" ? iduRow(pack, a.model) : oduRow(pack, a.model);
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (o.id !== a.id) return o;
      const props: Record<string, unknown> = { ...o.props, role: a.role };
      if (a.model) props.model = a.model;
      if (spec?.width_mm) props.widthMm = spec.width_mm;
      if (spec?.depth_mm) props.depthMm = spec.depth_mm;
      if (a.role === "idu") {
        if (a.roomId) props.roomId = a.roomId;
        else delete props.roomId;
      }
      return { ...o, props };
    }),
  };
}

function withPin(doc: DesignDocument, pack: DataPack): DesignDocument {
  return {
    ...doc,
    packPins: { ...doc.packPins, [BRAND]: doc.packPins[BRAND] ?? pack.meta.version },
  };
}

/* ─────────────────────────── outdoors (R12) ─────────────────────────── */

/** a finding that means the book's check could not be made */
const UNCHECKABLE = new Set(["index-unknown", "capacity-code-unknown", "no-rule"]);

/** Multi outdoors whose book lists this set of heads, smallest first. Every
    head must be one the outdoor's rule accepts, and nothing about the set can
    be red or unverifiable. Port sizes never enter into it (spec R5). */
export function outdoorsListing(pack: DataPack, heads: IndoorUnit[]): OutdoorUnit[] {
  const out: OutdoorUnit[] = [];
  for (const odu of pack.outdoor_units) {
    if (odu.system_type !== "multi") continue;
    if (!outdoorReadiness(pack, odu).roles.multi) continue;
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
    if (!rule || odu.ports == null) continue;
    if (heads.length) {
      const capable = new Set(multiCapableIdus(pack, [rule]).map((u) => u.model));
      if (!heads.every((h) => capable.has(h.model))) continue;
    }
    const findings = checkMultiCompatibility(rule, odu, heads);
    if (findings.some((f) => f.severity === "red" || UNCHECKABLE.has(f.code))) continue;
    out.push(odu);
  }
  /* two outdoors of one size: the one with more ports, then the longer pipe run */
  const runM = (o: OutdoorUnit) =>
    pack.multi_rules.find((r) => r.odu_model_ref === o.model)?.max_total_pipe_m ?? 0;
  out.sort(
    (a, b) =>
      a.capacity_cool_kw - b.capacity_cool_kw ||
      (b.ports ?? 0) - (a.ports ?? 0) ||
      runM(b) - runM(a) ||
      a.model.localeCompare(b.model)
  );
  return out;
}

/** The proposal. A multi takes the smallest outdoor whose book lists its
    heads; a split or a ducted unit takes its pairing from the book; nothing
    in the system means no outdoor. A one-head system whose family is multi
    (two zones claimed) is proposed a multi outdoor, so the set can grow.
    An outdoor picked by hand stays, listed or not, until Use the proposal
    hands the choice back (useProposal) — the picker shows Valid or Fails
    against it instead. */
/** what the proposal would put on a system, hand pick or not: "" when
    nothing in it asks for an outdoor */
export function proposedOutdoorModel(doc: DesignDocument, pack: DataPack, systemId: string): string {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys || (sys.type !== "multi-split" && sys.type !== "split" && sys.type !== "ducted")) return "";
  const allocs = allocationsOf(sys);
  const heads = allocs
    .filter((a) => a.role === "idu" && a.model)
    .map((a) => iduRow(pack, a.model))
    .filter((u): u is IndoorUnit => u != null);
  const current = allocs.find((a) => a.role === "odu");
  if (heads.length === 0) return "";
  if (sys.type !== "ducted" && (heads.length >= 2 || familyOf(sys) === "multi")) {
    return outdoorsListing(pack, heads)[0]?.model ?? "";
  }
  const pair = pairFor(pack, heads[0].model, current ? oduRow(pack, current.model) : null);
  return pair?.odu_model ?? "";
}

function proposeOutdoor(doc: DesignDocument, pack: DataPack, systemId: string): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys || (sys.type !== "multi-split" && sys.type !== "split" && sys.type !== "ducted")) return doc;
  const allocs = allocationsOf(sys);
  const current = allocs.find((a) => a.role === "odu");
  const byHand = sys.settings.oduChosen === true && Boolean(current?.model);
  const model = byHand ? current!.model : proposedOutdoorModel(doc, pack, systemId);
  if (current && current.model === model) return doc;
  if (!current && !model) return doc;

  const odu: Allocation = current
    ? { ...current, model }
    : { id: newId("obj"), role: "odu", model, roomId: null };
  const next = current ? allocs.map((a) => (a.id === odu.id ? odu : a)) : [...allocs, odu];
  let d = mapSystem(doc, systemId, (s) => withAllocations(s, next, pack));
  if (model) d = restampPlaced(d, pack, odu);
  else d = { ...d, objects: stripAttachesTo(d.objects.filter((o) => o.id !== odu.id), new Set([odu.id])) };
  return d;
}

/** hand the outdoor choice back to the proposal */
export function useProposal(doc: DesignDocument, pack: DataPack, systemId: string): DesignDocument {
  const d = mapSystem(doc, systemId, (s) => {
    const settings = { ...s.settings };
    delete settings.oduChosen;
    return { ...s, settings };
  });
  return proposeOutdoor(d, pack, systemId);
}

/** pick an outdoor by hand — kept until its book no longer lists the set */
export function chooseOutdoor(
  doc: DesignDocument,
  pack: DataPack,
  _basis: SizingBasis,
  systemId: string,
  model: string
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const allocs = allocationsOf(sys);
  const current = allocs.find((a) => a.role === "odu");
  const odu: Allocation = current
    ? { ...current, model }
    : { id: newId("obj"), role: "odu", model, roomId: null };
  const next = current ? allocs.map((a) => (a.id === odu.id ? odu : a)) : [...allocs, odu];
  const d = mapSystem(doc, systemId, (s) => {
    const updated = withAllocations(s, next, pack);
    updated.settings.oduChosen = true;
    return updated;
  });
  return restampPlaced(d, pack, odu);
}

/* ─────────────────────────── zones and heads ─────────────────────────── */

/** the one door for a head dragged onto a zone card. The zone is claimed if
    it was not, the head serves it, and the units say what the system is:
    the first head makes a split with its pairing (or a multi's first head,
    when the zones say multi); a second head on a split turns it into a multi
    and the outdoor list to multis; a head on a multi joins it. */
export function addHead(
  doc: DesignDocument,
  pack: DataPack,
  opts: { systemId: string; zoneId: string; iduModel: string }
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === opts.systemId);
  if (!sys || !iduRow(pack, opts.iduModel)) return doc;
  const head: Allocation = { id: newId("obj"), role: "idu", model: opts.iduModel, roomId: opts.zoneId };
  let d = claimZone(doc, sys.id, opts.zoneId);
  d = mapSystem(d, sys.id, (s) => withAllocations(s, [...allocationsOf(s), head], pack));
  return proposeOutdoor(withPin(d, pack), pack, sys.id);
}

/** a unit dropped on the band above the zones serves the whole system: a
    ducted indoor unit there makes the system ducted, and its outdoor is the
    book's pairing */
export function addBandUnit(
  doc: DesignDocument,
  pack: DataPack,
  opts: { systemId: string; iduModel: string }
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === opts.systemId);
  if (!sys || !iduRow(pack, opts.iduModel)) return doc;
  const unit: Allocation = {
    id: newId("obj"),
    role: "idu",
    model: opts.iduModel,
    roomId: null,
    serves: "system",
  };
  const d = mapSystem(doc, sys.id, (s) => withAllocations(s, [...allocationsOf(s), unit], pack));
  return proposeOutdoor(withPin(d, pack), pack, sys.id);
}

/** the short zone's slot on a split: Add another split. The head dropped
    there comes with its own outdoor, as a second system over the same zone. */
export function addSplitBeside(
  doc: DesignDocument,
  pack: DataPack,
  opts: { zoneId: string; iduModel: string }
): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, pack.meta.version);
  const d = claimZone(made.doc, made.systemId, opts.zoneId);
  return { doc: addHead(d, pack, { systemId: made.systemId, zoneId: opts.zoneId, iduModel: opts.iduModel }), systemId: made.systemId };
}

/** the cross on a zone: the zone leaves the system, and the system's units
    in it go with it — off the plan, with their pipework's ends let go. The
    system stays, with whatever zones and units it has left. */
export function removeZone(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string,
  zoneId: string
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const gone = new Set(
    allocationsOf(sys)
      .filter((a) => a.role === "idu" && a.roomId === zoneId)
      .map((a) => a.id)
  );
  let d = unclaimZone(doc, systemId, zoneId);
  if (gone.size) {
    d = mapSystem(d, systemId, (s) =>
      withAllocations(s, allocationsOf(s).filter((a) => !gone.has(a.id)), pack)
    );
    d = { ...d, objects: stripAttachesTo(d.objects.filter((o) => !gone.has(o.id)), gone) };
  }
  return proposeOutdoor(d, pack, systemId);
}

/** a zone dragged from one system's card onto another's: it moves with its
    units and their runs. A run's far end, on the old system's outdoor, comes
    loose — the run keeps its drawing, in the new system, until it is dragged
    onto the new outdoor. Both systems have their outdoors proposed again. */
export function moveZone(
  doc: DesignDocument,
  pack: DataPack,
  zoneId: string,
  fromSystemId: string,
  toSystemId: string
): DesignDocument {
  if (fromSystemId === toSystemId) return doc;
  const from = doc.systems.find((s) => s.id === fromSystemId);
  const to = doc.systems.find((s) => s.id === toSystemId);
  if (!from || !to) return doc;
  const moving = allocationsOf(from).filter((a) => a.role === "idu" && a.roomId === zoneId);
  const movingIds = new Set(moving.map((a) => a.id));
  let d = claimZone(doc, toSystemId, zoneId);
  d = unclaimZone(d, fromSystemId, zoneId);
  d = mapSystem(d, fromSystemId, (s) =>
    withAllocations(s, allocationsOf(s).filter((a) => !movingIds.has(a.id)), pack)
  );
  d = mapSystem(d, toSystemId, (s) => withAllocations(s, [...allocationsOf(s), ...moving], pack));
  d = {
    ...d,
    objects: d.objects.map((o) => {
      if (movingIds.has(o.id)) return { ...o, systemId: toSystemId };
      if (o.systemId !== fromSystemId || !ATTACHED_RUN_TYPES.has(o.type)) return o;
      const start = attachOf(o.props.startAttach);
      const end = attachOf(o.props.endAttach);
      const onMoved = (start != null && movingIds.has(start.id)) || (end != null && movingIds.has(end.id));
      if (!onMoved) return o;
      const props = { ...o.props };
      if (start && !movingIds.has(start.id)) delete props.startAttach;
      if (end && !movingIds.has(end.id)) delete props.endAttach;
      return { ...o, systemId: toSystemId, props };
    }),
  };
  d = proposeOutdoor(d, pack, fromSystemId);
  return proposeOutdoor(d, pack, toSystemId);
}

/** the plan's zones a system does not have yet: the ones without a system
    first, then zones on another system, which it would share */
export function zonesToAdd(
  doc: DesignDocument,
  systemId: string
): { zone: RoomObj; sharedWith: DesignSystem[] }[] {
  const sys = doc.systems.find((s) => s.id === systemId);
  const mine = new Set(sys ? zoneIdsOf(sys) : []);
  const out: { zone: RoomObj; sharedWith: DesignSystem[] }[] = [];
  for (const o of doc.objects) {
    if (!isRoom(o) || mine.has(o.id)) continue;
    out.push({ zone: o, sharedWith: doc.systems.filter((s) => s.id !== systemId && zoneIdsOf(s).includes(o.id)) });
  }
  return out.sort((a, b) => a.sharedWith.length - b.sharedWith.length);
}

/* ─────────────────────────── building ─────────────────────────── */

/** a split pair dropped into a room: a new split serving that room, or —
    given a system — that system's pair, replacing whatever it held */
export function addSplit(
  doc: DesignDocument,
  pack: DataPack,
  opts: { roomId: string; iduModel: string; oduModel: string; systemId?: string }
): { doc: DesignDocument; systemId: string } {
  const pair: Allocation[] = [
    { id: newId("obj"), role: "idu", model: opts.iduModel, roomId: opts.roomId },
    { id: newId("obj"), role: "odu", model: opts.oduModel, roomId: null },
  ];
  const existing = opts.systemId ? doc.systems.find((s) => s.id === opts.systemId) : undefined;
  if (existing) {
    const gone = new Set(allocationsOf(existing).map((a) => a.id));
    let d = mapSystem(doc, existing.id, (s) => withAllocations({ ...s, type: "split" }, pair, pack));
    d = claimZone(d, existing.id, opts.roomId);
    if (gone.size) d = { ...d, objects: stripAttachesTo(d.objects.filter((o) => !gone.has(o.id)), gone) };
    return { doc: withPin(d, pack), systemId: existing.id };
  }
  const id = newId("sys");
  const base: DesignSystem = {
    id,
    type: "split",
    brand: BRAND,
    colour: nextSystemColour(doc.systems),
    name: systemName(doc),
    settings: {},
  };
  const sys = withAllocations(base, pair, pack);
  return { doc: withPin({ ...doc, systems: [...doc.systems, sys] }, pack), systemId: id };
}

/** a multi head dropped into a room: joins the given multi, or starts one.
    The outdoor is proposed from the set every time (R12). */
export function addMultiHead(
  doc: DesignDocument,
  pack: DataPack,
  _basis: SizingBasis,
  opts: { systemId: string | null; roomId: string; iduModel: string }
): { doc: DesignDocument; systemId: string } {
  const head: Allocation = {
    id: newId("obj"),
    role: "idu",
    model: opts.iduModel,
    roomId: opts.roomId,
  };
  /* any system may take a head: a split given a second becomes a multi */
  const existing = opts.systemId ? doc.systems.find((s) => s.id === opts.systemId) : undefined;
  let d: DesignDocument;
  let systemId: string;
  if (existing) {
    systemId = existing.id;
    d = mapSystem(doc, systemId, (s) => withAllocations(s, [...allocationsOf(s), head], pack));
  } else {
    systemId = newId("sys");
    const base: DesignSystem = {
      id: systemId,
      type: "multi-split",
      brand: BRAND,
      colour: nextSystemColour(doc.systems),
      name: systemName(doc),
      settings: {},
    };
    d = withPin({ ...doc, systems: [...doc.systems, withAllocations(base, [head], pack)] }, pack);
  }
  return { doc: proposeOutdoor(d, pack, systemId), systemId };
}

/** the builder moves a unit to another room */
export function moveAllocation(
  doc: DesignDocument,
  systemId: string,
  allocationId: string,
  roomId: string
): DesignDocument {
  let moved: Allocation | null = null;
  const d = mapSystem(doc, systemId, (s) =>
    withAllocations(
      s,
      allocationsOf(s).map((a) => {
        if (a.id !== allocationId || a.role !== "idu") return a;
        moved = { ...a, roomId };
        return moved;
      })
    )
  );
  if (!moved) return doc;
  return {
    ...d,
    objects: d.objects.map((o) =>
      o.id === allocationId ? { ...o, props: { ...o.props, roomId } } : o
    ),
  };
}

/** the builder removes a unit. A split without its pair is no split, and a
    multi with no heads is no multi — both go, and give their rooms back. */
export function removeAllocation(
  doc: DesignDocument,
  systemId: string,
  allocationId: string,
  pack?: DataPack
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const allocs = allocationsOf(sys);
  const gone = allocs.find((a) => a.id === allocationId);
  if (!gone) return doc;
  const rest = allocs.filter((a) => a.id !== allocationId);
  const zoned = Array.isArray(sys.settings.zoneIds);
  if (!zoned && (sys.type === "split" || !rest.some((a) => a.role === "idu"))) {
    return releaseSystem(doc, systemId);
  }
  let d = mapSystem(doc, systemId, (s) => withAllocations(s, rest, pack ?? null));
  if (d.objects.some((o) => o.id === allocationId)) {
    d = {
      ...d,
      objects: stripAttachesTo(
        d.objects.filter((o) => o.id !== allocationId),
        new Set([allocationId])
      ),
    };
  }
  return pack ? proposeOutdoor(d, pack, systemId) : d;
}

/** Swap: the same unit, another model. A split's outdoor follows to the
    matching pair; a multi re-proposes its outdoor from the new set. */
export function swapAllocation(
  doc: DesignDocument,
  pack: DataPack,
  _basis: SizingBasis,
  systemId: string,
  allocationId: string,
  model: string
): { doc: DesignDocument; ok: boolean; reason?: string } {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return { doc, ok: false, reason: "That system is no longer in the design." };
  const allocs = allocationsOf(sys);
  const target = allocs.find((a) => a.id === allocationId && a.role === "idu");
  if (!target) return { doc, ok: false, reason: "That unit is no longer in the design." };
  if (!iduRow(pack, model)) return { doc, ok: false, reason: `${model} isn't in the catalogue.` };

  if (sys.type === "split") {
    const odu = allocs.find((a) => a.role === "odu");
    const pair = pairFor(pack, model, odu ? oduRow(pack, odu.model) : null);
    if (!pair) return { doc, ok: false, reason: `${model} has no outdoor pairing.` };
    const idu2: Allocation = { ...target, model };
    const odu2: Allocation = odu
      ? { ...odu, model: pair.odu_model }
      : { id: newId("obj"), role: "odu", model: pair.odu_model, roomId: null };
    const next = odu
      ? allocs.map((a) => (a.id === idu2.id ? idu2 : a.id === odu2.id ? odu2 : a))
      : [...allocs.map((a) => (a.id === idu2.id ? idu2 : a)), odu2];
    let d = mapSystem(doc, systemId, (s) => withAllocations(s, next, pack));
    d = restampPlaced(d, pack, idu2);
    d = restampPlaced(d, pack, odu2);
    return { doc: d, ok: true };
  }

  const swapped: Allocation = { ...target, model };
  let d = mapSystem(doc, systemId, (s) =>
    withAllocations(
      s,
      allocs.map((a) => (a.id === swapped.id ? swapped : a)),
      pack
    )
  );
  d = restampPlaced(d, pack, swapped);
  return { doc: proposeOutdoor(d, pack, systemId), ok: true };
}

/** The outdoor a split indoor unit pairs with: the current outdoor's series
    and phase first, then its phase, then the book's first pairing. */
export function pairFor(
  pack: DataPack,
  iduModel: string,
  current: OutdoorUnit | null
): PairTable | null {
  const pairs = pack.pair_tables.filter((p) => p.idu_model === iduModel);
  if (!pairs.length) return null;
  const rank = (p: PairTable): number => {
    const o = oduRow(pack, p.odu_model);
    if (!o || !current) return 2;
    if (o.series === current.series && o.phase === current.phase) return 0;
    if (o.phase === current.phase) return 1;
    return 2;
  };
  return [...pairs].sort((a, b) => rank(a) - rank(b))[0];
}

/** delete a system: its units, runs and fittings go; its rooms stay, with
    their heat loads, belonging to the plan again */
export function releaseSystem(doc: DesignDocument, systemId: string): DesignDocument {
  const removed = new Set<string>();
  const objects: DesignObject[] = [];
  for (const o of doc.objects) {
    if (o.systemId !== systemId) {
      objects.push(o);
    } else if (isRoom(o)) {
      objects.push({ ...o, systemId: null });
    } else {
      removed.add(o.id);
    }
  }
  return {
    ...doc,
    systems: doc.systems.filter((s) => s.id !== systemId),
    objects: removed.size ? stripAttachesTo(objects, removed) : objects,
  };
}

/* ─────────────────────────── placing ─────────────────────────── */

/** put an allocated unit on the plan (or move it there): the object takes the
    allocation's id and its room, whatever room the point is in */
export function placeAllocation(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string,
  allocationId: string,
  floorId: string,
  at: Point
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  const a = sys ? allocationsOf(sys).find((x) => x.id === allocationId) : undefined;
  if (!sys || !a || !a.model) return doc;
  if (doc.objects.some((o) => o.id === a.id)) {
    return {
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === a.id ? { ...o, floorId, geometry: { kind: "point", at } } : o
      ),
    };
  }
  const size = footprint(pack, a);
  const obj: DesignObject = {
    id: a.id,
    type: "unit",
    systemId,
    floorId,
    geometry: { kind: "point", at },
    plane: a.role === "odu" ? "external-ground" : "room",
    props: {
      role: a.role,
      model: a.model,
      widthMm: size.widthMm,
      depthMm: size.depthMm,
      ...(a.roomId ? { roomId: a.roomId } : {}),
    },
  };
  return { ...doc, objects: [...doc.objects, obj] };
}

/** Where "Place in room" puts a unit, with no mode: an indoor unit just inside
    its room's top wall, an outdoor just outside its room — below it, else
    above, right or left, never inside another room (a multi's outdoor goes by
    its first head's room). Either steps sideways past units already placed, so
    two never land on one spot. Null when the unit has no room to go by. */
export function placeInRoomSpot(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string,
  allocationId: string
): { floorId: string; at: Point } | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  const a = sys ? allocationsOf(sys).find((x) => x.id === allocationId) : undefined;
  if (!sys || !a) return null;
  const roomId =
    a.roomId ?? allocationsOf(sys).find((x) => x.role === "idu" && x.roomId)?.roomId ?? null;
  const room = doc.objects.find((o): o is RoomObj => o.id === roomId && isRoom(o));
  if (!room) return null;
  const floorId = room.floorId;
  const mm = doc.floors.find((f) => f.id === floorId)?.scaleMmPerUnit || 10;
  const pts = room.geometry.points;
  const b = boundsOfPoints(pts)!;
  const c = polygonCentroid(pts);
  const size = footprint(pack, a);
  const w = (size.widthMm + 300) / mm;
  const h = (size.depthMm + 300) / mm;

  const placed = doc.objects.flatMap((o) =>
    o.type === "unit" && o.id !== a.id && o.floorId === floorId && o.geometry.kind === "point"
      ? [o.geometry.at]
      : []
  );
  const clear = (p: Point) =>
    placed.every((q) => Math.abs(q.x - p.x) >= w || Math.abs(q.y - p.y) >= h);
  /* 0, +1, -1, +2, -2 … steps either side of a start */
  const steps = [0, 1, -1, 2, -2, 3, -3, 4, -4];

  if (a.role === "idu") {
    const y = b.minY + (size.depthMm / 2 + 200) / mm;
    for (const row of [y, c.y]) {
      for (const n of steps) {
        const p = { x: c.x + n * w, y: row };
        if (pointInPolygon(p, pts) && clear(p)) return { floorId, at: p };
      }
    }
    return { floorId, at: c };
  }

  const outY = (size.depthMm / 2 + 600) / mm;
  const outX = (size.widthMm / 2 + 600) / mm;
  const sides: { at: Point; along: "x" | "y" }[] = [
    { at: { x: c.x, y: b.maxY + outY }, along: "x" },
    { at: { x: c.x, y: b.minY - outY }, along: "x" },
    { at: { x: b.maxX + outX, y: c.y }, along: "y" },
    { at: { x: b.minX - outX, y: c.y }, along: "y" },
  ];
  const along = (side: (typeof sides)[number]) =>
    steps.map((n) =>
      side.along === "x"
        ? { x: side.at.x + n * w, y: side.at.y }
        : { x: side.at.x, y: side.at.y + n * h }
    );
  const free = (p: Point) => !roomAtPoint(doc.objects, floorId, p) && clear(p);
  /* a side that backs straight onto another room is skipped while another is open */
  for (const side of sides) {
    if (roomAtPoint(doc.objects, floorId, side.at)) continue;
    const p = along(side).find(free);
    if (p) return { floorId, at: p };
  }
  for (const side of sides) {
    const p = along(side).find(free);
    if (p) return { floorId, at: p };
  }
  return { floorId, at: sides[0].at };
}

function footprint(pack: DataPack, a: Allocation): { widthMm: number; depthMm: number } {
  if (a.role === "idu") {
    const u = iduRow(pack, a.model);
    return { widthMm: u?.width_mm ?? 800, depthMm: u?.depth_mm ?? 300 };
  }
  const o = oduRow(pack, a.model);
  return { widthMm: o?.width_mm ?? 800, depthMm: o?.depth_mm ?? 300 };
}

/** A unit waiting in the tray. The label is the room it serves; a multi's
    outdoor serving two or more rooms is Shared; two systems' units with the
    same room are told apart by number. */
/** the placing payload a tray unit carries (mirrors canvas.tsx PlacingUnit) */
export interface TrayPlacing {
  role: "idu" | "odu";
  model: string;
  widthMm: number;
  depthMm: number;
  allocationId: string;
  systemId: string;
  roomId: string | null;
}

export interface TrayItem {
  key: string;
  systemId: string;
  allocationId: string;
  role: "idu" | "odu";
  model: string;
  roomId: string | null;
  label: string;
  placing: TrayPlacing;
}

export function trayItems(doc: DesignDocument, pack: DataPack): TrayItem[] {
  const roomName = (id: string | null): string => {
    if (!id) return "";
    const r = doc.objects.find((o) => o.id === id);
    return r ? String(r.props.name ?? "Room") : "";
  };
  const placed = new Set(doc.objects.map((o) => o.id));
  const items: (TrayItem & { base: string })[] = [];
  for (const sys of doc.systems) {
    if (!hasAllocations(sys)) continue;
    const allocs = allocationsOf(sys);
    const rooms: string[] = [];
    for (const a of allocs) if (a.role === "idu" && a.roomId && !rooms.includes(a.roomId)) rooms.push(a.roomId);
    for (const a of allocs) {
      if (!a.model || placed.has(a.id)) continue;
      const spec = a.role === "idu" ? iduRow(pack, a.model) : oduRow(pack, a.model);
      if (!spec) continue;
      const base =
        a.role === "idu"
          ? roomName(a.roomId) || "No room"
          : rooms.length >= 2
            ? "Shared"
            : roomName(rooms[0] ?? null) || "No room";
      const size = footprint(pack, a);
      items.push({
        key: `${sys.id}:${a.id}`,
        systemId: sys.id,
        allocationId: a.id,
        role: a.role,
        model: a.model,
        roomId: a.roomId,
        label: base,
        base,
        placing: {
          role: a.role,
          model: a.model,
          widthMm: size.widthMm,
          depthMm: size.depthMm,
          allocationId: a.id,
          systemId: sys.id,
          roomId: a.roomId,
        },
      });
    }
  }
  /* number a room's units only when two SYSTEMS share the label */
  const systemsByLabel = new Map<string, string[]>();
  for (const sys of doc.systems) {
    if (!hasAllocations(sys)) continue;
    const allocs = allocationsOf(sys);
    const rooms = new Set(allocs.filter((a) => a.role === "idu" && a.roomId).map((a) => a.roomId!));
    const names = new Set<string>();
    for (const r of rooms) names.add(roomName(r));
    if (rooms.size === 1) names.add(roomName([...rooms][0]));
    for (const n of names) {
      if (!n) continue;
      const list = systemsByLabel.get(n) ?? [];
      if (!list.includes(sys.id)) list.push(sys.id);
      systemsByLabel.set(n, list);
    }
  }
  return items.map(({ base, ...item }) => {
    const owners = systemsByLabel.get(base);
    if (base !== "Shared" && owners && owners.length > 1) {
      return { ...item, label: `${base} ${owners.indexOf(item.systemId) + 1}` };
    }
    return item;
  });
}

/** placed indoor units sitting inside a room other than the one they serve.
    Outside every room is normal — a bulkhead over a hallway — and not listed. */
export function wrongRoomPlacements(
  doc: DesignDocument
): { systemId: string; allocationId: string; roomId: string; inRoomId: string }[] {
  const out: { systemId: string; allocationId: string; roomId: string; inRoomId: string }[] = [];
  for (const sys of doc.systems) {
    if (!hasAllocations(sys)) continue;
    for (const a of allocationsOf(sys)) {
      if (a.role !== "idu" || !a.roomId) continue;
      const o = doc.objects.find((x) => x.id === a.id);
      if (!o || o.geometry.kind !== "point") continue;
      const inRoom = roomAtPoint(doc.objects, o.floorId, o.geometry.at);
      if (inRoom && inRoom.id !== a.roomId) {
        out.push({ systemId: sys.id, allocationId: a.id, roomId: a.roomId, inRoomId: inRoom.id });
      }
    }
  }
  return out;
}

/* ─────────────────────────── verdicts ─────────────────────────── */

export type RoomWord = "Fits" | "Undersized" | "Oversized" | "Calibrate" | "No units";

export interface RoomVerdict {
  word: RoomWord;
  loadKw: number | null;
  coverKw: number;
  capped: CoverageCap[];
}

/** a room's word: its units' ratings against its load, capped per system at
    that system's outdoor (R6); past one and a half times the load is Oversized */
export function roomVerdict(
  doc: DesignDocument,
  pack: DataPack,
  basis: SizingBasis,
  room: RoomObj
): RoomVerdict {
  const cov = roomCoverage(doc, pack, room, basis);
  const base = { loadKw: cov.loadKw, coverKw: cov.coveredKw, capped: cov.capped };
  if (cov.loadKw == null) return { word: "Calibrate", ...base };
  if (cov.contributors.length === 0) return { word: "No units", ...base };
  if (cov.coveredKw + 1e-9 < cov.loadKw) return { word: "Undersized", ...base };
  if (cov.coveredKw > cov.loadKw * OVERSIZE_CAP + 1e-9) return { word: "Oversized", ...base };
  return { word: "Fits", ...base };
}

export type SystemCheck =
  | {
      kind: "split";
      /** the indoor and outdoor are a pair the book lists */
      listed: boolean;
      iduModel: string;
      oduModel: string;
    }
  | {
      kind: "multi";
      /** the outdoor's book lists the set */
      listed: boolean;
      /** "" while no outdoor lists the set */
      oduModel: string;
      /** outdoors whose book lists the set, smallest first */
      alternatives: string[];
      headCount: number;
    };

export function systemCheck(
  _doc: DesignDocument,
  pack: DataPack,
  _basis: SizingBasis,
  sys: DesignSystem
): SystemCheck {
  const allocs = allocationsOf(sys);
  if (sys.type === "split") {
    const idu = allocs.find((a) => a.role === "idu")?.model ?? "";
    const odu = allocs.find((a) => a.role === "odu")?.model ?? "";
    const listed = pack.pair_tables.some((p) => p.idu_model === idu && p.odu_model === odu);
    return { kind: "split", listed, iduModel: idu, oduModel: odu };
  }
  const heads = allocs
    .filter((a) => a.role === "idu" && a.model)
    .map((a) => iduRow(pack, a.model))
    .filter((u): u is IndoorUnit => u != null);
  const alternatives = outdoorsListing(pack, heads).map((o) => o.model);
  const oduModel = allocs.find((a) => a.role === "odu")?.model ?? "";
  return {
    kind: "multi",
    listed: Boolean(oduModel) && alternatives.includes(oduModel),
    oduModel,
    alternatives,
    headCount: heads.length,
  };
}

/* ─────────────────────────── old designs ─────────────────────────── */

/** A split or multi made before the builder, turned into allocations the
    first time the builder opens on it. Placed units keep their object ids as
    allocation ids, so nothing on the plan moves or loses its pipework; rooms
    the system drew become the plan's. Other system types are left alone. */
export function adoptLegacySystem(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys || hasAllocations(sys)) return doc;
  if (sys.type !== "split" && sys.type !== "multi-split") return doc;
  const units = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const allocs: Allocation[] = [];

  if (sys.type === "split") {
    const idu = units.find((o) => o.props.role === "idu");
    const odu = units.find((o) => o.props.role === "odu");
    const iduModel = str(idu?.props.model) || str(sys.settings.pairIdu);
    const oduModel = str(odu?.props.model) || str(sys.settings.pairOdu);
    const roomId = str(idu?.props.roomId) || str(sys.settings.roomId) || null;
    if (iduModel) allocs.push({ id: idu?.id ?? newId("obj"), role: "idu", model: iduModel, roomId });
    if (oduModel) allocs.push({ id: odu?.id ?? newId("obj"), role: "odu", model: oduModel, roomId: null });
  } else {
    for (const o of units) {
      if (o.props.role !== "idu") continue;
      allocs.push({
        id: o.id,
        role: "idu",
        model: str(o.props.model),
        roomId: str(o.props.roomId) || null,
      });
    }
    const pending = sys.settings.multiIdus;
    if (pending && typeof pending === "object" && !Array.isArray(pending)) {
      for (const [roomId, model] of Object.entries(pending as Record<string, unknown>)) {
        if (typeof model !== "string" || !model) continue;
        if (allocs.some((a) => a.role === "idu" && a.roomId === roomId)) continue;
        allocs.push({ id: newId("obj"), role: "idu", model, roomId });
      }
    }
    const odu = units.find((o) => o.props.role === "odu");
    const oduModel = str(odu?.props.model) || str(sys.settings.pairOdu) || str(sys.settings.multiOdu);
    if (oduModel) allocs.push({ id: odu?.id ?? newId("obj"), role: "odu", model: oduModel, roomId: null });
  }

  const d = mapSystem(doc, systemId, (s) => {
    const updated = withAllocations(s, allocs, pack);
    if (s.type === "multi-split" && allocs.some((a) => a.role === "odu")) updated.settings.oduChosen = true;
    return updated;
  });
  return {
    ...d,
    objects: d.objects.map((o) => (isRoom(o) && o.systemId === systemId ? { ...o, systemId: null } : o)),
  };
}
