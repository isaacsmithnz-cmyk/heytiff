/* Zones and systems (the flow Isaac set out on 2026-09-18; the rules are in
   docs/studio-zones-and-systems.md).

   A ZONE is drawn on the plan and belongs to the plan, not to a system. A
   system CLAIMS zones: the claim is made BEFORE any unit is chosen, by
   clicking the zones on the plan, and it is the system's own list. A zone may
   be claimed by two systems — a 14 kW living area on two splits is two
   systems over one zone — so the claim is a list on each system, never a
   pointer on the zone.

   The system's TYPE is never asked for. It is read from what the builder put
   in it (systemTypeFor below) every time the builder writes, and written
   onto `type` so every engine that reads `sys.type` — modules, coverage,
   components, the summary — keeps working as it does today. The FAMILY of
   outdoor the builder lists (split, multi, VRF) is a starting point, from the
   zones claimed, and never a lock.

   The claim lives in `settings.zoneIds`, and `settings.roomIds` (which
   coverage's roomsServedBy already reads) is kept as the union of the claim
   and the rooms its units serve. The unit-moving writes (removeZone,
   moveZone) live in builder.ts, beside the other allocation writes. */

import { newId, type DesignDocument, type DesignObject, type DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import { allocationsOf, hasAllocations, type Allocation } from "./allocations";
import { nextSystemColour } from "./modules";
import type { RoomObj } from "./loads-room";

const isRoom = (o: DesignObject): o is RoomObj =>
  o.type === "room" && o.geometry.kind === "polygon";

const listOf = (sys: DesignSystem, key: "zoneIds" | "roomIds"): string[] => {
  const v = sys.settings[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** the zones a system has claimed, in the order they were clicked */
export const zoneIdsOf = (sys: DesignSystem): string[] => listOf(sys, "zoneIds");

/** whether a system belongs to the zones flow at all (a claim list exists,
    empty or not); older systems have none and keep their older behaviour */
export const isZoned = (sys: DesignSystem): boolean => Array.isArray(sys.settings.zoneIds);

/** every zone on the plan, in plan order (the document's own order) */
export const zonesOf = (doc: DesignDocument): RoomObj[] => doc.objects.filter(isRoom);

/** the zones of one system, as objects; ids with no zone left are dropped */
export function systemZones(doc: DesignDocument, systemId: string): RoomObj[] {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return [];
  const ids = zoneIdsOf(sys);
  return ids
    .map((id) => doc.objects.find((o) => o.id === id && isRoom(o)))
    .filter((o): o is RoomObj => o != null);
}

/** every system that claims this zone — two is normal (two splits, one room) */
export const systemsForZone = (doc: DesignDocument, zoneId: string): DesignSystem[] =>
  doc.systems.filter((s) => zoneIdsOf(s).includes(zoneId));

/** zones no system has claimed */
export const unclaimedZones = (doc: DesignDocument): RoomObj[] =>
  zonesOf(doc).filter((z) => systemsForZone(doc, z.id).length === 0);

/** the rooms a system serves: the zones it claimed, plus any room its units
    were given (they are the same thing in the new flow, and the union keeps a
    design built before it honest) */
export function servedRoomIds(sys: DesignSystem, zoneIds: string[], allocs?: Allocation[]): string[] {
  const out = [...zoneIds];
  const units = allocs ?? (hasAllocations(sys) ? allocationsOf(sys) : []);
  for (const a of units) {
    if (a.role === "idu" && a.roomId && !out.includes(a.roomId)) out.push(a.roomId);
  }
  return out;
}

function withZones(doc: DesignDocument, systemId: string, zoneIds: string[]): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) =>
      s.id === systemId
        ? { ...s, settings: { ...s.settings, zoneIds, roomIds: servedRoomIds(s, zoneIds) } }
        : s
    ),
  };
}

/** claim a zone for a system; claiming twice changes nothing */
export function claimZone(doc: DesignDocument, systemId: string, zoneId: string): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys || !doc.objects.some((o) => o.id === zoneId && isRoom(o))) return doc;
  const ids = zoneIdsOf(sys);
  return ids.includes(zoneId) ? doc : withZones(doc, systemId, [...ids, zoneId]);
}

/** take a zone off a system's claim list. The units the system has in that
    zone are left where they are: builder.ts's removeZone is the door that
    takes them too, and moveZone the one that carries them to another system. */
export function unclaimZone(doc: DesignDocument, systemId: string, zoneId: string): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const ids = zoneIdsOf(sys);
  return ids.includes(zoneId) ? withZones(doc, systemId, ids.filter((id) => id !== zoneId)) : doc;
}

/** claim mode's click: a claimed zone is given back, an unclaimed one taken */
export const toggleZone = (doc: DesignDocument, systemId: string, zoneId: string): DesignDocument =>
  zoneIdsOf(doc.systems.find((s) => s.id === systemId) ?? ({ settings: {} } as DesignSystem)).includes(
    zoneId
  )
    ? unclaimZone(doc, systemId, zoneId)
    : claimZone(doc, systemId, zoneId);

const BRAND = "mitsubishi-electric";

/** a system with no zones and no units, ready to be given zones. The type is
    a placeholder until the units say what it is (systemTypeFor). */
export function newSystem(
  doc: DesignDocument,
  packVersion: string
): { doc: DesignDocument; systemId: string } {
  const id = newId("sys");
  let names = 0;
  for (const s of doc.systems) {
    const m = /^System (\d+)$/.exec(s.name);
    if (m) names = Math.max(names, Number(m[1]));
  }
  const sys: DesignSystem = {
    id,
    type: "split",
    brand: BRAND,
    colour: nextSystemColour(doc.systems),
    name: `System ${Math.max(names, doc.systems.length) + 1}`,
    settings: { zoneIds: [], roomIds: [] },
  };
  return {
    doc: {
      ...doc,
      systems: [...doc.systems, sys],
      packPins: {
        ...doc.packPins,
        [BRAND]: doc.packPins[BRAND] ?? packVersion,
      },
    },
    systemId: id,
  };
}

/** rename a system; a blank name keeps the old one */
export function renameSystem(doc: DesignDocument, systemId: string, name: string): DesignDocument {
  const clean = name.trim();
  if (!clean) return doc;
  return { ...doc, systems: doc.systems.map((s) => (s.id === systemId ? { ...s, name: clean } : s)) };
}

/* ─────────────────────────── what a system is ─────────────────────────── */

/** the family of outdoor the builder lists first: a word the user may have
    picked on the trail, else what the zones say — one zone is a split, more
    are a multi. Never a lock: the units decide the type. */
export type SystemFamily = "split" | "multi" | "vrf";

export function familyOf(sys: DesignSystem): SystemFamily {
  const picked = sys.settings.family;
  if (picked === "split" || picked === "multi" || picked === "vrf") return picked;
  if (sys.type === "vrf") return "vrf";
  if (sys.type === "multi-split") return "multi";
  return zoneIdsOf(sys).length >= 2 ? "multi" : "split";
}

/** the type a system's units say it is, written onto `type` by every builder
    write. A unit serving the whole system makes it ducted; two heads, or a
    multi outdoor, make it a multi; one head a split. With nothing in it the
    family stands in, so the outdoor list and the proposal start right. Types
    the builder does not build (VRF, ventilation, sheet metal) are kept. */
export function systemTypeFor(
  sys: DesignSystem,
  allocs: Allocation[],
  pack: DataPack | null
): DesignSystem["type"] {
  if (sys.type !== "split" && sys.type !== "multi-split" && sys.type !== "ducted") return sys.type;
  const heads = allocs.filter((a) => a.role === "idu" && a.model);
  if (heads.some((a) => a.serves === "system")) return "ducted";
  if (heads.length >= 2) return "multi-split";
  const odu = allocs.find((a) => a.role === "odu" && a.model);
  if (odu && pack) {
    const row = pack.outdoor_units.find((u) => u.model === odu.model);
    if (row?.system_type === "multi") return "multi-split";
    if (row?.system_type === "vrf") return "vrf";
    if (row?.system_type === "split") return "split";
  }
  if (odu && !pack) return sys.type === "multi-split" ? "multi-split" : "split";
  return familyOf(sys) === "multi" ? "multi-split" : "split";
}

/** What a system IS, for the word on its card and in the builder's header:
    - nothing in it yet                     → "empty"
    - a unit serving the whole system       → "ducted"
    - a multi outdoor, or two or more heads → "multi"
    - one head, or a split outdoor          → "split"
    - a VRF outdoor                         → "vrf" */
export type SystemKind = "empty" | "split" | "multi" | "ducted" | "vrf";

export function systemKind(doc: DesignDocument, sys: DesignSystem): SystemKind {
  void doc;
  if (sys.type === "vrf") return "vrf";
  if (!hasAllocations(sys)) {
    // a design from before the builder: read its old settings
    if (sys.type === "ducted") return "ducted";
    const multi = sys.settings.multiIdus;
    if (multi && typeof multi === "object" && Object.keys(multi).length > 1) return "multi";
    return sys.settings.pairIdu || sys.settings.pairOdu ? "split" : "empty";
  }
  const allocs = allocationsOf(sys);
  const heads = allocs.filter((a) => a.role === "idu" && a.model);
  if (heads.some((a) => a.serves === "system")) return "ducted";
  const odu = allocs.some((a) => a.role === "odu" && a.model);
  if (heads.length === 0 && !odu) return "empty";
  if (sys.type === "ducted") return "ducted";
  if (sys.type === "multi-split") return "multi";
  return heads.length >= 2 ? "multi" : "split";
}

/** keep `sys.type` in step with what is in the system, for a system whose
    allocations were written some other way than through builder.ts */
export function retypeSystem(
  doc: DesignDocument,
  pack: DataPack | null,
  systemId: string
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const want = systemTypeFor(sys, hasAllocations(sys) ? allocationsOf(sys) : [], pack);
  if (sys.type === want) return doc;
  return { ...doc, systems: doc.systems.map((s) => (s.id === systemId ? { ...s, type: want } : s)) };
}

/** the word the panel puts beside a system's name */
export const KIND_WORD: Record<SystemKind, string> = {
  empty: "No units yet",
  split: "Split",
  multi: "Multi",
  ducted: "Ducted",
  vrf: "VRF",
};
