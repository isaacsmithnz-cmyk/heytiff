/* Design Studio — document schema v1.
   The design document is one serialisable JSON tree: objects + systems +
   settings + data-pack pins (design-studio-plan.md, Layer 1). Everything here
   is pure data + pure functions — no React, no canvas, no network. This file
   is the single source of truth for what a design document *is*; golden test
   fixtures serialise exactly this shape, so changes require a schema bump and
   a migration (see migrations.ts). */

export const SCHEMA_VERSION = 2;

/* ── Vertical planes (Layer 1 — placement plane) ── */
export type Plane =
  | "floor-cavity"
  | "room"
  | "ceiling-cavity"
  | "roof-cavity"
  | "external-ground"
  | "external-roof";

/* ── Geometry: rooms are polygons, units are points, runs are polylines,
      junctions are nodes. Derived values (area, length) are computed, never
      stored as truth. Coordinates are floor-plan pixels; scale converts. ── */
export type Point = { x: number; y: number };
export type Geometry =
  | { kind: "point"; at: Point; rotation?: number }
  | { kind: "polygon"; points: Point[] }
  | { kind: "polyline"; points: Point[] };

/* Every placed thing is a typed object. `type` stays open (string) so system
   modules can add object types without a schema bump; `systemId` is null for
   system-agnostic objects (rooms before assignment, annotations). */
export interface DesignObject {
  id: string;
  type: string;
  systemId: string | null;
  floorId: string;
  geometry: Geometry;
  plane: Plane;
  props: Record<string, unknown>;
}

/* ── Floors. Each floor is ONE world space with its own scale; everything
      measurable traces back to `scale` (mm per canvas unit, null until the
      floor is calibrated — blank-canvas floors get an explicit default).
      A floor can carry any number of plan *sheets* — big jobs split a level
      across east/west drawings; sheets are positioned rasters inside the
      floor's world space (schema v2). ── */
export interface PlanSheet {
  id: string;
  imageRef: string;
  pageNumber: number | null;
  name: string; // e.g. "Level 1 East"
  width: number; // natural raster size, world units
  height: number;
  x: number; // placement in the floor's world space
  y: number;
}

export interface Floor {
  id: string;
  name: string;
  level: number; // stacking order, 0 = ground
  scaleMmPerUnit: number | null;
  northDeg: number | null;
  plans: PlanSheet[];
}

/* ── Systems container (Layer 2). Owns objects via systemId. ── */
export type SystemType =
  | "split"
  | "multi-split"
  | "ducted"
  | "vrf"
  | "ventilation"
  | "sheet-metal";

export interface DesignSystem {
  id: string;
  type: SystemType;
  brand: string;
  colour: string;
  name: string;
  settings: Record<string, unknown>;
}

/* ── Job-level settings (defaults grow in later stages; keep flat). ── */
export interface DesignSettings {
  climateZone: string | null;
  buildingType: string | null;
  sizingBasis: "cooling" | "heating" | "worst-of-both";
  units: "mm" | "inch";
}

export interface DesignMeta {
  name: string;
  jobNumber: string;
  client: string;
  site: string;
  /** 'plan' = calibrated floor plans; 'blank' = blank canvas w/ explicit scale */
  mode: "plan" | "blank";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface DesignDocument {
  schemaVersion: number;
  id: string;
  meta: DesignMeta;
  settings: DesignSettings;
  floors: Floor[];
  objects: DesignObject[];
  systems: DesignSystem[];
  /** brand → data-pack version the design was built against (Stage 2 pins) */
  packPins: Record<string, string>;
}

/* ── Construction ── */

export function newId(prefix: string): string {
  // time-sortable + random tail; no external dep
  return `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createDesign(opts: {
  name: string;
  mode: DesignMeta["mode"];
  now?: string;
}): DesignDocument {
  const now = opts.now ?? new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId("dsn"),
    meta: {
      name: opts.name,
      jobNumber: "",
      client: "",
      site: "",
      mode: opts.mode,
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      climateZone: null,
      buildingType: null,
      sizingBasis: "worst-of-both",
      units: "mm",
    },
    // blank-canvas designs start with one uncalibrated floor at the explicit
    // 1:100 default (10 mm per canvas unit at 26px grid comes later — the
    // scale itself is what matters for scale honesty)
    floors:
      opts.mode === "blank"
        ? [
            {
              id: newId("flr"),
              name: "Ground floor",
              level: 0,
              scaleMmPerUnit: 10,
              northDeg: null,
              plans: [],
            },
          ]
        : [],
    objects: [],
    systems: [],
    packPins: {},
  };
}

/* ── Serialisation (the round-trip the Stage-0 lock gate tests) ── */

export function serializeDesign(doc: DesignDocument): string {
  return JSON.stringify(doc);
}

/** Structural sanity check — cheap, not exhaustive; migrations handle shape
    evolution, this guards against garbage input. */
export function isDesignDocumentShape(v: unknown): v is DesignDocument {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.schemaVersion === "number" &&
    typeof d.id === "string" &&
    typeof d.meta === "object" &&
    d.meta !== null &&
    Array.isArray(d.floors) &&
    Array.isArray(d.objects) &&
    Array.isArray(d.systems) &&
    typeof d.packPins === "object" &&
    d.packPins !== null
  );
}
