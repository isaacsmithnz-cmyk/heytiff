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
  /** max(D × Σ sized-room loads, largest single room) — null until any
      sized room has a derivable load */
  requiredKw: number | null;
  totalKw: number | null;
  largestKw: number | null;
  diversity: number;
  /** SIZED rooms (spill rooms excluded) */
  roomCount: number;
  /** sized rooms whose load couldn't derive (uncalibrated floor etc.) —
      shown as a grey reason, never guessed (Principle 5) */
  unknownRooms: number;
  /** rooms marked spill (§9c): excluded from the sums entirely — they just
      need to be somewhere air can go */
  spillRooms: number;
}

/** a room the user marked as a spill destination — no sizing expectations */
export function isSpillRoom(room: { props: Record<string, unknown> }): boolean {
  return room.props.spill === true;
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
  let spill = 0;
  for (const room of rooms) {
    if (isSpillRoom(room)) {
      spill++;
      continue;
    }
    const kw = roomLoadKw(doc, room);
    if (kw == null) continue;
    known++;
    total += kw;
    if (kw > largest) largest = kw;
  }
  const sized = rooms.length - spill;
  if (known === 0) {
    return {
      requiredKw: null,
      totalKw: null,
      largestKw: null,
      diversity,
      roomCount: sized,
      unknownRooms: sized,
      spillRooms: spill,
    };
  }
  return {
    requiredKw: Math.max(diversity * total, largest),
    totalKw: total,
    largestKw: largest,
    diversity,
    roomCount: sized,
    unknownRooms: sized - known,
    spillRooms: spill,
  };
}

/* ── Size series + units-aware formatting (spec §3d) ── */

export const SIZE_SERIES_MM = [150, 200, 250, 300, 350, 400, 450, 500] as const;

const INCH_LABEL: Record<number, string> = {
  150: '6"',
  200: '8"',
  250: '10"',
  300: '12"',
  350: '14"',
  400: '16"',
  450: '18"',
  500: '20"',
};

/** `Ø250` in mm mode, `10"` in inch mode (off-series mm sizes stay Ø-mm) */
export function formatDia(mm: number, units: "mm" | "inch"): string {
  return units === "inch" && INCH_LABEL[mm] ? INCH_LABEL[mm] : `Ø${mm}`;
}

/* ── Plenums (spec §1b) — body from the pack spec, morphed by spigots ── */

export interface PlenumSpigot {
  id: string;
  diaMm: number;
  /** parametric position along its face, 0..1 */
  t: number;
  /** front = the spigot face; sides allowed in v1, bottom reserved for risers */
  face: "front" | "left" | "right";
  /** blanking-capped (its duct was deleted) — still bought, still labelled */
  capped?: boolean;
}

/** tolerant reader for the plenum object's props.spigots list */
export function spigotsOf(props: Record<string, unknown>): PlenumSpigot[] {
  const raw = props.spigots;
  if (!Array.isArray(raw)) return [];
  const out: PlenumSpigot[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.diaMm !== "number") continue;
    out.push({
      id: o.id,
      diaMm: o.diaMm,
      t: typeof o.t === "number" ? o.t : 0.5,
      face: o.face === "left" || o.face === "right" ? o.face : "front",
      capped: o.capped === true,
    });
  }
  return out;
}

export const SPIGOT_GAP_MM = 50;

/** Even re-pack (v1 — drag-slide is a later nicety): per face, keep the
    current left-to-right order (by t) and respace to t = (i+1)/(n+1).
    Called on every spigot add/delete so the face stays tidy. */
export function distributeSpigots(spigots: PlenumSpigot[]): PlenumSpigot[] {
  const byFace = new Map<PlenumSpigot["face"], PlenumSpigot[]>();
  for (const s of spigots) {
    const arr = byFace.get(s.face) ?? [];
    arr.push(s);
    byFace.set(s.face, arr);
  }
  const packed = new Map<string, number>();
  for (const arr of byFace.values()) {
    const ordered = [...arr].sort((a, b) => a.t - b.t);
    ordered.forEach((s, i) => packed.set(s.id, (i + 1) / (ordered.length + 1)));
  }
  return spigots.map((s) => ({ ...s, t: packed.get(s.id) ?? s.t }));
}

/** is `o` a plenum anchored to the given unit? Plenums live and die with
    their AHU (spec §10.3 — the enumerating confirm arrives at Step 8), so
    every unit-deletion path filters with this. */
export function isPlenumOf(
  o: { type: string; props: Record<string, unknown> },
  unitId: string
): boolean {
  return o.type === "plenum" && o.props.unitId === unitId;
}

export interface PlenumBody {
  wMm: number;
  dMm: number;
  hMm: number | null;
  /** the flat spigot face couldn't fit the front spigots → 3-sided front */
  faceted: boolean;
  /** grey derived default — no pack spec for this unit/stream */
  derived: boolean;
  builtIn: boolean;
  /** `1550 × 350 · 3 × 14" (3-face)` — dims mm, spigots per units setting */
  label: string;
}

/** Resolve a plenum's body: pack spec wins; absent → derived default (unit
    face width × 350 mm deep, grey). Front spigots at true width + gaps
    refacet + grow the face when they no longer fit; side-face spigots never
    refacet the front. */
export function plenumBody(opts: {
  spec?: { w_mm: number; h_mm: number; d_mm: number } | "built-in" | null;
  unitWidthMm?: number | null;
  spigots: PlenumSpigot[];
  units: "mm" | "inch";
}): PlenumBody {
  const builtIn = opts.spec === "built-in";
  const spec = opts.spec != null && opts.spec !== "built-in" ? opts.spec : null;
  const derived = !builtIn && spec == null;
  const baseW = spec?.w_mm ?? opts.unitWidthMm ?? 1200;
  const dMm = spec?.d_mm ?? 350;
  const hMm = spec?.h_mm ?? null;
  const front = opts.spigots.filter((s) => s.face === "front");
  const neededW =
    front.reduce((a, s) => a + s.diaMm, 0) + SPIGOT_GAP_MM * (front.length + 1);
  const faceted = front.length > 0 && neededW > baseW;
  const wMm = faceted ? neededW : baseW;
  return {
    wMm,
    dMm,
    hMm,
    faceted,
    derived,
    builtIn,
    label: plenumLabel(wMm, dMm, opts.spigots, opts.units, faceted),
  };
}

export function plenumLabel(
  wMm: number,
  dMm: number,
  spigots: PlenumSpigot[],
  units: "mm" | "inch",
  faceted: boolean
): string {
  const counts = new Map<number, number>();
  for (const s of spigots) counts.set(s.diaMm, (counts.get(s.diaMm) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dia, n]) => `${n} × ${formatDia(dia, units)}`);
  const dims = `${Math.round(wMm)} × ${Math.round(dMm)}`;
  return `${dims}${parts.length ? ` · ${parts.join(" · ")}` : ""}${faceted ? " (3-face)" : ""}`;
}
