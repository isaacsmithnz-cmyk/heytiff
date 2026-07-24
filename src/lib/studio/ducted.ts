/* Design Studio — ducted engine (Stage 7). Step-1 slice: object-type
   conventions, the airstream reader, and the required-capacity maths the
   cockpit hero shows before an AHU is chosen. Grows through the stages in
   docs/design-studio-ducted-build-plan.md; the full contract lives in
   docs/design-studio-ducted-spec.md (§6, §13). Pure data — no React. */

import type { DesignDocument, DesignSystem } from "./document";
import { roomLoadKw } from "./loads-room";
import { roomsServedBy } from "./coverage";
import {
  hasFactorySpigots,
  isSpigotOpening,
  type OpeningSpec as PackOpeningSpec,
} from "./packs/schema";

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

/** Re-pack a face: keep the current left-to-right order (by t) and lay the
    takeoffs out as gap, Ø, gap, Ø … gap — the SAME layout the face width is
    sized for in `plenumBody`, normalised to t ∈ 0..1.

    It used to respace to t = (i+1)/(n+1), which gives every takeoff an equal
    share of the face regardless of size. With mixed diameters the wide ones
    then overran their neighbours and the spigots drew ON TOP of each other
    (a Ø250 beside a Ø150 overlapped by ~17 mm). Sizing the face by diameter
    while placing by index could never agree; now both use one layout.

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
    const span =
      ordered.reduce((a, s) => a + s.diaMm, 0) + SPIGOT_GAP_MM * (ordered.length + 1);
    let cursor = SPIGOT_GAP_MM;
    for (const s of ordered) {
      const centre = cursor + s.diaMm / 2;
      packed.set(s.id, span > 0 ? centre / span : 0.5);
      cursor += s.diaMm + SPIGOT_GAP_MM;
    }
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

/** The unit's air opening (spec §1b) — ONE definition, in the pack schema
    (both grades of factory spigot mean "no drawn plenum body"; see there). */
export type { OpeningSpec } from "./packs/schema";

/* Plan protrusion of a drawn plenum (mm). Neither is a published figure —
   both are construction defaults, and both are destined for the pack's
   components section so a brand/installer can set their own (noted
   2026-07-23, not built yet). Until then they live here as named constants
   rather than magic numbers at the call site. */

/** SUPPLY, base → V point: shallow with one takeoff, deeper as more are
    added (the fan-out needs the length). Bounded — past the cap you're
    building a transition, not a plenum. */
export const SUPPLY_PLENUM_DEPTH_MIN_MM = 200;
export const SUPPLY_PLENUM_DEPTH_MAX_MM = 300;
const SUPPLY_DEPTH_PER_EXTRA_SPIGOT_MM = 25;

/** RETURN: a shallow box on the back of the unit (field standard). */
export const RETURN_PLENUM_DEPTH_MM = 150;

/** How deep a supply plenum runs from the unit face to the spigot face.
    One duct sits at the minimum; each extra pushes it out, capped. */
export function supplyPlenumDepthMm(spigotCount: number): number {
  const extra = Math.max(0, spigotCount - 1) * SUPPLY_DEPTH_PER_EXTRA_SPIGOT_MM;
  return Math.min(SUPPLY_PLENUM_DEPTH_MAX_MM, SUPPLY_PLENUM_DEPTH_MIN_MM + extra);
}

/** Derived-default base when the data book opening is absent (Principle 5):
    ~90 % of the discharge END the plenum bolts to (the caller passes the
    unit's SHORT-end width, not its long width) — a plausible opening, NEVER
    the unit's overall width — clearly greyed until real dims are seeded. */
export function derivedOpeningWidthMm(mountFaceMm: number | null): number {
  return Math.round((mountFaceMm ?? 700) * 0.9);
}

export interface PlenumBody {
  /** base = widest edge, ON the unit (the supply/return opening width) */
  baseWMm: number;
  /** far spigot face width (seats the spigots); ≤ baseWMm unless overSpigot */
  spigotFaceWMm: number;
  /** the opening HEIGHT — how deep the duct can be where it meets the unit.
      Null when the pack has no opening for this face. Sizes the spigots (a
      takeoff can't be taller than the plenum), so it is the figure that
      belongs beside the width — NOT the plan depth. */
  openingHMm: number | null;
  /** plan protrusion from the unit face. GEOMETRY ONLY — never labelled. */
  depthMm: number;
  /** integral return — no drawn plenum */
  builtIn: boolean;
  /** factory spigots on the opening — no drawn plenum body */
  factorySpigots: boolean;
  /** grey derived default — no opening data for this unit/stream */
  derived: boolean;
  /** spigots need a face wider than the base → too many ducts for this plenum */
  overSpigot: boolean;
  /** a spigot is bigger than the opening is HIGH — it can't land on a plenum
      this shallow without oversizing it (e.g. a 250 Ø on a 150 high plenum) */
  overHeight: boolean;
  /** a plain BOX — the far face equals the base, so it draws as a rectangle
      instead of tapering. Always true for a return plenum. */
  rectangular: boolean;
  /** `1200 × 250 · 3 × 14"` — opening W × H, then spigots per units setting */
  label: string;
}

/** Resolve a plenum's body from the unit's opening.

    SUPPLY tapers: the base (widest edge) sits on the unit at the opening
    width and narrows OUTWARD to a spigot face that seats the round takeoffs
    and stays ≤ the base — when the spigots would need more, `overSpigot`
    flags "too many ducts for this plenum" (the airflow limit made geometric).

    RETURN does not. A return plenum is a plain BOX bolted to the back of the
    unit — a return-air/filter box, not a transition to round ducts — so its
    far face is the full base width and it draws as a rectangle (field
    feedback 2026-07-23). Only the supply side has spigots to narrow toward.

    No refacet, no growing past the unit (spec §1b, field feedback
    2026-07-14). */
export function plenumBody(opts: {
  opening?: PackOpeningSpec | null;
  unitWidthMm?: number | null;
  spigots: PlenumSpigot[];
  /** which side of the unit — RETURN is a box, SUPPLY tapers. Defaults to
      supply so an un-updated caller keeps the old shape rather than silently
      squaring off every plenum. */
  stream?: "supply" | "return";
}): PlenumBody {
  const builtIn = opts.opening === "built-in";
  // both grades of factory spigot (sized or bare) mean no fabricated plenum
  const factorySpigots = hasFactorySpigots(opts.opening);
  // "open" is a positive answer with no size in it, so it takes the same
  // derived-default body as an absent opening — the installer sizes the plenum.
  // A sized-spigot opening is an object too, but it carries no W×H.
  const real =
    opts.opening &&
    typeof opts.opening === "object" &&
    !isSpigotOpening(opts.opening)
      ? opts.opening
      : null;
  const derived = !builtIn && !factorySpigots && real == null;
  const baseWMm = real?.w_mm ?? derivedOpeningWidthMm(opts.unitWidthMm ?? null);
  // spigot face needs: Σ spigot widths (= their Ø) + gaps each side
  const onFace = opts.spigots.filter((s) => s.face === "front");
  const needed =
    onFace.length === 0
      ? 0
      : onFace.reduce((a, s) => a + s.diaMm, 0) + SPIGOT_GAP_MM * (onFace.length + 1);
  const overSpigot = needed > baseWMm;
  // a return box keeps its full width to the far face; supply narrows —
  // 1 spigot → a near-point (arrow), more → widens toward (never past) the base
  const rectangular = opts.stream === "return";
  const spigotFaceWMm = rectangular || overSpigot ? baseWMm : needed;
  const openingHMm = real?.h_mm ?? null;
  /* the OTHER way a duct fails to fit: a round takeoff can't be taller than
     the opening it lands on. A 150 high plenum can't take a 10" (250 Ø)
     without being oversized — the height is what decides that, which is why
     it's the figure shown beside the width. */
  const overHeight =
    openingHMm != null && opts.spigots.some((s) => s.diaMm > openingHMm);
  return {
    baseWMm,
    spigotFaceWMm,
    openingHMm,
    /* depth follows EVERY connected spigot, not just the ones on the far
       face — a plenum fed by two side takeoffs still has to run out far
       enough to reach them (field sketch 2026-07-23) */
    depthMm: rectangular
      ? RETURN_PLENUM_DEPTH_MM
      : supplyPlenumDepthMm(opts.spigots.length),
    builtIn,
    factorySpigots,
    derived,
    overSpigot,
    overHeight,
    rectangular,
    label: plenumLabel(opts.stream ?? "supply", baseWMm, openingHMm),
  };
}

/** The plan label: which plenum it is, then the OPENING as `W × H`.

    The duct sizes are NOT in here — each spigot carries its own diameter at
    the spigot, where the fitter is actually looking, instead of being rolled
    into one long bar under the plenum that has to be read back against the
    drawing to work out which duct is which.

    The plan depth is not in it either: on a drawing the two figures that
    matter are the ones the duct has to fit through, and the height is what
    sizes the spigots. An unknown height shows as a dash rather than being
    quietly dropped. */
export function plenumLabel(
  stream: "supply" | "return",
  baseWMm: number,
  openingHMm: number | null
): string {
  const h = openingHMm == null ? "—" : String(Math.round(openingHMm));
  const name = stream === "return" ? "Return" : "Supply";
  return `${name} · ${Math.round(baseWMm)} × ${h}`;
}

/* ── Plenum supply-duct count guidance (spec §6b-iii) — the spigots are the
   MAIN supply trunks off the unit (each then branches), so a small count.
   Suggested from total airflow at the supply velocity. */
export function suggestedMainDucts(
  airflowLs: number | null,
  ductCapacityLs: number
): number | null {
  if (airflowLs == null || airflowLs <= 0 || ductCapacityLs <= 0) return null;
  return Math.ceil(airflowLs / ductCapacityLs);
}
