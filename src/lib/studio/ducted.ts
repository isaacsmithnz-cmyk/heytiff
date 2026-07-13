/* Design Studio — ducted engine (Stage 7). Step-1 slice: object-type
   conventions, the airstream reader, and the required-capacity maths the
   cockpit hero shows before an AHU is chosen. Grows through the stages in
   docs/design-studio-ducted-build-plan.md; the full contract lives in
   docs/design-studio-ducted-spec.md (§6, §13). Pure data — no React. */

import type { DesignDocument, DesignSystem } from "./document";
import { roomLoadKw } from "./loads-room";
import { roomsServedBy } from "./coverage";

/* ── Object conventions (spec §13) — placed via the component palette ── */

export const DUCTED_OBJECT_TYPES = [
  "grille",
  "duct-run",
  "duct-fitting",
  "plenum",
  "controller",
] as const;
export type DuctedObjectType = (typeof DUCTED_OBJECT_TYPES)[number];

export function isDuctedObjectType(t: string): t is DuctedObjectType {
  return (DUCTED_OBJECT_TYPES as readonly string[]).includes(t);
}

/** Airstreams are open data (spec §11.2): supply/return now, fresh/exhaust
    when ventilation lands. The reader accepts any non-empty string;
    consumers branch on the ones they know. */
export function streamOf(props: Record<string, unknown>): string | null {
  const s = props.stream;
  return typeof s === "string" && s.length > 0 ? s : null;
}

/** Inline fitting subtype (spec §1g). */
export type FittingType = "takeoff" | "joiner" | "reducer" | "zone-motor";

export function ftypeOf(props: Record<string, unknown>): FittingType | null {
  const f = props.ftype;
  return f === "takeoff" || f === "joiner" || f === "reducer" || f === "zone-motor"
    ? f
    : null;
}

/* ── Diversity + required capacity (spec §6h; right-panel spec §4B) ── */

/** D defaults key to ZONING — 1.00 unzoned (every room can call at once;
    0.70 on an unzoned system undersizes ~30 % while reading right-sized),
    0.70 once zones exist. A stored settings.diversityFactor overrides. */
export function diversityFactor(system: DesignSystem): number {
  const stored = system.settings.diversityFactor;
  if (typeof stored === "number" && stored >= 0.4 && stored <= 1.5) return stored;
  const zones = system.settings.zones;
  return Array.isArray(zones) && zones.length > 0 ? 0.7 : 1.0;
}

export interface DuctedRequirement {
  /** max(D × Σ served-room loads, largest single room) — null until any
      served room has a derivable load */
  requiredKw: number | null;
  totalKw: number | null;
  largestKw: number | null;
  diversity: number;
  roomCount: number;
  /** rooms whose load couldn't derive (uncalibrated floor etc.) — shown as
      a grey reason, never guessed (Principle 5) */
  unknownRooms: number;
}

export function ductedRequirement(
  doc: DesignDocument,
  system: DesignSystem
): DuctedRequirement {
  const rooms = roomsServedBy(doc, system.id);
  const diversity = diversityFactor(system);
  let total = 0;
  let largest = 0;
  let known = 0;
  for (const room of rooms) {
    const kw = roomLoadKw(doc, room);
    if (kw == null) continue;
    known++;
    total += kw;
    if (kw > largest) largest = kw;
  }
  if (known === 0) {
    return {
      requiredKw: null,
      totalKw: null,
      largestKw: null,
      diversity,
      roomCount: rooms.length,
      unknownRooms: rooms.length,
    };
  }
  return {
    requiredKw: Math.max(diversity * total, largest),
    totalKw: total,
    largestKw: largest,
    diversity,
    roomCount: rooms.length,
    unknownRooms: rooms.length - known,
  };
}
