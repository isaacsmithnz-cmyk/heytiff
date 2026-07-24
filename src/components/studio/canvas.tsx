"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import { Icon } from "@/components/shell/icon";
import { orientationFromWalls } from "@/lib/studio/loads";
import { roomAtPoint } from "@/lib/studio/coverage";
import { isAirCapable } from "@/lib/studio/modules";
import { attachOf } from "@/lib/studio/graph";
import {
  deleteRoomWithContents,
  moveEndpointTo,
  reconcileAttachedRuns,
  releaseRoomsFromSystems,
  roomMemberIds,
  stripAttachesTo,
  translateRoomWithContents,
} from "@/lib/studio/attach";
import {
  isPlenumOf,
  isSpillRoom,
  plenumBody,
  spigotsOf,
  distributeSpigots,
  streamOf,
  suggestedMainDucts,
  type PlenumSpigot,
} from "@/lib/studio/ducted";
import {
  hasFactorySpigots,
  spigotDiametersMm,
  spigotLabel,
  type IndoorUnit,
  type OpeningSpec,
} from "@/lib/studio/packs/schema";
import type { PlanImages } from "@/lib/studio/plans";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import { SimOverlay } from "./sim-overlay";
import {
  areaUnitsToM2,
  boundsOfPoints,
  dist,
  distToSegment,
  fitBounds,
  fitZoom,
  formatArea,
  formatMeters,
  MIN_ZOOM,
  mmPerUnitFromCalibration,
  orthoSnap,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polylineLength,
  screenToWorld,
  unitsToMeters,
  worldToScreen,
  zoomAt,
  type Viewport,
} from "@/lib/studio/geometry";

/* StudioCanvas — the SVG scene per ADR-001. Renders the document, emits
   intents via onMutate; it never mutates the document itself. World space is
   floor pixels; one <g> carries pan/zoom; strokes keep constant screen weight
   via vector-effect. */

export type CanvasTool =
  | "select"
  | "room-rect"
  | "room-poly"
  | "calibrate"
  | "set-north" // place/rotate the true-north arrow
  | "crop" // trim a plan sheet's visible region
  | "erase"
  | "arrange"
  | "place" // place a unit (armed from the system panel with a model)
  | "pipe" // refrigerant run — endpoints snap to unit/riser anchors
  | "riser"
  | "component"; // air component armed from the palette (Stage 7 — plenum first)

/** Canvas layer visibility (transient view state, not persisted). */
export interface LayerFlags {
  plan: boolean;
  units: boolean;
  pipes: boolean;
  labels: boolean;
}
export const ALL_LAYERS_ON: LayerFlags = {
  plan: true,
  units: true,
  pipes: true,
  labels: true,
};

/** Zoom controls exposed to the toolbar (rendered in the top strip). */
export interface ZoomApi {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

/** What the place tool drops on the next click (armed by the system panel). */
export interface PlacingUnit {
  role: "idu" | "odu";
  model: string;
  widthMm: number;
  depthMm: number;
}

/* ── Air components (Stage 7) — armed from the component palette. The eight
   palette kinds land across Steps 2–6; the canvas only handles the ones whose
   step has shipped (Step 2: plenum). ── */
export type AirComponentKind =
  | "takeoff"
  | "joiner"
  | "reducer"
  | "zone-motor"
  | "plenum"
  | "grille"
  | "wall-controller"
  | "zone-sensor";

/** The armed component + its HUD options (plenum: the supply⌇return toggle). */
export interface ArmedComponent {
  kind: AirComponentKind;
  stream: "supply" | "return";
}

const CLOSE_SNAP_PX = 12; // screen px to close a polygon on its first vertex
const HIT_EDGE_PX = 6;
const ERASE_HIT_PX = 14; // eraser is more forgiving than select (DUCTR parity)

/* A room drawn with the rectangle tool stays a rectangle when edited: is its
   geometry an axis-aligned box (4 corners, edges alternating H/V)? */
function isAxisAlignedRect(pts: Point[]): boolean {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const horiz = Math.abs(a.y - b.y) < 0.01;
    const vert = Math.abs(a.x - b.x) < 0.01;
    if (horiz === vert) return false; // must be exactly one of H or V
  }
  return true;
}

/* Resize a rectangle by dragging corner `i` to `p`: the opposite corner stays
   put and the two neighbours follow, so it never skews into a quad. */
function rectResize(orig: Point[], i: number, p: Point): Point[] {
  const o = orig[(i + 2) % 4]; // fixed opposite corner
  const j1 = (i + 1) % 4;
  const j3 = (i + 3) % 4;
  const next = orig.map((pt) => ({ ...pt }));
  next[i] = { x: p.x, y: p.y };
  next[(i + 2) % 4] = { x: o.x, y: o.y };
  // the neighbour sharing i's vertical edge takes P.x & O.y; the other O.x & P.y
  const j1SharesX = Math.abs(orig[j1].x - orig[i].x) <= Math.abs(orig[j1].y - orig[i].y);
  next[j1] = j1SharesX ? { x: p.x, y: o.y } : { x: o.x, y: p.y };
  next[j3] = j1SharesX ? { x: o.x, y: p.y } : { x: p.x, y: o.y };
  return next;
}

/* The to-scale footprint glyph for a unit — a recognisable shape per role
   rather than a bare box: an outdoor unit gets its condenser fan, an indoor
   unit its discharge louvres. Used both for placed units and the drag ghost, so
   the ghost previews exactly what lands. Styling (colour/dash) comes from the
   enclosing .ds-unit / .ds-place-ghost group. Exported for the print/export
   PlanFigure so paper units match the canvas exactly. */
export function unitGlyph(cx: number, cy: number, w: number, h: number, role: string, zoom: number) {
  const left = cx - w / 2;
  const top = cy - h / 2;
  const rx = 2 / zoom;
  if (role === "odu") {
    const r = Math.min(w, h) * 0.34;
    return (
      <>
        <rect x={left} y={top} width={w} height={h} rx={rx} />
        <circle cx={cx} cy={cy} r={r} className="ds-unit-detail" />
        <circle cx={cx} cy={cy} r={r * 0.16} className="ds-unit-hub" />
        {[0, 1, 2, 3].map((i) => {
          const a = (Math.PI / 2) * i + Math.PI / 4;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * r * 0.3}
              y1={cy + Math.sin(a) * r * 0.3}
              x2={cx + Math.cos(a) * r * 0.9}
              y2={cy + Math.sin(a) * r * 0.9}
              className="ds-unit-detail"
            />
          );
        })}
      </>
    );
  }
  // indoor unit — discharge louvres along the lower edge
  return (
    <>
      <rect x={left} y={top} width={w} height={h} rx={rx} />
      {[0.6, 0.72, 0.84].map((f) => (
        <line
          key={f}
          x1={left + w * 0.12}
          y1={top + h * f}
          x2={left + w * 0.88}
          y2={top + h * f}
          className="ds-unit-detail"
        />
      ))}
    </>
  );
}
const ANCHOR_SNAP_PX = 16; // screen px to snap a pipe endpoint to an anchor
const PLENUM_SNAP_PX = 20; // screen px to snap the plenum ghost onto an AHU end

/* ── Plenum plan geometry (spec §1b, field feedback 2026-07-14). All
   DIMENSIONS come from the engine (plenumBody); this only lays the resolved
   mm out in world space. The BASE (widest edge) sits ON the unit at the
   opening width. A SUPPLY plenum tapers OUTWARD to a narrow spigot face —
   1 spigot ≈ an arrow, 3–4 ≈ a trapezoid, base always widest. A RETURN
   plenum does not taper at all: it's a box on the back of the unit, so the
   engine hands back a far face equal to the base and the same code draws a
   rectangle (no special case here). Spigots are
   RECTANGLES (plan view of a round takeoff) standing off the spigot face at
   true width; side-face spigots ride the left/right edges. ── */
interface PlenumSpigotRect {
  id: string;
  /** 4 corners of the spigot rectangle (plan view of the takeoff) */
  rect: Point[];
  /** centre (cap-tick anchor + hit target) */
  cx: number;
  cy: number;
  /** outward normal — cap-tick direction */
  nx: number;
  ny: number;
  capped: boolean;
}
interface PlenumShape {
  body: Point[];
  spigots: PlenumSpigotRect[];
  labelAt: Point;
}

function plenumShape(opts: {
  /** face midpoint (on the AHU long face — air flows through the depth) */
  cx: number;
  cy: number;
  /** outward direction along y: +1 = the +y face, −1 = the −y face */
  dir: 1 | -1;
  /** half the BASE width — on the unit, the widest edge (world units) */
  baseHalf: number;
  /** half the SPIGOT-FACE width — the narrow far edge (world units, ≤ base) */
  spigotHalf: number;
  /** plan protrusion from the unit face (world units) */
  depth: number;
  spigots: (PlenumSpigot & { r: number })[];
}): PlenumShape {
  const { cx, cy, dir, baseHalf, depth } = opts;
  const y0 = cy; // base, on the unit
  const y1 = cy + dir * depth; // spigot face, outward
  const hBase = baseHalf;
  /* The far face is exactly as wide as the ducts landing ON it — no artificial
     lip. With every takeoff on the SIDES the face is nothing and the body
     closes to a true V point, which is how these are drawn by hand (field
     sketch 2026-07-23); the old 12% floor left a stub that read as a mistake. */
  const hSpig = Math.min(hBase, opts.spigotHalf);
  const stub = depth * 0.4; // how far the spigot rectangles stand off the face

  // trapezoid: WIDE at the unit (y0, ±hBase) → NARROW at the spigot face (y1, ±hSpig)
  const body: Point[] = [
    { x: cx - hBase, y: y0 },
    { x: cx - hSpig, y: y1 },
    { x: cx + hSpig, y: y1 },
    { x: cx + hBase, y: y0 },
  ];

  /* front spigots: t ∈ 0..1 left→right along the (narrow) spigot face */
  const frontAt = (t: number): Point => ({ x: cx - hSpig + t * 2 * hSpig, y: y1 });
  /* side spigots ride the left (x−) / right (x+) sloped edge, base→spigot corner */
  const sideAt = (t: number, side: "left" | "right"): Point => {
    const s = side === "left" ? -1 : 1;
    const a = { x: cx + s * hBase, y: y0 };
    const b = { x: cx + s * hSpig, y: y1 };
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  const spigots: PlenumSpigotRect[] = opts.spigots.map((s) => {
    if (s.face === "front") {
      // rectangle: Ø across the face (in x), stub outward (in y)
      const p = frontAt(s.t);
      const yOut = p.y + dir * stub;
      return {
        id: s.id,
        rect: [
          { x: p.x - s.r, y: p.y },
          { x: p.x - s.r, y: yOut },
          { x: p.x + s.r, y: yOut },
          { x: p.x + s.r, y: p.y },
        ],
        cx: p.x,
        cy: p.y + (dir * stub) / 2,
        nx: 0,
        ny: dir,
        capped: s.capped === true,
      };
    }
    // side spigot: Ø across the sloped edge (in y), stub outward (in x)
    const p = sideAt(s.t, s.face);
    const nx = s.face === "left" ? -1 : 1;
    const xOut = p.x + nx * stub;
    return {
      id: s.id,
      rect: [
        { x: p.x, y: p.y - s.r },
        { x: xOut, y: p.y - s.r },
        { x: xOut, y: p.y + s.r },
        { x: p.x, y: p.y + s.r },
      ],
      cx: p.x + (nx * stub) / 2,
      cy: p.y,
      nx,
      ny: 0,
      capped: s.capped === true,
    };
  });

  /* the label hangs below EVERYTHING, spigots included. Anchoring it to the
     body alone put it inside the takeoffs, which stand off the far face by
     `stub` — the label then read straight through the ducts it was naming. */
  const lowest = spigots.reduce(
    (lo, s) => Math.max(lo, ...s.rect.map((p) => p.y)),
    Math.max(y0, y1)
  );
  return { body, spigots, labelAt: { x: cx, y: lowest } };
}

/** the pack's air-opening for one stream of an indoor unit, or null */
function openingOf(row: IndoorUnit | null, end: "supply" | "return"): OpeningSpec | null {
  if (!row) return null;
  return (end === "return" ? row.return_opening : row.supply_opening) ?? null;
}

function defaultViewport(
  points: Point[],
  w: number,
  h: number,
  grid: number
): Viewport {
  const b = boundsOfPoints(points);
  if (b) return fitBounds(b, w, h, 60);
  // empty floor: centre the origin, one grid cell ≈ 56 screen px
  const zoom = 56 / grid;
  return { zoom, x: -w / (2 * zoom), y: -h / (2 * zoom) };
}

type Drag =
  | { kind: "pan"; startScreen: Point; origVp: Viewport }
  | { kind: "move"; id: string; startWorld: Point; orig: Point[]; memberIds: ReadonlySet<string> }
  | { kind: "vertex"; id: string; index: number; orig: Point[] }
  | { kind: "rect"; start: Point }
  | { kind: "sheet"; id: string; startWorld: Point; orig: Point }
  | { kind: "point"; id: string; startWorld: Point; orig: Point }
  | { kind: "crop"; sheetId: string; start: Point }
  | { kind: "north-move"; startWorld: Point; orig: { x: number; y: number } }
  | { kind: "north-rotate"; center: { x: number; y: number } }
  | { kind: "unit-rotate"; id: string; center: Point };

/** Re-derive every non-locked room's orientation from the new north bearing
    (DUCTR autoDetectOrientations). Manual per-room overrides (orientationLocked)
    are preserved. Pure — returns a new objects array. */
export function redetectOrientations(
  objects: DesignObject[],
  floorId: string,
  bearingDeg: number
): DesignObject[] {
  return objects.map((o) => {
    if (o.type !== "room" || o.floorId !== floorId || o.geometry.kind !== "polygon")
      return o;
    if (o.props.orientationLocked) return o;
    const walls = Array.isArray(o.props.externalWalls)
      ? (o.props.externalWalls as number[])
      : [];
    const orientation = orientationFromWalls(o.geometry.points, walls, bearingDeg);
    const props = { ...o.props };
    if (orientation) props.orientation = orientation;
    else delete props.orientation;
    return { ...o, props };
  });
}

export function StudioCanvas({
  doc,
  floor,
  tool,
  selectedId,
  onSelect,
  onMutate,
  onToolDone,
  onCalibrated,
  planImages,
  activeSystemId = null,
  placing = null,
  onPlaced,
  component = null,
  onComponentPlaced,
  iduSpec,
  onRoomCreated,
  remarkRoomId = null,
  onRemarkConsumed,
  layers = ALL_LAYERS_ON,
  grayscale = false,
  onZoomApi,
  onZoomChange,
  sim = null,
  bare = false,
}: {
  doc: DesignDocument;
  floor: Floor;
  tool: CanvasTool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onToolDone: () => void;
  /** fired when a scale calibration is confirmed (parent shows the north step) */
  onCalibrated?: () => void;
  planImages?: PlanImages;
  /** which render layers are visible (transient view state) */
  layers?: LayerFlags;
  /** desaturate + brighten the plan raster for overlay readability */
  grayscale?: boolean;
  /** receive the zoom controls so the toolbar can render them */
  onZoomApi?: (api: ZoomApi) => void;
  /** current zoom percentage, for the toolbar readout */
  onZoomChange?: (pct: number) => void;
  /** system that pipe/riser/place drawing tags objects with (Stage 4) */
  activeSystemId?: string | null;
  /** armed unit for the place tool */
  placing?: PlacingUnit | null;
  onPlaced?: () => void;
  /** armed air component for the component tool (Stage 7 — plenum first) */
  component?: ArmedComponent | null;
  onComponentPlaced?: () => void;
  /** pack-row resolver for placed indoor units — plenum specs + air
      capability come from unit DATA, never system type (ducted spec §11.1) */
  iduSpec?: (model: string) => IndoorUnit | null;
  /** a room finished wall-marking — open its configuration modal (Slice 2) */
  onRoomCreated?: (id: string) => void;
  /** request to re-enter wall-marking for an existing room (from the modal) */
  remarkRoomId?: string | null;
  onRemarkConsumed?: () => void;
  /** live simulation (Stage 12a): renders the overlay + locks editing to
      pan/zoom. The sim never mutates the document — it only reads it. */
  sim?: SimRuntime | null;
  /** chromeless: drop the editing dot grid (present mode — a clean plan). */
  bare?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /* live geometry override while dragging, committed on pointer-up so the
     autosave/history pipeline sees one mutation per gesture */
  const [liveGeom, setLiveGeom] = useState<{
    id: string;
    points: Point[];
    /** whole-room move only: the rigid delta + the units travelling along */
    dx?: number;
    dy?: number;
    memberIds?: ReadonlySet<string>;
  } | null>(null);
  const [draftPoly, setDraftPoly] = useState<Point[]>([]);
  const [draftRect, setDraftRect] = useState<{ a: Point; b: Point } | null>(null);
  /* wall-marking (DUCTR parity): after a room boundary is closed, the user
     marks which edges are external BEFORE the load modal opens. `roomId` null =
     a fresh draft (Cancel discards it); set = re-marking an existing room. */
  const [wallSelect, setWallSelect] = useState<{
    points: Point[];
    selected: Set<number>;
    roomId: string | null;
    shape?: "rect" | "poly";
  } | null>(null);
  const [calib, setCalib] = useState<{ a?: Point; b?: Point }>({});
  const [calibMeters, setCalibMeters] = useState("");
  const spaceDown = useRef(false);

  /* the canvas is scoped to the ACTIVE system — switching systems re-scopes
     the whole canvas ("System 2 resets the canvas"). Rooms, units, risers and
     runs all belong to a system now. */
  const inScope = useCallback(
    (o: DesignObject) => o.floorId === floor.id && o.systemId === activeSystemId,
    [floor.id, activeSystemId]
  );

  /* rooms render FLOOR-WIDE (all systems) so another system's spaces are
     visible drop targets; the active system's own + adopted rooms are full-
     strength, foreign ones ghosted. Geometry edits stay with the drawing
     system only. */
  const adoptedRoomIds = useMemo(() => {
    const sys = doc.systems.find((s) => s.id === activeSystemId);
    return new Set(
      Array.isArray(sys?.settings.roomIds) ? (sys!.settings.roomIds as string[]) : []
    );
  }, [doc.systems, activeSystemId]);

  const rooms = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
          o.floorId === floor.id && o.type === "room" && o.geometry.kind === "polygon"
      ),
    [doc.objects, floor.id]
  );

  /** served by the active system (drawn or adopted) — rendered full-strength */
  const roomServed = useCallback(
    (r: DesignObject) => r.systemId === activeSystemId || adoptedRoomIds.has(r.id),
    [activeSystemId, adoptedRoomIds]
  );
  /** drawn by the active system — the only rooms it may move/reshape/erase */
  const roomEditable = useCallback(
    (r: DesignObject) => r.systemId === activeSystemId,
    [activeSystemId]
  );

  const roomPoints = useCallback(
    (r: { id: string; geometry: { points: Point[] } }): Point[] =>
      liveGeom && liveGeom.id === r.id ? liveGeom.points : r.geometry.points,
    [liveGeom]
  );

  /* ── system objects on this floor (Stage 4: units, runs, risers) ── */
  const sysColour = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of doc.systems) m.set(s.id, s.colour);
    return m;
  }, [doc.systems]);

  const units = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
          inScope(o) && o.type === "unit" && o.geometry.kind === "point"
      ),
    [doc.objects, inScope]
  );
  const risers = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
          inScope(o) && o.type === "riser" && o.geometry.kind === "point"
      ),
    [doc.objects, inScope]
  );
  const runs = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "polyline"; points: Point[] } } =>
          inScope(o) && o.type === "pipe-run" && o.geometry.kind === "polyline"
      ),
    [doc.objects, inScope]
  );

  /** live position for point objects (units/risers) while dragging */
  const [livePoint, setLivePoint] = useState<{ id: string; at: Point } | null>(null);
  const pointById = useMemo(() => {
    const m = new Map<string, { id: string; geometry: { at: Point } }>();
    for (const o of [...units, ...risers]) m.set(o.id, o);
    return m;
  }, [units, risers]);
  /** live anchor for an attach target: the point object being dragged, or a
      unit travelling with a mid-drag room move; null when the target is at
      rest (render from the document) */
  const liveAnchorAt = useCallback(
    (id: string): Point | null => {
      if (livePoint && livePoint.id === id) return livePoint.at;
      if (liveGeom?.dx != null && liveGeom.memberIds?.has(id)) {
        const o = pointById.get(id);
        if (o)
          return { x: o.geometry.at.x + liveGeom.dx, y: o.geometry.at.y + (liveGeom.dy ?? 0) };
      }
      return null;
    },
    [livePoint, liveGeom, pointById]
  );
  const pointAt = useCallback(
    (o: { id: string; geometry: { at: Point } }): Point =>
      liveAnchorAt(o.id) ?? o.geometry.at,
    [liveAnchorAt]
  );
  /** run points with attached endpoints tracking a mid-drag unit/riser (or a
      unit riding a room move) — the same moveEndpointTo the commit uses, so
      the preview is pixel-equal to the committed geometry */
  const liveRunPoints = useCallback(
    (r: { props: Record<string, unknown>; geometry: { points: Point[] } }): Point[] => {
      let pts = r.geometry.points;
      const s = attachOf(r.props.startAttach);
      const sAt = s ? liveAnchorAt(s.id) : null;
      if (sAt) pts = moveEndpointTo(pts, "start", sAt);
      const e = attachOf(r.props.endAttach);
      const eAt = e ? liveAnchorAt(e.id) : null;
      if (eAt) pts = moveEndpointTo(pts, "end", eAt);
      return pts;
    },
    [liveAnchorAt]
  );

  /* pipe drafting: clicked vertices + what the first click attached to */
  const [draftPipe, setDraftPipe] = useState<Point[]>([]);
  const pipeStartAttach = useRef<{ kind: "unit" | "riser"; id: string } | null>(null);

  /** connection anchors of the active system on this floor (units + risers).
      Pipe endpoints snap to these; the nearest within range lights up BEFORE
      the click (the show-the-snap-target-first rule). */
  const anchors = useMemo(
    () =>
      [...units, ...risers]
        .filter((o) => o.systemId === activeSystemId)
        .map((o) => ({ kind: (o.type === "unit" ? "unit" : "riser") as "unit" | "riser", id: o.id, at: pointAt(o) })),
    [units, risers, activeSystemId, pointAt]
  );


  /* grid: 1 m when calibrated, 50 units otherwise; snap = quarter cells.
     Plan-backed floors get finer defaults (image px are small units). */
  const hasPlans = floor.plans.length > 0;
  const grid = floor.scaleMmPerUnit ? 1000 / floor.scaleMmPerUnit : hasPlans ? 100 : 50;
  const snapStep = floor.scaleMmPerUnit || !hasPlans ? grid / 4 : 1;
  /* north-arrow radius in WORLD units — fixed to the plan (scales with zoom)
     so it holds the size it was placed at, per the original builder */
  const northR = grid * 0.7;
  const northKnob = northR * 1.45; // distance of the rotate knob from centre

  /* stored plan sheets, resolved to short-lived signed URLs (per ref), plus
     measured sizes for migrated sheets that predate stored dimensions. */
  const [sheetUrls, setSheetUrls] = useState<Record<string, string>>({});
  const [sheetDims, setSheetDims] = useState<Record<string, { w: number; h: number }>>({});
  /* sheet position override while dragging with the arrange tool */
  const [liveSheet, setLiveSheet] = useState<{ id: string; x: number; y: number } | null>(null);
  /* live north arrow while dragging (move/rotate), committed on pointer-up */
  const [liveNorth, setLiveNorth] = useState<{ pos: { x: number; y: number }; deg: number } | null>(null);
  /* live crop rectangle while dragging a crop over a sheet */
  const [liveCrop, setLiveCrop] = useState<{ sheetId: string; a: Point; b: Point } | null>(null);
  /* live unit rotation while dragging its knob, committed on pointer-up */
  const [liveRotate, setLiveRotate] = useState<{ id: string; deg: number } | null>(null);
  const northArrow = liveNorth ?? (floor.northPos ? { pos: floor.northPos, deg: floor.northDeg ?? 0 } : null);

  /* Rotating a placed SIMPLE unit — a wall head, floor console or outdoor
     unit, which is just a glyph on the plan. Ducted AHUs are excluded: their
     orientation drives the supply/return faces, attached plenums and pipe
     endpoints, so rotating them is a separate air-side job. */
  type UnitObj = (typeof units)[number];
  const isSimpleUnit = (o: UnitObj) => !ahuRow(o);
  const unitRotDeg = (o: UnitObj) =>
    liveRotate?.id === o.id ? liveRotate.deg : o.geometry.rotation ?? 0;
  /* the rotate knob's world position: local "up" (top of the footprint plus a
     gap) turned by the unit's current angle — the same sin/-cos the north
     knob uses, so the grab target tracks the on-screen handle */
  const unitRotKnob = (o: UnitObj) => {
    const at = pointAt(o);
    const fp = footprint(Number(o.props.widthMm ?? 800), Number(o.props.depthMm ?? 300));
    const gap = fp.h / 2 + grid * 0.55;
    const rad = (unitRotDeg(o) * Math.PI) / 180;
    return {
      at,
      gap,
      knob: { x: at.x + Math.sin(rad) * gap, y: at.y - Math.cos(rad) * gap },
    };
  };

  useEffect(() => {
    let on = true;
    for (const sheet of floor.plans) {
      if (sheetUrls[sheet.imageRef] || !planImages) continue;
      void planImages
        .url(sheet.imageRef)
        .then(async (url) => {
          if (!on) return;
          setSheetUrls((m) => ({ ...m, [sheet.imageRef]: url }));
          if (!sheet.width || !sheet.height) {
            const img = new Image();
            img.src = url;
            await img.decode();
            if (on)
              setSheetDims((m) => ({
                ...m,
                [sheet.id]: { w: img.naturalWidth, h: img.naturalHeight },
              }));
          }
        })
        .catch(() => {
          /* offline or expired ref — the grid still works */
        });
    }
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.plans, planImages]);

  const sheetSize = useCallback(
    (s: { id: string; width: number; height: number }) =>
      s.width && s.height
        ? { w: s.width, h: s.height }
        : (sheetDims[s.id] ?? null),
    [sheetDims]
  );
  const sheetPos = useCallback(
    (s: { id: string; x: number; y: number }) =>
      liveSheet && liveSheet.id === s.id ? liveSheet : { x: s.x, y: s.y },
    [liveSheet]
  );

  /* viewport starts from an assumed size and re-fits once on first real
     measure (mount-time content captured in a ref — no setState in effects).
     Plan-sheet corners count as content so plan-backed floors open fitted. */
  const contentPoints = useCallback((): Point[] => {
    const pts = rooms.flatMap((r) => roomPoints(r));
    for (const s of floor.plans) {
      const dims = sheetSize(s);
      if (dims) {
        const pos = sheetPos(s);
        // a cropped sheet only counts its visible region toward fit/min-zoom,
        // so fitting frames the crop rather than the whole (mostly-empty) raster
        if (s.crop) {
          pts.push(
            { x: pos.x + s.crop.x, y: pos.y + s.crop.y },
            { x: pos.x + s.crop.x + s.crop.w, y: pos.y + s.crop.y + s.crop.h }
          );
        } else {
          pts.push({ x: pos.x, y: pos.y }, { x: pos.x + dims.w, y: pos.y + dims.h });
        }
      }
    }
    return pts;
  }, [rooms, roomPoints, floor.plans, sheetSize, sheetPos]);

  const [vp, setVp] = useState<Viewport>(() =>
    defaultViewport(contentPoints(), size.w, size.h, grid)
  );
  const mountContent = useRef({ points: contentPoints(), grid });
  const measured = useRef(false);

  /* zoom-out floor: you can't zoom out past ~fit (a little margin), so the
     drawing never shrinks into a speck. Empty floors keep the absolute min. */
  const minZoom = useMemo(() => {
    const b = boundsOfPoints(contentPoints());
    return b ? Math.max(MIN_ZOOM, fitZoom(b, size.w, size.h, 60) * 0.6) : MIN_ZOOM;
  }, [contentPoints, size.w, size.h]);
  const minZoomRef = useRef(minZoom);
  useEffect(() => {
    minZoomRef.current = minZoom;
  }, [minZoom]);

  /* zoom controls exposed to the toolbar (they live in the top strip now).
     Stable callbacks read the latest size/content via refs. */
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  const contentPointsRef = useRef(contentPoints);
  useEffect(() => {
    contentPointsRef.current = contentPoints;
  }, [contentPoints]);
  const zoomInApi = useCallback(
    () =>
      setVp((v) =>
        zoomAt(v, { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }, 1.3, minZoomRef.current)
      ),
    []
  );
  const zoomOutApi = useCallback(
    () =>
      setVp((v) =>
        zoomAt(v, { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }, 1 / 1.3, minZoomRef.current)
      ),
    []
  );
  const fitApi = useCallback(() => {
    const b = boundsOfPoints(contentPointsRef.current());
    if (b) setVp(fitBounds(b, sizeRef.current.w, sizeRef.current.h, 60));
  }, []);
  useEffect(() => {
    onZoomApi?.({ zoomIn: zoomInApi, zoomOut: zoomOutApi, fit: fitApi });
  }, [onZoomApi, zoomInApi, zoomOutApi, fitApi]);
  useEffect(() => {
    onZoomChange?.(Math.round(vp.zoom * 100));
  }, [vp.zoom, onZoomChange]);

  /** nearest connection anchor within snap range of a world point */
  const nearestAnchor = useCallback(
    (w: Point) => {
      let best: { kind: "unit" | "riser"; id: string; at: Point } | null = null;
      let bestD = ANCHOR_SNAP_PX / vp.zoom;
      for (const a of anchors) {
        const d = dist(a.at, w);
        if (d <= bestD) {
          best = a;
          bestD = d;
        }
      }
      return best;
    },
    [anchors, vp.zoom]
  );

  /** unit footprint in world units (mm → units when calibrated; a sensible
      on-screen default otherwise so placement still works pre-calibration) */
  const footprint = useCallback(
    (widthMm: number, depthMm: number): { w: number; h: number } => {
      const s = floor.scaleMmPerUnit;
      if (s) return { w: widthMm / s, h: depthMm / s };
      return { w: grid * 0.9, h: grid * 0.9 * (depthMm / Math.max(widthMm, 1)) };
    },
    [floor.scaleMmPerUnit, grid]
  );

  /* ── plenums (Stage 7 Step 2) — anchored to an AHU end; their position is
     DERIVED from the unit every render (never stored), so moving the AHU
     carries them for free. ── */
  const plenums = useMemo(
    () => doc.objects.filter((o) => inScope(o) && o.type === "plenum"),
    [doc.objects, inScope]
  );

  /** the pack row of a placed unit IF it is an air-capable air handler */
  const ahuRow = useCallback(
    (u: DesignObject): IndoorUnit | null => {
      if (String(u.props.role ?? "") !== "idu") return null;
      const row = iduSpec?.(String(u.props.model ?? "")) ?? null;
      return row && isAirCapable(row) ? row : null;
    },
    [iduSpec]
  );

  /** an AHU air face as a world segment + outward direction. Air flows
      through the DEPTH (spec §1a) — the openings are the two LONG faces
      (±y). Supply defaults to the +y face; `props.airFlip` swaps, and the
      first placed plenum writes airFlip so its face IS its stream. */
  const endFace = useCallback(
    (u: DesignObject & { geometry: { at: Point } }, end: "supply" | "return") => {
      const at = pointAt(u);
      const fp = footprint(Number(u.props.widthMm ?? 800), Number(u.props.depthMm ?? 300));
      const flip = u.props.airFlip === true;
      const dir = ((end === "supply" ? 1 : -1) * (flip ? -1 : 1)) as 1 | -1;
      const y = at.y + dir * (fp.h / 2);
      return {
        a: { x: at.x - fp.w / 2, y },
        b: { x: at.x + fp.w / 2, y },
        mid: { x: at.x, y },
        dir,
        faceHalf: fp.w / 2,
      };
    },
    [pointAt, footprint]
  );

  /** every plenum mounting face of the placed air-capable AHUs, with its
      occupancy (existing plenum, a pack built-in return, or factory spigots) */
  const ahuEnds = useMemo(() => {
    const out: {
      unit: (typeof units)[number];
      row: IndoorUnit;
      end: "supply" | "return";
      occupied: boolean;
      builtIn: boolean;
      /** factory spigots on this face — the duct connects to the unit, so no
          plenum is fabricated and the face can never take one */
      spigots: boolean;
      /** a placed plenum has fixed the orientation (spec §1a: the first
          placement decides; until then either face may take either stream) */
      determined: boolean;
    }[] = [];
    for (const u of units) {
      const row = ahuRow(u);
      if (!row) continue;
      // a placed plenum, a built-in return OR a factory-spigot face fixes the
      // orientation (spec §1a): each is a published, fixed connection, so the
      // unit knows which face is which the moment it's placed
      const builtInReturn = row.return_opening === "built-in";
      const anySpigots = (["supply", "return"] as const).some((e) =>
        hasFactorySpigots(openingOf(row, e))
      );
      const determined =
        builtInReturn || anySpigots || plenums.some((p) => p.props.unitId === u.id);
      for (const end of ["supply", "return"] as const) {
        const builtIn = end === "return" && builtInReturn;
        const spigots = hasFactorySpigots(openingOf(row, end));
        const occupied =
          builtIn ||
          spigots ||
          plenums.some((p) => p.props.unitId === u.id && p.props.end === end);
        out.push({ unit: u, row, end, occupied, builtIn, spigots, determined });
      }
    }
    return out;
  }, [units, plenums, ahuRow]);

  /** placeable face candidates for the armed plenum: the armed stream's
      current face — plus, while nothing has determined the orientation, the
      OPPOSITE face too (clicking it flips the unit so that face becomes the
      stream: the first placement decides, spec §1a) */
  const plenumCandidates = useMemo(() => {
    if (component?.kind !== "plenum") return [];
    const out: {
      e: (typeof ahuEnds)[number];
      face: ReturnType<typeof endFace>;
      needsFlip: boolean;
    }[] = [];
    const other = component.stream === "supply" ? ("return" as const) : ("supply" as const);
    for (const e of ahuEnds) {
      if (e.occupied || e.end !== component.stream) continue;
      out.push({ e, face: endFace(e.unit, e.end), needsFlip: false });
      if (!e.determined) out.push({ e, face: endFace(e.unit, other), needsFlip: true });
    }
    return out;
  }, [component, ahuEnds, endFace]);

  const nearestPlenumEnd = useCallback(
    (w: Point) => {
      let best: (typeof plenumCandidates)[number] | null = null;
      let bestD = PLENUM_SNAP_PX / vp.zoom;
      for (const c of plenumCandidates) {
        const d = distToSegment(w, c.face.a, c.face.b);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    },
    [plenumCandidates, vp.zoom]
  );

  const addPlenum = useCallback(
    (cand: (typeof plenumCandidates)[number]) => {
      if (!activeSystemId || component?.kind !== "plenum") return;
      const unitId = cand.e.unit.id;
      onMutate((d) => ({
        ...d,
        objects: [
          // clicking the opposite face while undetermined flips the unit so
          // that face becomes the armed stream (first placement decides)
          ...d.objects.map((o) =>
            cand.needsFlip && o.id === unitId
              ? { ...o, props: { ...o.props, airFlip: o.props.airFlip !== true } }
              : o
          ),
          {
            id: newId("obj"),
            type: "plenum",
            systemId: activeSystemId,
            floorId: floor.id,
            // anchored by unitId+end — the stored point is a placement
            // snapshot; rendering always derives from the unit
            geometry: { kind: "point", at: cand.face.mid },
            plane: "ceiling-cavity",
            props: { stream: component.stream, unitId, end: cand.e.end, spigots: [] },
          } satisfies DesignObject,
        ],
      }));
      onComponentPlaced?.();
    },
    [activeSystemId, component, onMutate, floor.id, onComponentPlaced]
  );

  /** resolved render geometry per plenum id (also the hit-test shape) */
  const plenumShapes = useMemo(() => {
    const m = new Map<
      string,
      PlenumShape & {
        label: string;
        derived: boolean;
        overSpigot: boolean;
        overHeight: boolean;
        unitId: string;
      }
    >();
    for (const p of plenums) {
      const unit = units.find((u) => u.id === String(p.props.unitId ?? ""));
      if (!unit) continue;
      const end = p.props.end === "return" ? ("return" as const) : ("supply" as const);
      const widthMm = Number(unit.props.widthMm ?? 800);
      const depthMm = Number(unit.props.depthMm ?? 300);
      const fp = footprint(widthMm, depthMm);
      const perMm = fp.w / Math.max(widthMm, 1); // world units per mm (works uncalibrated)
      const row = iduSpec?.(String(unit.props.model ?? "")) ?? null;
      const opening = openingOf(row, end);
      /* Re-pack on the way out, not just on add/delete. `t` is machine-
         assigned today (there is no drag-slide yet), and designs saved before
         the packing fix still carry evenly-spaced values that overlap once the
         diameters differ. Normalising here heals them without a migration —
         revisit when spigots become draggable and `t` is genuinely the
         installer's own placement. */
      const sp = distributeSpigots(spigotsOf(p.props));
      const body = plenumBody({
        opening,
        unitWidthMm: widthMm, // the mounting face is a LONG face (spec §1a)
        spigots: sp,
        units: doc.settings.units,
        stream: end, // return draws as a box; supply tapers to its spigots
      });
      if (body.builtIn || body.factorySpigots) continue; // no drawn plenum object
      const f = endFace(unit, end);
      // base = the discharge opening (a plenum box fans wider than the slim
      // unit end, so it is NOT clamped to the mounting-face length)
      const baseHalf = (body.baseWMm * perMm) / 2;
      m.set(p.id, {
        ...plenumShape({
          cx: f.mid.x,
          cy: f.mid.y,
          dir: f.dir,
          baseHalf,
          spigotHalf: (body.spigotFaceWMm * perMm) / 2,
          depth: body.depthMm * perMm,
          spigots: sp.map((s) => ({ ...s, r: (s.diaMm * perMm) / 2 })),
        }),
        label: body.label,
        derived: body.derived,
        overSpigot: body.overSpigot,
        overHeight: body.overHeight,
        unitId: unit.id,
      });
    }
    return m;
  }, [plenums, units, footprint, iduSpec, endFace, doc.settings.units]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize({ w: r.width, h: r.height });
      if (!measured.current) {
        measured.current = true;
        setVp(
          defaultViewport(
            mountContent.current.points,
            r.width,
            r.height,
            mountContent.current.grid
          )
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── coordinate helpers ── */
  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = svgRef.current?.getBoundingClientRect();
      const screen = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
      return screenToWorld(screen, vp);
    },
    [vp]
  );

  /* Placement is FREE (pixel-precise) — no grid quantization (canvas UX rule:
     "less snapping, more precise adjustment"). Only pipes ortho-snap and pipe
     endpoints snap to anchors; rect rooms still stay rectangular via rectResize. */

  /* ── zoom (native non-passive wheel so preventDefault works) ── */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      setVp((v) => zoomAt(v, screen, e.deltaY < 0 ? 1.12 : 1 / 1.12, minZoomRef.current));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ── keyboard: space-pan, Esc cancel, Delete selection ── */
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) spaceDown.current = true;
      if (e.key === "Escape") {
        setDraftPoly([]);
        setDraftRect(null);
        setCalib({});
        setCalibMeters("");
        setDraftPipe([]);
        pipeStartAttach.current = null;
        // discard an in-progress wall-marking (a fresh draft makes no room)
        setWallSelect(null);
      }
      // [ / ] rotate the selected simple unit in 90° steps
      if ((e.key === "[" || e.key === "]") && !isTyping(e) && selectedId) {
        const u = units.find((x) => x.id === selectedId);
        if (u && u.type === "unit" && !ahuRow(u) && u.geometry.kind === "point") {
          e.preventDefault();
          const step = e.key === "]" ? 90 : -90;
          onMutate((d) => ({
            ...d,
            objects: d.objects.map((o) =>
              o.id === selectedId && o.geometry.kind === "point"
                ? {
                    ...o,
                    geometry: {
                      ...o.geometry,
                      rotation: ((((o.geometry.rotation ?? 0) + step) % 360) + 360) % 360,
                    },
                  }
                : o
            ),
          }));
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping(e) && selectedId) {
        e.preventDefault();
        onMutate((d) => {
          // a room takes its units (and their plenums) with it, the same way
          // a room move carries them — and frees its id from every system
          if (d.objects.find((o) => o.id === selectedId)?.type === "room") {
            return {
              ...d,
              systems: releaseRoomsFromSystems(d.systems, new Set([selectedId])),
              objects: deleteRoomWithContents(d.objects, selectedId),
            };
          }
          // deleting an AHU carries its plenums (they're its plenums — spec
          // §10.3); runs that attached to it lose the ref and become open ends
          return {
            ...d,
            objects: stripAttachesTo(
              d.objects.filter(
                (o) => o.id !== selectedId && !isPlenumOf(o, selectedId)
              ),
              new Set([selectedId])
            ),
          };
        });
        onSelect(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selectedId, onMutate, onSelect, units, ahuRow]);

  /* ── document intents ── */
  /* A closed boundary doesn't create a room outright — it opens wall-marking
     (DUCTR: closePolygon → startWallSelect). The room is committed only when
     the user confirms which walls are external. */
  const beginWallSelect = useCallback((points: Point[], shape: "rect" | "poly") => {
    setWallSelect({ points, selected: new Set(), roomId: null, shape });
  }, []);

  const commitRoom = useCallback(
    (points: Point[], externalWalls: number[], shape?: "rect" | "poly") => {
      const id = newId("obj");
      const orientation = orientationFromWalls(
        points,
        externalWalls,
        floor.northDeg ?? 0
      );
      onMutate((d) => {
        // rooms belong to the active system (type-first flow); scoped per system
        const n =
          d.objects.filter(
            (o) => o.type === "room" && o.systemId === activeSystemId
          ).length + 1;
        const room: DesignObject = {
          id,
          type: "room",
          systemId: activeSystemId,
          floorId: floor.id,
          geometry: { kind: "polygon", points },
          plane: "room",
          props: {
            name: `Room ${n}`,
            externalWalls,
            hasExternalWalls: externalWalls.length > 0,
            // rectangle-tool rooms stay rectangular when their corners are edited
            ...(shape ? { shape } : {}),
            ...(orientation ? { orientation } : {}),
          },
        };
        return { ...d, objects: [...d.objects, room] };
      });
      // hand the fresh room to the configuration modal (load inputs)
      onRoomCreated?.(id);
    },
    [onMutate, floor.id, floor.northDeg, activeSystemId, onRoomCreated]
  );

  const confirmWallSelect = useCallback(() => {
    if (!wallSelect) return;
    const { points, selected, roomId, shape } = wallSelect;
    const walls = [...selected].sort((a, b) => a - b);
    if (roomId) {
      // re-marking an existing room: update walls + derived orientation
      const orientation = orientationFromWalls(points, walls, floor.northDeg ?? 0);
      onMutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === roomId
            ? {
                ...o,
                props: {
                  ...o.props,
                  externalWalls: walls,
                  hasExternalWalls: walls.length > 0,
                  ...(orientation ? { orientation } : {}),
                },
              }
            : o
        ),
      }));
    } else {
      commitRoom(points, walls, shape);
    }
    setWallSelect(null);
    onToolDone();
    if (roomId) onRoomCreated?.(roomId); // return to the modal after re-marking
  }, [wallSelect, floor.northDeg, onMutate, commitRoom, onToolDone, onRoomCreated]);

  const cancelWallSelect = useCallback(() => {
    const roomId = wallSelect?.roomId ?? null;
    setWallSelect(null);
    onToolDone();
    // a fresh draft is discarded (no room made); re-mark returns to the modal
    if (roomId) onRoomCreated?.(roomId);
  }, [wallSelect, onToolDone, onRoomCreated]);

  /* modal asked to re-mark an existing room — seed wall-select from its walls */
  useEffect(() => {
    if (!remarkRoomId) return;
    const room = doc.objects.find((o) => o.id === remarkRoomId);
    if (room && room.geometry.kind === "polygon") {
      const walls = Array.isArray(room.props.externalWalls)
        ? (room.props.externalWalls as number[])
        : [];
      // intentional prop→state handoff: the modal hands the canvas a one-shot
      // re-mark request, consumed immediately below
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWallSelect({
        points: room.geometry.points,
        selected: new Set(walls),
        roomId: remarkRoomId,
      });
    }
    onRemarkConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remarkRoomId]);

  const commitGeometry = useCallback(
    (id: string, points: Point[]) => {
      onMutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === id ? { ...o, geometry: { kind: "polygon", points } } : o
        ),
      }));
    },
    [onMutate]
  );

  /** whole-room move: the polygon, its member units and their attached runs
      translate in one mutate, so a single undo restores everything */
  const commitRoomMove = useCallback(
    (roomId: string, memberIds: ReadonlySet<string>, delta: Point) => {
      onMutate((d) => ({
        ...d,
        objects: translateRoomWithContents(d.objects, roomId, memberIds, delta),
      }));
    },
    [onMutate]
  );

  const hitRoom = useCallback(
    (w: Point): string | null => {
      const tol = HIT_EDGE_PX / vp.zoom;
      for (let i = rooms.length - 1; i >= 0; i--) {
        const pts = roomPoints(rooms[i]);
        if (pointInPolygon(w, pts)) return rooms[i].id;
        for (let j = 0; j < pts.length; j++) {
          if (distToSegment(w, pts[j], pts[(j + 1) % pts.length]) <= tol)
            return rooms[i].id;
        }
      }
      return null;
    },
    [rooms, roomPoints, vp]
  );

  /** system objects hit first (they sit on top of rooms): plenum bodies,
      unit footprints, riser discs, then run segments */
  const hitSystemObject = useCallback(
    (w: Point): { id: string; kind: "unit" | "riser" | "pipe-run" | "plenum" } | null => {
      for (let i = plenums.length - 1; i >= 0; i--) {
        const s = plenumShapes.get(plenums[i].id);
        if (s && pointInPolygon(w, s.body)) return { id: plenums[i].id, kind: "plenum" };
      }
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        const at = pointAt(u);
        const fp = footprint(Number(u.props.widthMm ?? 800), Number(u.props.depthMm ?? 300));
        if (Math.abs(w.x - at.x) <= fp.w / 2 && Math.abs(w.y - at.y) <= fp.h / 2)
          return { id: u.id, kind: "unit" };
      }
      for (let i = risers.length - 1; i >= 0; i--) {
        if (dist(pointAt(risers[i]), w) <= 12 / vp.zoom)
          return { id: risers[i].id, kind: "riser" };
      }
      const tol = HIT_EDGE_PX / vp.zoom;
      for (let i = runs.length - 1; i >= 0; i--) {
        const pts = runs[i].geometry.points;
        for (let j = 0; j < pts.length - 1; j++) {
          if (distToSegment(w, pts[j], pts[j + 1]) <= tol)
            return { id: runs[i].id, kind: "pipe-run" };
        }
      }
      return null;
    },
    [plenums, plenumShapes, units, risers, runs, pointAt, footprint, vp.zoom]
  );

  /* Eraser: objects only (a room deletes by selecting it and pressing Delete,
     which carries its units — canvas rule #6).
     A pipe loses just its nearest segment (one vertex) unless it's down to a
     single segment; units/risers delete whole. Forgiving hit tolerance. */
  const eraseAt = useCallback(
    (w: Point) => {
      const tol = ERASE_HIT_PX / vp.zoom;
      // units first (on top), then risers
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        const at = pointAt(u);
        const fp = footprint(Number(u.props.widthMm ?? 800), Number(u.props.depthMm ?? 300));
        if (Math.abs(w.x - at.x) <= fp.w / 2 + tol && Math.abs(w.y - at.y) <= fp.h / 2 + tol) {
          // erasing an AHU takes its plenums with it (anchored objects);
          // runs that attached to it lose the ref and become open ends
          onMutate((d) => ({
            ...d,
            objects: stripAttachesTo(
              d.objects.filter((o) => o.id !== u.id && !isPlenumOf(o, u.id)),
              new Set([u.id])
            ),
          }));
          if (selectedId === u.id) onSelect(null);
          return;
        }
      }
      for (let i = risers.length - 1; i >= 0; i--) {
        if (dist(pointAt(risers[i]), w) <= 12 / vp.zoom + tol) {
          const id = risers[i].id;
          onMutate((d) => ({
            ...d,
            objects: stripAttachesTo(
              d.objects.filter((o) => o.id !== id),
              new Set([id])
            ),
          }));
          if (selectedId === id) onSelect(null);
          return;
        }
      }
      // pipe runs — nearest segment across all runs
      let bestRun: string | null = null, bestSeg = -1, bestDist = tol;
      for (let i = runs.length - 1; i >= 0; i--) {
        const pts = runs[i].geometry.points;
        for (let j = 0; j < pts.length - 1; j++) {
          const d = distToSegment(w, pts[j], pts[j + 1]);
          if (d < bestDist) { bestDist = d; bestRun = runs[i].id; bestSeg = j; }
        }
      }
      if (bestRun) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.flatMap((o) => {
            if (o.id !== bestRun || o.geometry.kind !== "polyline") return [o];
            const pts = o.geometry.points;
            if (pts.length <= 2) return []; // one segment — delete the whole run
            // drop the later endpoint of the nearest segment (DUCTR splice)
            const removed = bestSeg + 1;
            const next = pts.filter((_, k) => k !== removed);
            const props = { ...o.props };
            if (removed === 0) delete props.startAttach;
            if (removed === pts.length - 1) delete props.endAttach;
            return [{ ...o, geometry: { kind: "polyline" as const, points: next }, props }];
          }),
        }));
      }
    },
    [units, risers, runs, pointAt, footprint, vp.zoom, onMutate, selectedId, onSelect]
  );

  /* ── Stage-4 document intents ── */
  const addUnit = useCallback(
    (at: Point) => {
      if (!placing || !activeSystemId) return;
      onMutate((d) => {
        /* an IDU dropped inside a room is ATTRIBUTED to it (units → spaces);
           dropping into another system's room also adopts that room into this
           system's served list (the user's call: drop adopts) */
        const room = placing.role === "idu" ? roomAtPoint(d.objects, floor.id, at) : null;
        const adopt =
          room && room.systemId !== activeSystemId
            ? (() => {
                const sys = d.systems.find((s) => s.id === activeSystemId);
                const cur = Array.isArray(sys?.settings.roomIds)
                  ? (sys!.settings.roomIds as string[])
                  : [];
                return cur.includes(room.id) ? null : [...cur, room.id];
              })()
            : null;
        return {
          ...d,
          systems: adopt
            ? d.systems.map((s) =>
                s.id === activeSystemId
                  ? { ...s, settings: { ...s.settings, roomIds: adopt } }
                  : s
              )
            : d.systems,
          objects: [
            ...d.objects,
            {
              id: newId("obj"),
              type: "unit",
              systemId: activeSystemId,
              floorId: floor.id,
              geometry: { kind: "point", at },
              plane: placing.role === "odu" ? "external-ground" : "room",
              props: {
                role: placing.role,
                model: placing.model,
                widthMm: placing.widthMm,
                depthMm: placing.depthMm,
                ...(room ? { roomId: room.id } : {}),
              },
            } satisfies DesignObject,
          ],
        };
      });
      onPlaced?.();
    },
    [placing, activeSystemId, onMutate, floor.id, onPlaced]
  );

  const addRiser = useCallback(
    (at: Point) => {
      if (!activeSystemId) return;
      onMutate((d) => {
        // next free group letter for this system, A…Z
        const used = new Set(
          d.objects
            .filter((o) => o.type === "riser" && o.systemId === activeSystemId)
            .map((o) => String(o.props.group ?? "A"))
        );
        // reuse an existing group when this floor doesn't have it yet — pairing
        // a riser across floors is the common case, a new group the rarer one
        let group = [...used].find(
          (g) =>
            !d.objects.some(
              (o) =>
                o.type === "riser" &&
                o.systemId === activeSystemId &&
                o.floorId === floor.id &&
                String(o.props.group ?? "A") === g
            )
        );
        if (!group) {
          let c = 65;
          while (used.has(String.fromCharCode(c))) c++;
          group = String.fromCharCode(c);
        }
        return {
          ...d,
          objects: [
            ...d.objects,
            {
              id: newId("obj"),
              type: "riser",
              systemId: activeSystemId,
              floorId: floor.id,
              geometry: { kind: "point", at },
              plane: "room",
              props: { group, heightM: 3 },
            } satisfies DesignObject,
          ],
        };
      });
    },
    [activeSystemId, onMutate, floor.id]
  );

  const commitPipe = useCallback(
    (points: Point[], endAttach: { kind: "unit" | "riser"; id: string } | null) => {
      if (!activeSystemId || points.length < 2) return;
      const startAttach = pipeStartAttach.current;
      onMutate((d) => ({
        ...d,
        objects: [
          ...d.objects,
          {
            id: newId("obj"),
            type: "pipe-run",
            systemId: activeSystemId,
            floorId: floor.id,
            geometry: { kind: "polyline", points },
            plane: "room",
            props: {
              ...(startAttach ? { startAttach } : {}),
              ...(endAttach ? { endAttach } : {}),
            },
          } satisfies DesignObject,
        ],
      }));
      setDraftPipe([]);
      pipeStartAttach.current = null;
    },
    [activeSystemId, onMutate, floor.id]
  );

  /* ── pointer handlers ── */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    const pan = () =>
      setDrag({ kind: "pan", startScreen: { x: e.clientX, y: e.clientY }, origVp: vp });

    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }

    if (e.button === 1 || spaceDown.current) return pan();
    if (e.button !== 0) return;

    // simulating: the canvas is read-only — every drag is a pan
    if (sim) return pan();

    // wall-marking captures clicks: toggle the nearest edge as external
    if (wallSelect) {
      const pts = wallSelect.points;
      const tol = 20 / vp.zoom;
      let hit = -1;
      let hitD = tol;
      for (let i = 0; i < pts.length; i++) {
        const d = distToSegment(w, pts[i], pts[(i + 1) % pts.length]);
        if (d <= hitD) {
          hit = i;
          hitD = d;
        }
      }
      if (hit >= 0) {
        setWallSelect((ws) => {
          if (!ws) return ws;
          const sel = new Set(ws.selected);
          if (sel.has(hit)) sel.delete(hit);
          else sel.add(hit);
          return { ...ws, selected: sel };
        });
      }
      return;
    }

    switch (tool) {
      case "select": {
        // north arrow: drag the knob to rotate, the body to move (screen-space
        // hit-test so the grab targets match the on-screen glyph)
        if (northArrow) {
          const c = worldToScreen(northArrow.pos, vp);
          const s = worldToScreen(w, vp);
          const rad = (northArrow.deg * Math.PI) / 180;
          const knob = {
            x: c.x + Math.sin(rad) * northKnob * vp.zoom,
            y: c.y - Math.cos(rad) * northKnob * vp.zoom,
          };
          if (dist(s, knob) <= Math.max(14, northR * 0.4 * vp.zoom)) {
            setDrag({ kind: "north-rotate", center: northArrow.pos });
            break;
          }
          if (dist(s, c) <= northR * vp.zoom) {
            setDrag({ kind: "north-move", startWorld: w, orig: northArrow.pos });
            break;
          }
        }
        // rotate knob on the selected simple unit — grab it before the body,
        // so the knob rotates and the footprint still moves (screen-space test)
        if (selectedId) {
          const su = units.find((u) => u.id === selectedId);
          if (su && isSimpleUnit(su)) {
            const ks = worldToScreen(unitRotKnob(su).knob, vp);
            if (dist(worldToScreen(w, vp), ks) <= 14) {
              setDrag({ kind: "unit-rotate", id: su.id, center: pointAt(su) });
              break;
            }
          }
        }
        const sys = hitSystemObject(w);
        if (sys) {
          onSelect(sys.id);
          // plenums are anchored (their position derives from the AHU) and
          // runs are polylines — only units/risers start a point drag
          if (sys.kind === "unit" || sys.kind === "riser") {
            const o = [...units, ...risers].find((x) => x.id === sys.id)!;
            setDrag({ kind: "point", id: sys.id, startWorld: w, orig: pointAt(o) });
          }
          break;
        }
        const hit = hitRoom(w);
        if (hit) {
          onSelect(hit);
          const room = rooms.find((r) => r.id === hit)!;
          // foreign rooms are selectable (to inspect) but only the system
          // that drew a room may move it
          if (roomEditable(room)) {
            // units stamped to this room travel with the move
            setDrag({
              kind: "move",
              id: hit,
              startWorld: w,
              orig: roomPoints(room),
              memberIds: roomMemberIds(doc.objects, hit),
            });
          }
        } else {
          onSelect(null);
          pan();
        }
        break;
      }
      case "place": {
        addUnit(w);
        break;
      }
      case "component": {
        // Step 2 ships the plenum: land on the glowing AHU end
        const end = nearestPlenumEnd(w);
        if (end) addPlenum(end);
        break;
      }
      case "pipe": {
        const anchor = nearestAnchor(w);
        // free first vertex; later vertices ortho-snap to the previous point so
        // runs stay horizontal/vertical (anchors always win).
        const prev = draftPipe[draftPipe.length - 1];
        const p = anchor ? anchor.at : prev ? orthoSnap(prev, w) : w;
        if (draftPipe.length === 0) {
          pipeStartAttach.current = anchor
            ? { kind: anchor.kind, id: anchor.id }
            : null;
          setDraftPipe([p]);
        } else if (anchor) {
          // landing on an anchor completes the run — the magnetic connection
          commitPipe([...draftPipe, p], { kind: anchor.kind, id: anchor.id });
        } else {
          setDraftPipe((pts) => [...pts, p]);
        }
        break;
      }
      case "riser": {
        addRiser(w);
        break;
      }
      case "room-poly": {
        const p = w;
        if (draftPoly.length >= 3) {
          const firstScreen = worldToScreen(draftPoly[0], vp);
          const hereScreen = worldToScreen(w, vp);
          if (dist(firstScreen, hereScreen) <= CLOSE_SNAP_PX) {
            beginWallSelect(draftPoly, "poly");
            setDraftPoly([]);
            return;
          }
        }
        setDraftPoly((pts) => [...pts, p]);
        break;
      }
      case "room-rect":
        setDrag({ kind: "rect", start: w });
        setDraftRect({ a: w, b: w });
        break;
      case "calibrate": {
        if (!calib.a) setCalib({ a: w });
        else if (!calib.b) setCalib({ a: calib.a, b: w });
        break;
      }
      case "set-north": {
        // drop the arrow at the click; keep any existing rotation
        const deg = floor.northDeg ?? 0;
        onMutate((d) => ({
          ...d,
          floors: d.floors.map((f) =>
            f.id === floor.id ? { ...f, northPos: { x: w.x, y: w.y }, northDeg: deg } : f
          ),
          objects: redetectOrientations(d.objects, floor.id, deg),
        }));
        onToolDone();
        break;
      }
      case "crop": {
        // start a crop rect over the topmost sheet under the cursor
        for (let i = floor.plans.length - 1; i >= 0; i--) {
          const s = floor.plans[i];
          const dims = sheetSize(s);
          if (!dims) continue;
          const pos = sheetPos(s);
          if (w.x >= pos.x && w.x <= pos.x + dims.w && w.y >= pos.y && w.y <= pos.y + dims.h) {
            setDrag({ kind: "crop", sheetId: s.id, start: w });
            setLiveCrop({ sheetId: s.id, a: w, b: w });
            return;
          }
        }
        break;
      }
      case "erase": {
        eraseAt(w);
        break;
      }
      case "arrange": {
        // topmost sheet under the cursor starts a placement drag
        for (let i = floor.plans.length - 1; i >= 0; i--) {
          const s = floor.plans[i];
          const dims = sheetSize(s);
          if (!dims) continue;
          const pos = sheetPos(s);
          if (
            w.x >= pos.x &&
            w.x <= pos.x + dims.w &&
            w.y >= pos.y &&
            w.y <= pos.y + dims.h
          ) {
            setDrag({ kind: "sheet", id: s.id, startWorld: w, orig: { x: s.x, y: s.y } });
            return;
          }
        }
        pan();
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    setCursor(w);
    if (!drag) return;
    switch (drag.kind) {
      case "pan": {
        const dx = (e.clientX - drag.startScreen.x) / vp.zoom;
        const dy = (e.clientY - drag.startScreen.y) / vp.zoom;
        setVp({ ...vp, x: drag.origVp.x - dx, y: drag.origVp.y - dy });
        break;
      }
      case "move": {
        const dx = w.x - drag.startWorld.x;
        const dy = w.y - drag.startWorld.y;
        setLiveGeom({
          id: drag.id,
          points: drag.orig.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          dx,
          dy,
          memberIds: drag.memberIds,
        });
        break;
      }
      case "vertex": {
        // a rectangle-tool room stays rectangular: dragging a corner resizes the
        // box (opposite corner fixed). Polygon rooms edit each vertex freely.
        const room = rooms.find((r) => r.id === drag.id);
        const keepRect =
          room?.props.shape === "rect" ||
          (room?.props.shape == null && isAxisAlignedRect(drag.orig));
        let points: Point[];
        if (keepRect) {
          points = rectResize(drag.orig, drag.index, w);
        } else {
          points = [...drag.orig];
          points[drag.index] = w;
        }
        setLiveGeom({ id: drag.id, points });
        break;
      }
      case "rect":
        setDraftRect({ a: drag.start, b: w });
        break;
      case "sheet":
        setLiveSheet({
          id: drag.id,
          x: drag.orig.x + (w.x - drag.startWorld.x),
          y: drag.orig.y + (w.y - drag.startWorld.y),
        });
        break;
      case "point":
        setLivePoint({
          id: drag.id,
          at: {
            x: drag.orig.x + (w.x - drag.startWorld.x),
            y: drag.orig.y + (w.y - drag.startWorld.y),
          },
        });
        break;
      case "crop":
        setLiveCrop({ sheetId: drag.sheetId, a: drag.start, b: w });
        break;
      case "north-move":
        setLiveNorth({
          pos: {
            x: drag.orig.x + (w.x - drag.startWorld.x),
            y: drag.orig.y + (w.y - drag.startWorld.y),
          },
          deg: floor.northDeg ?? 0,
        });
        break;
      case "north-rotate": {
        const c = worldToScreen(drag.center, vp);
        const s = worldToScreen(w, vp);
        const deg = ((Math.atan2(s.x - c.x, -(s.y - c.y)) * 180) / Math.PI + 360) % 360;
        setLiveNorth({ pos: drag.center, deg });
        break;
      }
      case "unit-rotate": {
        const c = worldToScreen(drag.center, vp);
        const s = worldToScreen(w, vp);
        let deg = ((Math.atan2(s.x - c.x, -(s.y - c.y)) * 180) / Math.PI + 360) % 360;
        // Shift snaps to 15° while dragging; 90° steps live on the keyboard
        if (e.shiftKey) deg = (Math.round(deg / 15) * 15) % 360;
        setLiveRotate({ id: drag.id, deg });
        break;
      }
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "sheet" && liveSheet) {
      const { id, x, y } = liveSheet;
      if (x !== drag.orig.x || y !== drag.orig.y) {
        onMutate((d) => ({
          ...d,
          floors: d.floors.map((f) =>
            f.id === floor.id
              ? {
                  ...f,
                  plans: f.plans.map((s) => (s.id === id ? { ...s, x, y } : s)),
                }
              : f
          ),
        }));
      }
      setLiveSheet(null);
    }
    if ((drag.kind === "move" || drag.kind === "vertex") && liveGeom) {
      // only commit if the gesture actually moved something
      const room = rooms.find((r) => r.id === liveGeom.id);
      if (
        room &&
        JSON.stringify(room.geometry.points) !== JSON.stringify(liveGeom.points)
      ) {
        if (drag.kind === "move") {
          // the room's units (and their pipes) ride along — one undo step
          commitRoomMove(liveGeom.id, drag.memberIds, {
            x: liveGeom.dx ?? 0,
            y: liveGeom.dy ?? 0,
          });
        } else {
          commitGeometry(liveGeom.id, liveGeom.points);
        }
      }
      setLiveGeom(null);
    }
    if (drag.kind === "rect" && draftRect) {
      const { a, b } = draftRect;
      if (Math.abs(b.x - a.x) >= snapStep && Math.abs(b.y - a.y) >= snapStep) {
        beginWallSelect(
          [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
          ],
          "rect"
        );
      }
      setDraftRect(null);
    }
    if (drag.kind === "point" && livePoint) {
      const { id, at } = livePoint;
      if (at.x !== drag.orig.x || at.y !== drag.orig.y) {
        onMutate((d) => {
          const moved = d.objects.find((o) => o.id === id);
          /* moving an IDU re-derives its room attribution (unless the user
             pinned it manually via roomLock) — and adopts a foreign room the
             same way a fresh drop does */
          const restamp =
            moved?.type === "unit" &&
            moved.props.role === "idu" &&
            !moved.props.roomLock;
          const room = restamp ? roomAtPoint(d.objects, moved!.floorId, at) : null;
          const adopt =
            restamp && room && moved!.systemId && room.systemId !== moved!.systemId
              ? (() => {
                  const sys = d.systems.find((s) => s.id === moved!.systemId);
                  const cur = Array.isArray(sys?.settings.roomIds)
                    ? (sys!.settings.roomIds as string[])
                    : [];
                  return cur.includes(room.id) ? null : [...cur, room.id];
                })()
              : null;
          return {
            ...d,
            systems: adopt
              ? d.systems.map((s) =>
                  s.id === moved!.systemId
                    ? { ...s, settings: { ...s.settings, roomIds: adopt } }
                    : s
                )
              : d.systems,
            // attached runs follow: their endpoints snap onto the new point
            // in the same mutate, so one undo restores unit and pipes together
            objects: reconcileAttachedRuns(
              d.objects.map((o) => {
                if (o.id !== id) return o;
                const next = { ...o, geometry: { kind: "point" as const, at } };
                if (restamp) {
                  const props = { ...next.props };
                  if (room) props.roomId = room.id;
                  else delete props.roomId;
                  next.props = props;
                }
                return next;
              }),
              new Set([id])
            ),
          };
        });
      }
      setLivePoint(null);
    }
    if ((drag.kind === "north-move" || drag.kind === "north-rotate") && liveNorth) {
      const { pos, deg } = liveNorth;
      onMutate((d) => ({
        ...d,
        floors: d.floors.map((f) =>
          f.id === floor.id ? { ...f, northPos: pos, northDeg: deg } : f
        ),
        objects: redetectOrientations(d.objects, floor.id, deg),
      }));
      setLiveNorth(null);
    }
    if (drag.kind === "unit-rotate" && liveRotate) {
      const { id, deg } = liveRotate;
      onMutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === id && o.geometry.kind === "point"
            ? { ...o, geometry: { ...o.geometry, rotation: deg } }
            : o
        ),
      }));
      setLiveRotate(null);
    }
    if (drag.kind === "crop" && liveCrop) {
      const { sheetId, a, b } = liveCrop;
      const sheet = floor.plans.find((s) => s.id === sheetId);
      if (sheet) {
        const dims = sheetSize(sheet);
        const pos = sheetPos(sheet);
        // clamp the drag to the sheet, store crop RELATIVE to the sheet origin
        const x0 = Math.max(pos.x, Math.min(a.x, b.x));
        const y0 = Math.max(pos.y, Math.min(a.y, b.y));
        const x1 = Math.min(pos.x + (dims?.w ?? 0), Math.max(a.x, b.x));
        const y1 = Math.min(pos.y + (dims?.h ?? 0), Math.max(a.y, b.y));
        const cw = x1 - x0, ch = y1 - y0;
        if (cw > 4 && ch > 4) {
          const crop = { x: x0 - pos.x, y: y0 - pos.y, w: cw, h: ch };
          onMutate((d) => ({
            ...d,
            floors: d.floors.map((f) =>
              f.id === floor.id
                ? { ...f, plans: f.plans.map((s) => (s.id === sheetId ? { ...s, crop } : s)) }
                : f
            ),
          }));
        }
      }
      setLiveCrop(null);
      onToolDone();
    }
    setDrag(null);
  };

  /* ── drag-from-card placement (Slice 3): the panel arms `placing` on
     dragstart; dragover tracks the to-scale ghost, drop commits the unit ── */
  const onDragOver = (e: React.DragEvent<SVGSVGElement>) => {
    if (!placing) return;
    e.preventDefault(); // allow the drop
    e.dataTransfer.dropEffect = "copy";
    setCursor(toWorld(e));
  };

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    if (!placing || sim) return;
    e.preventDefault();
    addUnit(toWorld(e));
  };

  const onDoubleClick = () => {
    if (sim) return;
    if (tool === "room-poly" && draftPoly.length >= 3) {
      beginWallSelect(draftPoly, "poly");
      setDraftPoly([]);
    }
    // double-click ends a pipe run without an end anchor (open run)
    if (tool === "pipe" && draftPipe.length >= 2) {
      commitPipe(draftPipe, null);
    }
  };

  const startVertexDrag = (id: string, index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }
    const room = rooms.find((r) => r.id === id);
    if (room) setDrag({ kind: "vertex", id, index, orig: roomPoints(room) });
  };

  const confirmCalibration = () => {
    const meters = parseFloat(calibMeters);
    if (!calib.a || !calib.b || !Number.isFinite(meters)) return;
    const mm = mmPerUnitFromCalibration(calib.a, calib.b, meters);
    if (!mm) return;
    onMutate((d) => ({
      ...d,
      floors: d.floors.map((f) =>
        f.id === floor.id ? { ...f, scaleMmPerUnit: mm } : f
      ),
    }));
    setCalib({});
    setCalibMeters("");
    onToolDone();
    // chain into the "set north" step popup (DUCTR showNorthPrompt)
    onCalibrated?.();
  };

  /* ── render ── */
  const zoom = vp.zoom;
  /* Label sizing. Dividing by `zoom` pins text to a constant SCREEN size —
     right when you're zoomed in, but it swamps the drawing when you zoom out:
     the plan shrinks and the text doesn't, until the room names are bigger
     than the rooms. Clamping the divisor at 1 makes labels behave like
     DRAWING entities below 100% (they shrink with the plan, so the drawing
     stays readable) and like UI above it (constant on screen, never
     ballooning). Use this for text — never for stroke widths, which should
     stay hairline at every zoom. */
  const labelZoom = Math.max(zoom, 1);
  const mm = floor.scaleMmPerUnit;
  const activeColour = sysColour.get(activeSystemId ?? "") ?? "#888";
  const calibScreenB = calib.b ? worldToScreen(calib.b, vp) : null;

  /* graph-paper DOTS, drawn in SCREEN space so they stay a constant size while
     zooming (like the original builder). Major dots on the grid, finer sub-dots
     at grid/5; the tile is offset to anchor to the world origin. */
  const gpx = grid * zoom; // major-dot spacing in screen px
  const dotOffX = (((-vp.x * zoom) % gpx) + gpx) % gpx;
  const dotOffY = (((-vp.y * zoom) % gpx) + gpx) % gpx;
  const showDots = !bare && gpx >= 6;
  const showSubDots = gpx >= 24;
  const subDots: { x: number; y: number }[] = [];
  if (showSubDots) {
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        if (i || j) subDots.push({ x: (i * gpx) / 5, y: (j * gpx) / 5 });
  }
  /* metre labels along the top edge (only meaningful once calibrated) */
  const axisLabels: { sx: number; m: number }[] = [];
  if (mm) {
    const step = grid * 5; // every 5 m
    const first = Math.ceil(vp.x / step) * step;
    for (let x = first; x < vp.x + size.w / zoom; x += step) {
      axisLabels.push({ sx: (x - vp.x) * zoom, m: unitsToMeters(x, mm) });
    }
  }

  const cursorClass =
    drag?.kind === "pan"
      ? "ds-cur-grabbing"
      : tool === "select"
        ? ""
        : tool === "erase"
          ? "ds-cur-erase"
          : tool === "set-north"
            ? "ds-cur-north"
            : "ds-cur-cross";

  /* in-progress guidance while a step tool is active */
  const toolHint: { icon: string; text: string } | null =
    tool === "calibrate" && !(calib.a && calib.b)
      ? {
          icon: "ruler",
          text: calib.a
            ? "Click the second point of the known dimension"
            : "Select two points a known distance apart",
        }
      : tool === "set-north"
        ? floor.northPos
          ? { icon: "rotate", text: "Drag the N to rotate · drag the centre to move" }
          : { icon: "rotate", text: "Click on the plan to place the north marker" }
        : tool === "crop"
          ? { icon: "maximize", text: "Drag a rectangle over the area to keep" }
          : tool === "component" && component?.kind === "plenum"
            ? {
                icon: "wind",
                text: `Click a glowing air-handler end to fit the ${component.stream} plenum`,
              }
            : null;

  return (
    <div
      ref={wrapRef}
      className={`ds-canvas ${cursorClass}${sim ? " simming" : ""}`}
      data-testid="studio-canvas"
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="application"
        aria-label="Design canvas"
      >
        {/* white paper backdrop (the original draws dots on white, not grey) */}
        <rect className="ds-paper" x={0} y={0} width={size.w} height={size.h} />
        {/* graph-paper dot grid — SCREEN space, behind everything */}
        {showDots && (
          <>
            <defs>
              <pattern
                id="ds-dots"
                className="ds-dots"
                patternUnits="userSpaceOnUse"
                width={gpx}
                height={gpx}
                patternTransform={`translate(${dotOffX} ${dotOffY})`}
              >
                {subDots.map((d, i) => (
                  <circle key={i} className="ds-dot-sub" cx={d.x} cy={d.y} r={1.0} />
                ))}
                <circle className="ds-dot-major" cx={0} cy={0} r={1.6} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={size.w} height={size.h} fill="url(#ds-dots)" />
          </>
        )}
        <g transform={`scale(${zoom}) translate(${-vp.x} ${-vp.y})`}>
          {/* plenum hatch (8% tint + 45° lines, constant screen density) and
              the AHU flow-arrow head — world-space defs, active-system tint */}
          <defs>
            <pattern
              id="ds-plenum-hatch"
              patternUnits="userSpaceOnUse"
              width={7 / zoom}
              height={7 / zoom}
              patternTransform="rotate(45)"
            >
              <rect width={7 / zoom} height={7 / zoom} fill={activeColour} fillOpacity={0.08} />
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={7 / zoom}
                stroke={activeColour}
                strokeOpacity={0.4}
                strokeWidth={1 / zoom}
              />
            </pattern>
            {/* Airflow head. Styled in CSS, not with currentColor: inside a
                <marker> currentColor resolves against the marker's own
                context — NOT the line referencing it — so the head could
                never be trusted to match the flow line. */}
            <marker
              id="ds-flow-arrow"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className="ds-flow-arrowhead" d="M1 1 L7 4 L1 7" fill="none" />
            </marker>
          </defs>
          {/* plan sheets (under everything); arrange tool shows outlines */}
          {layers.plan && floor.plans.map((s) => {
            const url = sheetUrls[s.imageRef];
            const dims = sheetSize(s);
            if (!url || !dims) return null;
            const pos = sheetPos(s);
            const crop = s.crop;
            const clipId = `clip-${s.id}`;
            return (
              <g key={s.id} className="ds-sheet">
                {crop && (
                  <clipPath id={clipId}>
                    <rect x={pos.x + crop.x} y={pos.y + crop.y} width={crop.w} height={crop.h} />
                  </clipPath>
                )}
                <image
                  className="ds-plan"
                  href={url}
                  x={pos.x}
                  y={pos.y}
                  width={dims.w}
                  height={dims.h}
                  preserveAspectRatio="none"
                  clipPath={crop ? `url(#${clipId})` : undefined}
                  style={grayscale ? { filter: "grayscale(1) brightness(1.05) contrast(0.92)" } : undefined}
                />
                {tool === "arrange" && (
                  <>
                    <rect
                      className="ds-sheet-outline"
                      x={pos.x}
                      y={pos.y}
                      width={dims.w}
                      height={dims.h}
                    />
                    <text
                      className="ds-sheet-name"
                      x={pos.x + 14 / labelZoom}
                      y={pos.y + 26 / labelZoom}
                      fontSize={13 / labelZoom}
                    >
                      {s.name}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* rooms */}
          {rooms.map((r) => {
            const pts = roomPoints(r);
            const c = polygonCentroid(pts);
            const areaU = polygonArea(pts);
            const selected = r.id === selectedId;
            const ghost = !roomServed(r);
            return (
              <g
                key={r.id}
                className={`ds-room${selected ? " sel" : ""}${ghost ? " ghost" : ""}`}
              >
                <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                {layers.labels && (
                  <>
                    <text x={c.x} y={c.y} fontSize={13 / labelZoom} className="ds-room-name">
                      {String(r.props.name ?? "Room")}
                      {/* spill rooms wear the ⤢ chip (ducted spec §9c) */}
                      {isSpillRoom(r) ? " ⤢" : ""}
                    </text>
                    <text
                      x={c.x}
                      y={c.y + 16 / labelZoom}
                      fontSize={11 / labelZoom}
                      className="ds-room-area"
                    >
                      {mm ? formatArea(areaUnitsToM2(areaU, mm)) : "not calibrated"}
                    </text>
                  </>
                )}
                {selected &&
                  tool === "select" &&
                  roomEditable(r) &&
                  pts.map((p, i) => (
                    <circle
                      key={i}
                      className="ds-vertex"
                      cx={p.x}
                      cy={p.y}
                      r={5 / zoom}
                      onPointerDown={startVertexDrag(r.id, i)}
                    />
                  ))}
              </g>
            );
          })}

          {/* pipe runs (Stage 4) — system colour, length when calibrated */}
          {layers.pipes && runs.map((r) => {
            const pts = liveRunPoints(r);
            const colour = sysColour.get(r.systemId ?? "") ?? "#888";
            const midI = Math.floor((pts.length - 1) / 2);
            const mid = {
              x: (pts[midI].x + pts[Math.min(midI + 1, pts.length - 1)].x) / 2,
              y: (pts[midI].y + pts[Math.min(midI + 1, pts.length - 1)].y) / 2,
            };
            return (
              <g
                key={r.id}
                className={`ds-pipe${r.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                {mm && layers.labels && (
                  <text x={mid.x} y={mid.y - 7 / labelZoom} fontSize={11 / labelZoom} className="ds-pipe-len">
                    {formatMeters(unitsToMeters(polylineLength(pts), mm))}
                  </text>
                )}
              </g>
            );
          })}

          {/* units (Stage 4) — to-scale footprint, role glyph, model */}
          {layers.units && units.map((u) => {
            const at = pointAt(u);
            const widthMm = Number(u.props.widthMm ?? 800);
            const fp = footprint(widthMm, Number(u.props.depthMm ?? 300));
            const colour = sysColour.get(u.systemId ?? "") ?? "#888";
            const role = String(u.props.role ?? "idu").toUpperCase();
            /* air-capable ducted-form AHUs grow their air side (spec §1a):
               a straight-through flow arrow, dashed socket outlines on the
               unoccupied end faces, and the fused built-in return box */
            const air = ahuRow(u);
            const perMm = fp.w / Math.max(widthMm, 1);
            const ends = air ? ahuEnds.filter((e) => e.unit.id === u.id) : [];
            const sockD = 150 * perMm;
            const builtInD = 350 * perMm; // engine's default plenum depth
            const rot = unitRotDeg(u); // simple units only; AHUs stay at 0
            const rk = u.id === selectedId && isSimpleUnit(u) ? unitRotKnob(u) : null;
            return (
              <g
                key={u.id}
                className={`ds-unit${u.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                {/* only the glyph (and, on AHUs, its air side) turns — the text
                    labels below stay upright */}
                <g transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined}>
                {unitGlyph(at.x, at.y, fp.w, fp.h, String(u.props.role ?? "idu"), zoom)}
                {(() => {
                  /* the airflow arrow + face labels appear only ONCE the unit
                     is determined — the first plenum, or a built-in return
                     (which orients the unit on its own). No `?` clutter and no
                     arrow on a bare unit (spec §1a). */
                  const oriented = ends.some((e) => e.determined);
                  if (!air || !oriented) return null;
                  const sdir = endFace(u, "supply").dir;
                  return (
                    <>
                      <line
                        className="ds-ahu-flow"
                        x1={at.x + fp.w * 0.3}
                        y1={at.y - sdir * fp.h * 0.28}
                        x2={at.x + fp.w * 0.3}
                        y2={at.y + sdir * fp.h * 0.28}
                        markerEnd="url(#ds-flow-arrow)"
                      />
                      {layers.labels &&
                        ends.map((e) => {
                          const f = endFace(e.unit, e.end);
                          return (
                            <text
                              key={`fl-${e.end}`}
                              className="ds-ahu-face-label"
                              x={f.mid.x}
                              y={f.mid.y + (f.dir === 1 ? -5 : 12) / labelZoom}
                              fontSize={8 / labelZoom}
                            >
                              {e.end.toUpperCase()}
                            </text>
                          );
                        })}
                    </>
                  );
                })()}
                {ends.map((e) => {
                  const f = endFace(e.unit, e.end);
                  if (e.builtIn) {
                    /* built-in return: the fused box + its return spigots pop
                       up automatically (spec §1a) — a default fan of return
                       takeoffs since the data book only says "spigots on it" */
                    const box = (
                      <rect
                        className="ds-plenum-builtin"
                        x={f.a.x}
                        y={f.dir === 1 ? f.mid.y : f.mid.y - builtInD}
                        width={f.b.x - f.a.x}
                        height={builtInD}
                        fill="url(#ds-plenum-hatch)"
                      />
                    );
                    const n = Math.min(3, Math.max(1, suggestedMainDucts(air?.airflow_ls ?? null, 289) ?? 2));
                    const r = (350 * perMm) / 2;
                    const outY = f.mid.y + f.dir * builtInD;
                    const spigs = Array.from({ length: n }, (_, i) => {
                      const cx = f.a.x + ((i + 1) / (n + 1)) * (f.b.x - f.a.x);
                      return (
                        <rect
                          key={i}
                          className="ds-spigot-fixed"
                          x={cx - r}
                          y={f.dir === 1 ? outY - builtInD * 0.4 : outY}
                          width={r * 2}
                          height={builtInD * 0.4}
                        />
                      );
                    });
                    return (
                      <g key={e.end} className="ds-plenum-builtin-g">
                        {box}
                        {spigs}
                      </g>
                    );
                  }
                  if (e.spigots) {
                    /* factory spigots: no plenum body at all — the takeoffs
                       stand straight off the unit face. Sized openings draw at
                       TRUE diameter and carry the book's label ("2 × Ø400");
                       an unsized "spigots" answer falls back to an
                       airflow-derived fan, drawn greyed like any derived
                       default (spec §1b). */
                    const opening = openingOf(e.row, e.end);
                    const dias = spigotDiametersMm(opening);
                    const derived = dias.length === 0;
                    const n = derived
                      ? Math.min(3, Math.max(1, suggestedMainDucts(air?.airflow_ls ?? null, 289) ?? 2))
                      : dias.length;
                    const stub = 150 * perMm;
                    const label = spigotLabel(opening);
                    return (
                      <g key={e.end} className={`ds-ahu-spigots${derived ? " derived" : ""}`}>
                        {Array.from({ length: n }, (_, i) => {
                          const r = ((derived ? 350 : dias[i]) * perMm) / 2;
                          const cx = f.a.x + ((i + 1) / (n + 1)) * (f.b.x - f.a.x);
                          return (
                            <rect
                              key={i}
                              className="ds-spigot-fixed"
                              x={cx - r}
                              y={f.dir === 1 ? f.mid.y : f.mid.y - stub}
                              width={r * 2}
                              height={stub}
                            />
                          );
                        })}
                        {layers.labels && label ? (
                          <text
                            className="ds-spigot-label"
                            x={f.mid.x}
                            y={
                              f.dir === 1
                                ? f.mid.y + stub + 10 / zoom
                                : f.mid.y - stub - 4 / zoom
                            }
                            fontSize={9 / labelZoom}
                          >
                            {label}
                          </text>
                        ) : null}
                      </g>
                    );
                  }
                  if (e.occupied) return null; // a plenum object renders there
                  // a bare undetermined unit is a plain rectangle — the socket
                  // hint only shows the SECOND face once oriented (spec §1a)
                  if (!e.determined) return null;
                  return (
                    <rect
                      key={e.end}
                      className="ds-ahu-socket"
                      x={f.a.x}
                      y={f.dir === 1 ? f.mid.y : f.mid.y - sockD}
                      width={f.b.x - f.a.x}
                      height={sockD}
                    />
                  );
                })}
                </g>
                {layers.labels && (
                  <>
                    <text x={at.x} y={at.y + 4 / labelZoom} fontSize={11 / labelZoom} className="ds-unit-role">
                      {role}
                    </text>
                    <text
                      x={at.x}
                      y={at.y + fp.h / 2 + 13 / labelZoom}
                      fontSize={10 / labelZoom}
                      className="ds-unit-model"
                    >
                      {String(u.props.model ?? "")}
                    </text>
                  </>
                )}
                {rk && (() => {
                  // the handle: a stem from the footprint's turned top edge out
                  // to a grab knob (drag to spin, Shift snaps 15°; [ / ] step 90°)
                  const rad = (rot * Math.PI) / 180;
                  const edge = {
                    x: at.x + Math.sin(rad) * (fp.h / 2),
                    y: at.y - Math.cos(rad) * (fp.h / 2),
                  };
                  return (
                    <g className="ds-rot-knob">
                      <line
                        x1={edge.x}
                        y1={edge.y}
                        x2={rk.knob.x}
                        y2={rk.knob.y}
                        stroke="currentColor"
                        strokeWidth={1.5 / zoom}
                        strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                      />
                      <circle
                        cx={rk.knob.x}
                        cy={rk.knob.y}
                        r={6 / zoom}
                        fill="#fff"
                        stroke="currentColor"
                        strokeWidth={1.5 / zoom}
                      />
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* plenums (Stage 7 Step 2) — anchored to their AHU end; position is
              derived from the unit each render, so moving the AHU carries
              them. Concealed (ceiling-cavity) read: the ~85 % opacity family. */}
          {layers.units && plenums.map((p) => {
            const s = plenumShapes.get(p.id);
            if (!s) return null;
            const colour = sysColour.get(p.systemId ?? "") ?? "#888";
            return (
              <g
                key={p.id}
                /* "over" = this plenum can't take its ducts — too many across
                   the face, OR one too tall for the opening */
                className={`ds-plenum${p.id === selectedId ? " sel" : ""}${
                  s.overSpigot || s.overHeight ? " over" : ""
                }`}
                style={{ color: colour }}
              >
                <polygon
                  className="ds-plenum-body"
                  points={s.body.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                  fill="url(#ds-plenum-hatch)"
                />
                {s.spigots.map((sp) => (
                  <g key={sp.id} className="ds-spigot">
                    <polygon points={sp.rect.map((pt) => `${pt.x},${pt.y}`).join(" ")} />
                    {sp.capped && (
                      <line
                        className="ds-spigot-cap"
                        x1={sp.cx - sp.ny * 4}
                        y1={sp.cy - sp.nx * 4}
                        x2={sp.cx + sp.ny * 4}
                        y2={sp.cy + sp.nx * 4}
                      />
                    )}
                  </g>
                ))}
                {layers.labels && (
                  <text
                    className={`ds-plenum-label${s.derived ? " derived" : ""}`}
                    x={s.labelAt.x}
                    y={s.labelAt.y + 13 / labelZoom}
                    fontSize={10 / labelZoom}
                  >
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* armed plenum — candidate faces glow (pre-filtered by the HUD's
              supply⌇return toggle; while undetermined BOTH faces are offered —
              the first placement decides, spec §1a); the nearest face
              previews a dashed ghost body (show-the-snap-target-first) */}
          {tool === "component" && component?.kind === "plenum" && (() => {
            const near = cursor ? nearestPlenumEnd(cursor) : null;
            return (
              <g className="ds-plenum-arm" style={{ color: activeColour }}>
                {plenumCandidates.map((c) => {
                    const e = c.e;
                    const f = c.face;
                    const ready =
                      near?.e.unit.id === e.unit.id && near?.needsFlip === c.needsFlip;
                    // a drop-zone rectangle standing off each candidate face —
                    // "place it on either side" (spec §1a); the nearest lights
                    const fp = footprint(
                      Number(e.unit.props.widthMm ?? 800),
                      Number(e.unit.props.depthMm ?? 300)
                    );
                    const zoneD = fp.h * 0.55; // drop-zone depth off the face
                    return (
                      <g key={`${e.unit.id}:${e.end}:${c.needsFlip ? "flip" : "as-is"}`}>
                        <rect
                          className={`ds-plenum-dropzone${ready ? " ready" : ""}`}
                          x={f.a.x}
                          y={f.dir === 1 ? f.mid.y : f.mid.y - zoneD}
                          width={f.b.x - f.a.x}
                          height={zoneD}
                          rx={6 / vp.zoom}
                        />
                        <line
                          className={`ds-plenum-face${ready ? " ready" : ""}`}
                          x1={f.a.x}
                          y1={f.a.y}
                          x2={f.b.x}
                          y2={f.b.y}
                        />
                        {ready && (() => {
                          const widthMm = Number(e.unit.props.widthMm ?? 800);
                          const fp = footprint(widthMm, Number(e.unit.props.depthMm ?? 300));
                          const perMm = fp.w / Math.max(widthMm, 1);
                          const body = plenumBody({
                            opening: openingOf(e.row, e.end),
                            unitWidthMm: widthMm,
                            spigots: [],
                            units: doc.settings.units,
                            // the ghost must promise the shape you'll get
                            stream: e.end,
                          });
                          const ghost = plenumShape({
                            cx: f.mid.x,
                            cy: f.mid.y,
                            dir: f.dir,
                            baseHalf: (body.baseWMm * perMm) / 2,
                            spigotHalf: (body.spigotFaceWMm * perMm) / 2,
                            depth: body.depthMm * perMm,
                            spigots: [],
                          });
                          return (
                            <polygon
                              className="ds-plenum-ghost"
                              points={ghost.body.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                            />
                          );
                        })()}
                      </g>
                    );
                  })}
              </g>
            );
          })()}

          {/* risers (Stage 4) — disc + group letter, one per floor per group */}
          {layers.pipes && risers.map((r) => {
            const at = pointAt(r);
            const colour = sysColour.get(r.systemId ?? "") ?? "#888";
            return (
              <g
                key={r.id}
                className={`ds-riser${r.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                <circle cx={at.x} cy={at.y} r={10 / zoom} />
                <text x={at.x} y={at.y + 3.5 / zoom} fontSize={10 / zoom}>
                  ⇅{String(r.props.group ?? "A")}
                </text>
              </g>
            );
          })}

          {/* connection anchors — visible while piping; nearest one glows
              BEFORE the click (pre-click snap feedback) */}
          {tool === "pipe" &&
            (() => {
              const near = cursor ? nearestAnchor(cursor) : null;
              return anchors.map((a) => (
                <circle
                  key={`${a.kind}:${a.id}`}
                  className={`ds-anchor${near?.id === a.id ? " ready" : ""}`}
                  cx={a.at.x}
                  cy={a.at.y}
                  r={(near?.id === a.id ? 9 : 5) / zoom}
                />
              ));
            })()}

          {/* pipe draft */}
          {draftPipe.length > 0 && (
            <g className="ds-pipe-draft">
              <polyline
                points={[
                  ...draftPipe,
                  ...(cursor
                    ? [nearestAnchor(cursor)?.at ?? orthoSnap(draftPipe[draftPipe.length - 1], cursor)]
                    : []),
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
              />
              <circle cx={draftPipe[0].x} cy={draftPipe[0].y} r={4 / zoom} />
            </g>
          )}

          {/* placement ghost — the armed unit follows the cursor to-scale */}
          {tool === "place" && placing && cursor && (
            <g className="ds-place-ghost">
              {(() => {
                const at = cursor;
                const fp = footprint(placing.widthMm, placing.depthMm);
                return (
                  <>
                    {unitGlyph(at.x, at.y, fp.w, fp.h, placing.role, zoom)}
                    <text x={at.x} y={at.y + 4 / zoom} fontSize={11 / zoom}>
                      {placing.role.toUpperCase()}
                    </text>
                  </>
                );
              })()}
            </g>
          )}

          {/* polygon draft */}
          {draftPoly.length > 0 &&
            (() => {
              // near the first vertex? snap the preview shut and light it up
              const closing =
                cursor != null &&
                draftPoly.length >= 3 &&
                dist(worldToScreen(draftPoly[0], vp), worldToScreen(cursor, vp)) <=
                  CLOSE_SNAP_PX;
              const tail = closing ? draftPoly[0] : cursor;
              return (
                <g className="ds-draft">
                  <polyline
                    points={[...draftPoly, ...(tail ? [tail] : [])]
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                  />
                  <circle
                    className={closing ? "close-ready" : undefined}
                    cx={draftPoly[0].x}
                    cy={draftPoly[0].y}
                    r={(CLOSE_SNAP_PX / zoom) * (closing ? 1.1 : 0.6)}
                  />
                </g>
              );
            })()}

          {/* rect draft */}
          {draftRect && (
            <g className="ds-draft">
              <rect
                x={Math.min(draftRect.a.x, draftRect.b.x)}
                y={Math.min(draftRect.a.y, draftRect.b.y)}
                width={Math.abs(draftRect.b.x - draftRect.a.x)}
                height={Math.abs(draftRect.b.y - draftRect.a.y)}
              />
              {mm && (
                <text
                  x={(draftRect.a.x + draftRect.b.x) / 2}
                  y={Math.min(draftRect.a.y, draftRect.b.y) - 8 / labelZoom}
                  fontSize={11 / labelZoom}
                  className="ds-draft-dims"
                >
                  {formatMeters(unitsToMeters(Math.abs(draftRect.b.x - draftRect.a.x), mm))} ×{" "}
                  {formatMeters(unitsToMeters(Math.abs(draftRect.b.y - draftRect.a.y), mm))}
                </text>
              )}
            </g>
          )}

          {/* wall-marking overlay — green edges are external, red are not */}
          {wallSelect && (
            <g className="ds-wallsel">
              <polygon
                className="ds-wallsel-fill"
                points={wallSelect.points.map((p) => `${p.x},${p.y}`).join(" ")}
              />
              {wallSelect.points.map((a, i) => {
                const b = wallSelect.points[(i + 1) % wallSelect.points.length];
                const on = wallSelect.selected.has(i);
                return (
                  <g key={i} className={`ds-wallsel-edge${on ? " on" : ""}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="ds-wallsel-line" />
                    <circle
                      className="ds-wallsel-dot"
                      cx={(a.x + b.x) / 2}
                      cy={(a.y + b.y) / 2}
                      r={6 / zoom}
                    />
                  </g>
                );
              })}
            </g>
          )}

          {/* crop preview while dragging (show-the-result-before-the-drop) */}
          {liveCrop && (
            <rect
              className="ds-crop-preview"
              x={Math.min(liveCrop.a.x, liveCrop.b.x)}
              y={Math.min(liveCrop.a.y, liveCrop.b.y)}
              width={Math.abs(liveCrop.b.x - liveCrop.a.x)}
              height={Math.abs(liveCrop.b.y - liveCrop.a.y)}
            />
          )}

          {/* north arrow — placeable, fixed to the plan. Once placed it shows a
              plain compass; the rotate knob + hint appear only while the
              set-north tool is active (drag body to move, the N to rotate). */}
          {northArrow && (() => {
            const R = northR;
            const active = tool === "set-north";
            const { x: cx, y: cy } = northArrow.pos;
            const kY = cy - northKnob; // knob sits above the ring (unrotated)
            return (
              <g
                className={`ds-north${active ? " active" : ""}`}
                transform={`rotate(${northArrow.deg} ${cx} ${cy})`}
              >
                <circle className="ds-north-ring" cx={cx} cy={cy} r={R} />
                {/* north (red) + south (grey) pointers = a clear compass */}
                <polygon
                  className="ds-north-arrow"
                  points={`${cx},${cy - R * 0.72} ${cx - R * 0.22},${cy} ${cx + R * 0.22},${cy}`}
                />
                <polygon
                  className="ds-north-south"
                  points={`${cx},${cy + R * 0.72} ${cx - R * 0.22},${cy} ${cx + R * 0.22},${cy}`}
                />
                <circle className="ds-north-hub" cx={cx} cy={cy} r={R * 0.08} />
                {active ? (
                  <>
                    {/* stem + rotate knob (the N) + curved rotate hint */}
                    <line className="ds-north-stem" x1={cx} y1={cy - R} x2={cx} y2={kY + R * 0.32} />
                    <circle className="ds-north-knob" cx={cx} cy={kY} r={R * 0.34} />
                    <text className="ds-north-n" x={cx} y={kY} fontSize={R * 0.42}>
                      N
                    </text>
                    <path
                      className="ds-north-rot"
                      d={`M ${cx + R * 0.5} ${kY - R * 0.18} A ${R * 0.34} ${R * 0.34} 0 1 1 ${cx + R * 0.5} ${kY + R * 0.18}`}
                    />
                  </>
                ) : (
                  // basic compass: just an N marker above the ring
                  <text
                    className="ds-north-n"
                    x={cx}
                    y={cy - R - R * 0.18}
                    fontSize={R * 0.4}
                  >
                    N
                  </text>
                )}
              </g>
            );
          })()}

          {/* calibration overlay */}
          {calib.a && (
            <g className="ds-calib">
              <circle cx={calib.a.x} cy={calib.a.y} r={5 / zoom} />
              {(calib.b || cursor) && (
                <line
                  x1={calib.a.x}
                  y1={calib.a.y}
                  x2={(calib.b ?? cursor)!.x}
                  y2={(calib.b ?? cursor)!.y}
                />
              )}
              {calib.b && <circle cx={calib.b.x} cy={calib.b.y} r={5 / zoom} />}
            </g>
          )}
        </g>

        {/* metre axis labels along the top edge — SCREEN space, constant size */}
        {axisLabels.length > 0 && (
          <g className="ds-axis">
            {axisLabels.map((l) => (
              <text key={l.sx} x={l.sx + 3} y={12}>
                {`${Math.round(l.m)}m`}
              </text>
            ))}
          </g>
        )}
      </svg>

      {/* simulation overlay — the ADR-001 reserved <canvas>, above the scene */}
      {sim && <SimOverlay runtime={sim} vp={vp} size={size} />}

      {/* calibration prompt (absolute within the canvas, never position:fixed) */}
      {calib.a && calib.b && calibScreenB && (
        <div
          className="ds-calib-card"
          style={{
            left: Math.min(calibScreenB.x + 14, size.w - 240),
            top: Math.min(calibScreenB.y + 14, size.h - 130),
          }}
        >
          <div className="ds-calib-t">Real distance between the two points</div>
          <div className="ds-calib-row">
            <input
              autoFocus
              inputMode="decimal"
              placeholder="e.g. 3.6"
              value={calibMeters}
              onChange={(e) => setCalibMeters(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmCalibration()}
            />
            <span>m</span>
          </div>
          <div className="ds-calib-actions">
            <button
              className="ds-calib-cancel"
              onClick={() => {
                setCalib({});
                setCalibMeters("");
              }}
            >
              Cancel
            </button>
            <button className="ds-calib-ok" onClick={confirmCalibration}>
              Set scale
            </button>
          </div>
        </div>
      )}

      {/* wall-marking panel — bottom-centre, never position:fixed */}
      {wallSelect &&
        (() => {
          const n = wallSelect.selected.size;
          return (
            <div className="ds-wallsel-panel" role="dialog" aria-label="Mark external walls">
              <div className="ds-wallsel-title">Mark external walls</div>
              <div className="ds-wallsel-hint">
                Click each wall exposed to outside. Leave internal / party walls
                unselected.
              </div>
              <div className={`ds-wallsel-count${n > 0 ? " on" : ""}`}>
                {n === 0
                  ? "No walls selected"
                  : `${n} external wall${n > 1 ? "s" : ""} marked`}
              </div>
              <div className="ds-wallsel-actions">
                <button className="ds-calib-cancel" onClick={cancelWallSelect}>
                  Cancel
                </button>
                <button className="ds-calib-ok" onClick={confirmWallSelect}>
                  {n > 0 ? "Done" : "No external walls"}
                </button>
              </div>
            </div>
          );
        })()}

      {/* in-progress guidance while a step tool is active (bottom-centre) */}
      {toolHint && (
        <div className="ds-tool-hint" role="status">
          <Icon name={toolHint.icon} size={14} />
          <span>{toolHint.text}</span>
        </div>
      )}

      {/* readouts + zoom controls */}
      <div className="ds-canvas-hud">
        <span>
          {mm
            ? `1 grid = 1 m · ${mm.toFixed(2)} mm/px`
            : "uncalibrated — grid is arbitrary"}
        </span>
        {cursor && mm && (
          <span>
            {formatMeters(unitsToMeters(cursor.x, mm))},{" "}
            {formatMeters(unitsToMeters(cursor.y, mm))}
          </span>
        )}
      </div>
    </div>
  );
}
