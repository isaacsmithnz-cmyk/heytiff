"use client";

/* THIS COMPONENT IS COMPILED BY REACT COMPILER, AND IT TOOK THREE SEPARATE
   FIXES TO GET THERE. It is the largest component in the app and the one that
   most wanted the optimisation, and for two PRs it silently did not get it.
   If you are about to change any of the three things below, know what you are
   giving up: the compiler emits ~1,000 memoization slots here.

   1. NO `useCallback`/`useMemo` in the geometry cluster. `endFaceLocal`,
      `endFace`, `plenumCandidates`, `nearestPlenumEnd`, `plenumShapes`,
      `hitSystemObject` and `eraseAt` are plain functions and values on
      purpose. The compiler must be able to PRESERVE any manual memoization it
      meets, and it could not prove that for these — they chain off
      `footprint`, and it reported every one of them. Hand-memoise one again
      and the whole component drops out of compilation, not just that hook.
      (`footprint` itself keeps its `useCallback`; it was named as the unstable
      dependency but is fine once its consumers stop hand-memoising.)

   2. NO `eslint-disable` for a `react-hooks/*` rule, anywhere in this file.
      The compiler refuses any component carrying one, whatever the rule and
      however good the reason. The two the canvas used to have were one-shot
      prop→state handoffs from the room modal; they are now derived during
      render instead — see the block near `remarkRoomId`.

   3. NO value blocks (optional chaining, conditionals, logical operators)
      INSIDE a try/catch. React Compiler 1.0 cannot lower them and gives up on
      the component: `Todo: Support value blocks ... within a try/catch
      statement`. The two `setPointerCapture` calls hoist their optional call
      out of the try for exactly this reason.

   HOW TO CHECK, because none of the usual signals can tell you. A silent
   `eslint .`, a green build and a passing suite all look identical whether
   this file is compiled or skipped — that is precisely how it went unnoticed
   through #316 and #318, and #316 removed the memoization in (1) while the
   component was still being skipped, so nothing replaced it. The only real
   check is to compile the file and look for the `react/compiler-runtime`
   import and `$[` cache slots. Zero slots means skipped. */

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
import { lensRoom, roomAtPoint } from "@/lib/studio/coverage";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { capacityFit, type UnitFit } from "@/lib/studio/fit";
import { OVERSIZE_CAP } from "@/lib/studio/select";
import { isAirCapable } from "@/lib/studio/modules";
import { attachOf } from "@/lib/studio/graph";
import { anchorFloating, dodgeSlot, type Size } from "@/lib/studio/anchor";
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
  formatDia,
  suggestedMainDucts,
  type PlenumSpigot,
} from "@/lib/studio/ducted";
import {
  hasFactorySpigots,
  spigotDiametersMm,
  spigotLabel,
  type IndoorUnit,
  type OpeningSpec,
  type OutdoorUnit,
} from "@/lib/studio/packs/schema";
import { formFactorLabel } from "@/lib/studio/unit-specs";
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
  distToSmoothed,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polylineLength,
  smoothedLength,
  smoothPathD,
  screenToWorld,
  unitsToMeters,
  worldToScreen,
  zoomAt,
  type Viewport,
} from "@/lib/studio/geometry";
import {
  cloudPath,
  createNote,
  isNote,
  leaderStart,
  moveNote,
  noteBounds,
  noteHit,
  noteLeader,
  noteRect,
  noteText,
  noteTextLayout,
  rectFromDrag,
  type NoteObject,
  type NoteRect,
} from "@/lib/studio/notes";
import { readWheel, type WheelMode } from "@/lib/studio/wheel";

/* StudioCanvas — the SVG scene per ADR-001. Renders the document, emits
   intents via onMutate; it never mutates the document itself. World space is
   floor pixels; one <g> carries pan/zoom; strokes keep constant screen weight
   via vector-effect. */

export type CanvasTool =
  | "select"
  | "room-rect"
  | "room-poly"
  | "calibrate"
  | "measure" // throwaway tape measure — drag to read a distance, nothing is saved
  | "set-north" // place/rotate the true-north arrow
  | "crop" // trim a plan sheet's visible region
  | "erase"
  | "arrange"
  | "place" // place a unit (armed from the system panel with a model)
  | "pipe" // refrigerant run — endpoints snap to unit/riser anchors
  | "drain" // condensate drain — straight segments, size picked at draw
  | "cable" // power/data cable — dots smoothed into a curve
  | "riser"
  | "component" // air component armed from the palette (Stage 7 — plenum first)
  | "note"; // markup: a revision cloud round something, with its say in the margin

/** the Draw flyout's armed options — what the next drawn line IS. Soft-drawn
    pipe and cable place dots that render as a smoothed curve; hard-drawn pipe
    and drain stay orthogonal segments. */
export interface DrawOptions {
  pipeForm: "soft" | "hard";
  drainMm: number;
  cableKind: "power" | "data";
}
export const DEFAULT_DRAW: DrawOptions = {
  pipeForm: "hard",
  drainMm: 25,
  cableKind: "power",
};

/** the tools that draft a polyline run (share the dot draft + anchors) */
export const isRunTool = (t: CanvasTool): t is "pipe" | "drain" | "cable" =>
  t === "pipe" || t === "drain" || t === "cable";

/** the object types those tools commit (hit/erase/drag-follow treat alike) */
const RUN_TYPES = new Set(["pipe-run", "drain-run", "cable-run"]);

/** does this run render as a smoothed curve? cables always; pipe when soft */
export const isCurvedRun = (o: {
  type: string;
  props: Record<string, unknown>;
}): boolean =>
  o.type === "cable-run" || (o.type === "pipe-run" && o.props.form === "soft");

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
/** the margin text's size on SCREEN. Notes hold a constant screen size the way
    every other label on this canvas does; the world-space size is derived. */
const NOTE_FONT_PX = 13;
/** a cloud smaller than this (screen px, either side) was a stray click */
const NOTE_MIN_PX = 14;
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
  /** its own diameter (mm) — every takeoff is labelled AT the takeoff */
  diaMm: number;
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
  /** unit vector pointing OUT of that face (the unit's rotation is in here) */
  out: Point;
  /** unit vector running ALONG the face, so the shape turns with the unit */
  ax: Point;
  /** half the BASE width — on the unit, the widest edge (world units) */
  baseHalf: number;
  /** half the SPIGOT-FACE width — the narrow far edge (world units, ≤ base) */
  spigotHalf: number;
  /** plan protrusion from the unit face (world units) */
  depth: number;
  spigots: (PlenumSpigot & { r: number })[];
}): PlenumShape {
  const { cx, cy, out, ax, baseHalf, depth } = opts;
  /* The whole shape is laid out in the FACE's own frame — `a` runs across the
     face, `o` out of it — and mapped to world through the unit's basis. That
     is what lets a rotated AHU carry its plenum round with it; the frame is
     (1,0)/(0,±1) for an unrotated unit, which is the geometry this drew before
     ducted units could turn. */
  const P = (a: number, o: number): Point => ({
    x: cx + ax.x * a + out.x * o,
    y: cy + ax.y * a + out.y * o,
  });
  const V = (a: number, o: number): Point => ({
    x: ax.x * a + out.x * o,
    y: ax.y * a + out.y * o,
  });
  const hBase = baseHalf;
  /* The far face is exactly as wide as the ducts landing ON it — no artificial
     lip. With every takeoff on the SIDES the face is nothing and the body
     closes to a true V point, which is how these are drawn by hand (field
     sketch 2026-07-23); the old 12% floor left a stub that read as a mistake. */
  const hSpig = Math.min(hBase, opts.spigotHalf);
  const stub = depth * 0.4; // how far the spigot rectangles stand off the face

  // trapezoid: WIDE on the unit (±hBase) → NARROW at the spigot face (±hSpig)
  const body: Point[] = [
    P(-hBase, 0),
    P(-hSpig, depth),
    P(hSpig, depth),
    P(hBase, 0),
  ];

  const spigots: PlenumSpigotRect[] = opts.spigots.map((s) => {
    if (s.face === "front") {
      /* front spigots: t ∈ 0..1 left→right along the (narrow) spigot face.
         Rectangle: Ø across the face, stub standing off it */
      const a = -hSpig + s.t * 2 * hSpig;
      return {
        id: s.id,
        rect: [
          P(a - s.r, depth),
          P(a - s.r, depth + stub),
          P(a + s.r, depth + stub),
          P(a + s.r, depth),
        ],
        cx: P(a, depth + stub / 2).x,
        cy: P(a, depth + stub / 2).y,
        nx: out.x,
        ny: out.y,
        capped: s.capped === true,
        diaMm: s.diaMm,
      };
    }
    /* side spigot: it comes off the SLOPED edge, so the takeoff has to be
       square to that edge — Ø along the slope, stub along the slope's outward
       normal. Drawing it axis-aligned (the old ±y × ±x box) left the duct
       hanging off the angled face at a visible angle (field feedback
       2026-07-25). */
    const sgn = s.face === "left" ? -1 : 1;
    // the sloped edge, base corner → spigot-face corner
    const ea = sgn * hSpig - sgn * hBase;
    const eo = depth;
    const len = Math.hypot(ea, eo) || 1;
    const ta = ea / len; // unit tangent along the edge
    const to = eo / len;
    // its normal, flipped to point AWAY from the body (outward across the face)
    let na = to;
    let no = -ta;
    if (na * sgn < 0) {
      na = -na;
      no = -no;
    }
    const pa = sgn * hBase + ea * s.t; // seat of the takeoff on the edge
    const po = eo * s.t;
    return {
      id: s.id,
      rect: [
        P(pa - ta * s.r, po - to * s.r), // edge footprint, Ø wide
        P(pa - ta * s.r + na * stub, po - to * s.r + no * stub),
        P(pa + ta * s.r + na * stub, po + to * s.r + no * stub),
        P(pa + ta * s.r, po + to * s.r),
      ],
      cx: P(pa + (na * stub) / 2, po + (no * stub) / 2).x,
      cy: P(pa + (na * stub) / 2, po + (no * stub) / 2).y,
      nx: V(na, no).x,
      ny: V(na, no).y,
      capped: s.capped === true,
      diaMm: s.diaMm,
    };
  });

  /* the label sits CENTRED ON the plenum body — a label belongs on the thing
     it names, and centring also keeps it clear of the takeoffs, which stand
     off the far face rather than over the body. */
  return { body, spigots, labelAt: P(0, depth / 2) };
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
  grid: number,
  notes: NoteObject[] = []
): Viewport {
  const b = boundsOfPoints(points);
  if (!b) {
    // empty floor: centre the origin, one grid cell ≈ 56 screen px
    const zoom = 56 / grid;
    return { zoom, x: -w / (2 * zoom), y: -h / (2 * zoom) };
  }
  if (notes.length === 0) return fitBounds(b, w, h, 60);
  /* A note's words hold a constant SCREEN size, so how much WORLD they cover
     depends on the very zoom the fit is working out. One extra pass settles
     it — fit the drawing, size the words to that zoom, fit again — which is
     the same two-pass the print figure runs for the same reason. Without it
     the margin text is the one thing "fit" reliably leaves off the screen. */
  const font = NOTE_FONT_PX / Math.max(fitZoom(b, w, h, 60), 1);
  const pts = [...points];
  for (const n of notes) {
    const nb = noteBounds(n, font);
    pts.push({ x: nb.x, y: nb.y }, { x: nb.x + nb.w, y: nb.y + nb.h });
  }
  return fitBounds(boundsOfPoints(pts) ?? b, w, h, 60);
}

/** How far the pointer may travel and still count as a click, not a drag.
    Every click-to-place tool starts as a `tap-pan`: move past this and the
    gesture becomes a pan (so you can bring the far end of a wall into view
    mid-calibration); release inside it and the placement commits.

    Generous on purpose. This used to be 4px, because drag-past-the-slop was
    the only way a trackpad could pan and a tight threshold made it reachable —
    which meant a press that rolled a few px, as a trackpad press does, nudged
    the plan instead of dropping the point you aimed at. Now that a two-finger
    scroll can pan (see readWheel), the drag is a fallback and the click can be
    forgiving again. */
const TAP_SLOP_PX = 10;

type Drag =
  | { kind: "pan"; startScreen: Point; origVp: Viewport }
  /** undecided: a click-to-place gesture that hasn't moved far enough to be
      a pan yet. `commit` is the placement it will run on release. */
  | {
      kind: "tap-pan";
      startScreen: Point;
      origVp: Viewport;
      commit: () => void;
    }
  | { kind: "move"; id: string; startWorld: Point; orig: Point[]; memberIds: ReadonlySet<string> }
  | { kind: "vertex"; id: string; index: number; orig: Point[] }
  | { kind: "rect"; start: Point }
  | { kind: "sheet"; id: string; startWorld: Point; orig: Point }
  | { kind: "point"; id: string; startWorld: Point; orig: Point }
  | { kind: "crop"; sheetId: string; start: Point }
  | { kind: "north-move"; startWorld: Point; orig: { x: number; y: number } }
  | { kind: "north-rotate"; center: { x: number; y: number } }
  | { kind: "unit-rotate"; id: string; center: Point }
  /** the tape measure: a reading, not an object — it lives only for the
      length of the drag and is never written to the document */
  | { kind: "tape"; from: Point }
  /** dragging the note's cloud out over what it is about */
  | { kind: "note-rect"; start: Point }
  /** sliding a whole note — cloud and margin text travel together */
  | { kind: "note-move"; id: string; startWorld: Point }
  /** dragging just the margin end, to re-place the words off the plan.
      `orig` + the travel, never the raw cursor: you grab the words somewhere
      in the middle, and snapping the elbow to the grab point would jump the
      block out from under the pointer on the first pixel. */
  | { kind: "note-leader"; id: string; startWorld: Point; orig: Point };

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
  placingKw = null,
  roomFits,
  onPlaced,
  component = null,
  onComponentPlaced,
  iduSpec,
  oduSpec,
  onRoomCreated,
  onOpenRoom,
  remarkRoomId = null,
  onRemarkConsumed,
  reshapeRoomId = null,
  onReshapeConsumed,
  layers = ALL_LAYERS_ON,
  grayscale = false,
  onZoomApi,
  onZoomChange,
  sim = null,
  bare = false,
  draw = DEFAULT_DRAW,
  runSizes,
  wheelMode = "pan",
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
  /** what a bare scroll does — the user's setting, not a guess at their device.
      Defaults to pan: a trackpad has no other way to cross a plan, and pinch
      (which arrives as ctrl+wheel) zooms regardless of this. */
  wheelMode?: WheelMode;
  /** receive the zoom controls so the toolbar can render them */
  onZoomApi?: (api: ZoomApi) => void;
  /** current zoom percentage, for the toolbar readout */
  onZoomChange?: (pct: number) => void;
  /** system that pipe/riser/place drawing tags objects with (Stage 4) */
  activeSystemId?: string | null;
  /** armed unit for the place tool */
  placing?: PlacingUnit | null;
  /** the armed pairing's sizing capacity — while an indoor unit rides the
      cursor every room tints by how this sits against its own load */
  placingKw?: number | null;
  /** rooms whose PLACED unit missed their load (oversized/undersized) — the
      verdict that persists after the drop, worn on the label, never a block */
  roomFits?: Record<string, "oversized" | "undersized">;
  onPlaced?: () => void;
  /** armed air component for the component tool (Stage 7 — plenum first) */
  component?: ArmedComponent | null;
  onComponentPlaced?: () => void;
  /** pack-row resolver for placed indoor units — plenum specs + air
      capability come from unit DATA, never system type (ducted spec §11.1) */
  iduSpec?: (model: string) => IndoorUnit | null;
  /** the same resolver for outdoor units — the hover card names both sides */
  oduSpec?: (model: string) => OutdoorUnit | null;
  /** a room finished wall-marking — open its configuration modal (Slice 2) */
  onRoomCreated?: (id: string) => void;
  /** double-click a room with Select → open that room's modal */
  onOpenRoom?: (id: string) => void;
  /** request to re-enter wall-marking for an existing room (from the modal) */
  remarkRoomId?: string | null;
  onRemarkConsumed?: () => void;
  /** request to UNPIN an existing room and edit its shape (from the modal) */
  reshapeRoomId?: string | null;
  onReshapeConsumed?: () => void;
  /** live simulation (Stage 12a): renders the overlay + locks editing to
      pan/zoom. The sim never mutates the document — it only reads it. */
  sim?: SimRuntime | null;
  /** chromeless: drop the editing dot grid (present mode — a clean plan). */
  bare?: boolean;
  /** armed Draw options (pipe form, drain size, cable kind) */
  draw?: DrawOptions;
  /** systemId → the pairing's line sizes; pipe-run labels autosize from this
      (per-run props override) */
  runSizes?: ReadonlyMap<string, { liquidMm: number; gasMm: number }>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /* the unit under the pointer — named in the corner card instead of on the
     plan itself. Hit-tested from the same footprint the click uses, so what
     names itself is exactly what would select. */
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
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
  /* wall-marking (DUCTR parity): once the room is SAVED the user marks which
     edges are external, before the load modal opens. `isNew` = the room has
     just been drawn (Cancel drops back to sizing it); false = re-marking an
     existing room, which returns to the modal. */
  const [wallSelect, setWallSelect] = useState<{
    points: Point[];
    selected: Set<number>;
    roomId: string;
    isNew: boolean;
  } | null>(null);
  /* Sizing a room (field feedback 2026-07-25): a drawn room stays LOOSE until
     it's saved — only the adjust room's body and corners drag. Every other
     room is pinned to the plan, so a mis-grabbed pan no longer drags a whole
     space across the drawing; re-open one with Edit shape in the room modal.
     `orig` is the geometry to restore if the edit is cancelled. */
  const [adjust, setAdjust] = useState<{ id: string; isNew: boolean } | null>(null);
  const [calib, setCalib] = useState<{ a?: Point; b?: Point }>({});
  const [calibMeters, setCalibMeters] = useState("");
  /* the calibration card's MEASURED size — its width is fixed by CSS but its
     height is content, and guessing it is what let the card hang off the
     bottom edge. The fallback is only ever used for the first paint (and in
     jsdom, which has no layout). */
  const [calibCard, setCalibCard] = useState<Size>({ w: 226, h: 148 });
  const measureCalibCard = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) setCalibCard({ w: r.width, h: r.height });
  }, []);
  /* the live tape-measure reading. Deliberately component state and nothing
     else: it never reaches onMutate, so it makes no object, no undo entry and
     no mark on the drawing — let go and it's gone. */
  const [tape, setTape] = useState<{ a: Point; b: Point } | null>(null);
  /* the wall-marking / room-sizing panel's measured size, for the same reason
     — it picks the top or bottom slot depending on where the room sits */
  /* ── markup (the note tool) ──
     A note is made in two gestures, and both halves live here until it is
     committed: `noteDraft` is the cloud being dragged out, `notePin` the cloud
     that has been drawn and is now waiting to be told where its words go. Only
     `noteEdit` outlives the commit — the note is on the document by then, and
     this is just the box you type into. */
  const [noteDraft, setNoteDraft] = useState<{ a: Point; b: Point } | null>(null);
  const [notePin, setNotePin] = useState<NoteRect | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  /** a note mid-drag: the offset it has travelled, or its live leader end */
  const [liveNote, setLiveNote] = useState<
    { id: string; dx: number; dy: number } | { id: string; leader: Point } | null
  >(null);
  const [notePanel, setNotePanel] = useState<Size>({ w: 264, h: 172 });
  const measureNotePanel = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) setNotePanel({ w: r.width, h: r.height });
  }, []);
  const [roomPanel, setRoomPanel] = useState<Size>({ w: 360, h: 176 });
  const measureRoomPanel = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) setRoomPanel({ w: r.width, h: r.height });
  }, []);
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
          inScope(o) && RUN_TYPES.has(o.type) && o.geometry.kind === "polyline"
      ),
    [doc.objects, inScope]
  );

  /* Notes are FLOOR-wide and system-agnostic (notes.ts): the markup belongs to
     the drawing, so switching the canvas to another system must never take
     somebody's note off the plan with it. */
  const notes = useMemo(
    () =>
      doc.objects.filter(
        (o): o is NoteObject => o.floorId === floor.id && isNote(o)
      ),
    [doc.objects, floor.id]
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

  /* run drafting (pipe/drain/cable share it): clicked vertices + what the
     first click attached to. The dots are KEYED to the tool that placed them
     — switching draw tools mid-draft must not carry them across, or a half
     drawn pipe double-clicked as a drain would commit as the wrong type. */
  const [runDraft, setRunDraft] = useState<{ tool: CanvasTool; pts: Point[] }>({
    tool,
    pts: [],
  });
  const draftPipe = useMemo(
    () => (runDraft.tool === tool ? runDraft.pts : []),
    [runDraft, tool]
  );
  const setDraftPipe = useCallback(
    (v: Point[] | ((p: Point[]) => Point[])) =>
      setRunDraft((cur) => {
        const prev = cur.tool === tool ? cur.pts : [];
        return { tool, pts: typeof v === "function" ? v(prev) : v };
      }),
    [tool]
  );
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
  /* Which refs the loader below has already started fetching. A ref and not
     `sheetUrls`, even though that is the same question, because the loader
     WRITES `sheetUrls` — reading it there makes the effect depend on its own
     output, which is why that effect used to carry a dependency suppression.
     The ref answers "have I asked for this?" without joining the render. */
  const started = useRef<Set<string>>(new Set());
  /* sheet position override while dragging with the arrange tool */
  const [liveSheet, setLiveSheet] = useState<{ id: string; x: number; y: number } | null>(null);
  /* live north arrow while dragging (move/rotate), committed on pointer-up */
  const [liveNorth, setLiveNorth] = useState<{ pos: { x: number; y: number }; deg: number } | null>(null);
  /* live crop rectangle while dragging a crop over a sheet */
  const [liveCrop, setLiveCrop] = useState<{ sheetId: string; a: Point; b: Point } | null>(null);
  /* live unit rotation while dragging its knob, committed on pointer-up */
  const [liveRotate, setLiveRotate] = useState<{ id: string; deg: number } | null>(null);
  const northArrow = liveNorth ?? (floor.northPos ? { pos: floor.northPos, deg: floor.northDeg ?? 0 } : null);

  /* Rotating a placed unit. Wall heads, floor consoles and outdoor units are
     just glyphs, but a ducted AHU carries its air side round with it: the
     supply/return faces, their plenums and takeoffs all derive from the same
     angle (the faces come back rotated from `endFace`, and the plenum body is
     laid out in that face's frame). */
  type UnitObj = (typeof units)[number];
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
      if (started.current.has(sheet.imageRef) || !planImages) continue;
      started.current.add(sheet.imageRef);
      void planImages
        .url(sheet.imageRef)
        .then(async (url) => {
          if (!on) return;
          /* DECODE BEFORE DRAWING. Handing the URL straight to <image> let the
             browser paint the raster as it streamed — a plan that appeared
             from the top and wiped downward over a second or two, which reads
             as the tool struggling. Decoding off-DOM first means the element
             mounts with the whole picture ready, so it can simply fade in
             (.ds-plan). The bytes are in the browser's cache by then, so this
             costs a cache hit, not a second download. */
          const img = new Image();
          img.src = url;
          try {
            await img.decode();
          } catch {
            /* a browser that won't decode it (or an SVG without intrinsic
               size) still gets the URL below — better a hard cut than no plan */
          }
          if (!on) return;
          if (!sheet.width || !sheet.height) {
            setSheetDims((m) => ({
              ...m,
              [sheet.id]: { w: img.naturalWidth, h: img.naturalHeight },
            }));
          }
          setSheetUrls((m) => ({ ...m, [sheet.imageRef]: url }));
        })
        .catch(() => {
          /* offline or expired ref — the grid still works. Forget the attempt
             so a later pass can retry it; leaving it in `started` would make
             one flaky fetch permanent for the life of the component. */
          started.current.delete(sheet.imageRef);
        });
    }
    return () => {
      on = false;
    };
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
    /* Notes count as content, and they are the one object type that has to:
       a note lives in the MARGIN on purpose, so a fit that framed only the
       plan would hide the very words the note exists to say. The cloud and
       the leader end go in; the text itself cannot, because it holds a
       constant SCREEN size and so has no world extent until a zoom exists —
       the fit's own 60px margin is what carries the first line of it. */
    for (const n of notes) {
      pts.push(...n.geometry.points, noteLeader(n));
    }
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
  }, [rooms, roomPoints, notes, floor.plans, sheetSize, sheetPos]);

  const [vp, setVp] = useState<Viewport>(() =>
    defaultViewport(contentPoints(), size.w, size.h, grid, notes)
  );
  const mountContent = useRef({ points: contentPoints(), grid, notes });
  const measured = useRef(false);
  /* Has the user framed the view themselves (pan, zoom, a drag that moves the
     canvas)? Until they have, the view belongs to the CONTENT: the canvas
     re-fits whenever its box changes size or a late plan raster finally
     reports its dimensions.

     Fitting once on the first measurement was the bug behind "the plan opens
     low": the first box the ResizeObserver sees is not the settled one — the
     editor's rows are still resolving — so the drawing was centred in a taller
     box than it ended up in and stayed sitting below centre for the rest of
     the session. Nothing here overrides a view the user chose. */
  const userFramed = useRef(false);

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

  /* the wheel listener binds once (it has to be non-passive), so the setting
     reaches it through a ref rather than by re-binding on every change */
  const wheelModeRef = useRef(wheelMode);
  useEffect(() => {
    wheelModeRef.current = wheelMode;
  }, [wheelMode]);

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
  /* Fit frames the notes too, second pass and all — pressing Fit and losing
     the margin text is exactly the trap defaultViewport exists to avoid */
  const fitExtrasRef = useRef({ grid, notes });
  useEffect(() => {
    fitExtrasRef.current = { grid, notes };
  }, [grid, notes]);
  /* the zoom buttons frame the view by hand; Fit hands the framing back to
     the content, so it deliberately does NOT set the flag */
  const zoomBy = useCallback((k: number) => {
    userFramed.current = true;
    setVp((v) =>
      zoomAt(v, { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }, k, minZoomRef.current)
    );
  }, []);
  const zoomInApi = useCallback(() => zoomBy(1.3), [zoomBy]);
  const zoomOutApi = useCallback(() => zoomBy(1 / 1.3), [zoomBy]);
  const fitApi = useCallback(() => {
    const pts = contentPointsRef.current();
    if (boundsOfPoints(pts))
      setVp(
        defaultViewport(
          pts,
          sizeRef.current.w,
          sizeRef.current.h,
          fitExtrasRef.current.grid,
          fitExtrasRef.current.notes
        )
      );
    userFramed.current = false;
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

  /** an AHU air face in the unit's OWN (unrotated) frame. Air flows through
      the DEPTH (spec §1a) — the openings are the two LONG faces (±y). Supply
      defaults to the +y face; `props.airFlip` swaps, and the first placed
      plenum writes airFlip so its face IS its stream.

      Everything drawn INSIDE the unit's rotate group works in these coords —
      the group transform turns it. Anything outside wants `endFace`. */
  const endFaceLocal =
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
    };

  /** the same face in WORLD space, turned by the unit's rotation, plus the
      basis that goes with it: `out` points out of the face and `ax` runs
      along it (a → b). Plenums, drop zones and hit-tests all live out here,
      so they get the turned face rather than the unit's local one. */
  const endFace =
    (u: DesignObject & { geometry: { at: Point } }, end: "supply" | "return") => {
      const f = endFaceLocal(u, end);
      const deg =
        liveRotate?.id === u.id
          ? liveRotate.deg
          : (u.geometry as { rotation?: number }).rotation ?? 0;
      if (!deg) {
        return { ...f, out: { x: 0, y: f.dir }, ax: { x: 1, y: 0 } };
      }
      const at = pointAt(u);
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const rp = (p: Point): Point => ({
        x: at.x + (p.x - at.x) * c - (p.y - at.y) * s,
        y: at.y + (p.x - at.x) * s + (p.y - at.y) * c,
      });
      return {
        a: rp(f.a),
        b: rp(f.b),
        mid: rp(f.mid),
        dir: f.dir,
        faceHalf: f.faceHalf,
        out: { x: -f.dir * s, y: f.dir * c },
        ax: { x: c, y: s },
      };
    };

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
  const plenumCandidates = (() => {
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
  })();

  const nearestPlenumEnd =
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
    };

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
  const plenumShapes = (() => {
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
        stream: end, // return draws as a box; supply tapers to its spigots
      });
      if (body.builtIn || body.factorySpigots) continue; // no drawn plenum object
      const f = endFace(unit, end); // rotated: the plenum turns with its AHU
      // base = the discharge opening (a plenum box fans wider than the slim
      // unit end, so it is NOT clamped to the mounting-face length)
      const baseHalf = (body.baseWMm * perMm) / 2;
      m.set(p.id, {
        ...plenumShape({
          cx: f.mid.x,
          cy: f.mid.y,
          out: f.out,
          ax: f.ax,
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
  })();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize({ w: r.width, h: r.height });
      if (userFramed.current) return; // their view, not ours — leave it alone
      // first measure fits the mount-time content; later ones re-fit whatever
      // is on the floor now, so a settling layout can't strand the drawing
      const points = measured.current
        ? contentPointsRef.current()
        : mountContent.current.points;
      measured.current = true;
      setVp(
        defaultViewport(
          points,
          r.width,
          r.height,
          mountContent.current.grid,
          mountContent.current.notes
        )
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* A plan sheet saved without stored dimensions only reports its size once
     the raster decodes, which is after the first fit — so the sheet was not
     content yet when the view was framed, and a plan-backed floor could open
     showing empty grid. Re-fit when those dimensions land, unless the user has
     already framed the view themselves. */
  useEffect(() => {
    if (userFramed.current || !measured.current) return;
    if (Object.keys(sheetDims).length === 0) return;
    const pts = contentPointsRef.current();
    if (boundsOfPoints(pts))
      setVp(
        defaultViewport(
          pts,
          sizeRef.current.w,
          sizeRef.current.h,
          fitExtrasRef.current.grid,
          fitExtrasRef.current.notes
        )
      );
  }, [sheetDims]);

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

  /* ── pan + zoom (native non-passive wheel so preventDefault works) ──
     What a bare scroll does is the user's setting, not a guess about their
     hardware — see readWheel for the two guesses that got this wrong. The
     listener is bound once and reads the mode through a ref, so flipping the
     toggle takes effect on the very next notch without a rebind.

     Whichever way it is set, ctrl/cmd still zooms, and panning also lives on
     middle-drag and hold-Space — though a trackpad has neither (no middle
     button, and Space is swallowed the moment focus lands in the calibration
     measurement field), which is why "pan" is the setting a trackpad wants. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      /* momentum events are dispatched non-cancelable, and calling
         preventDefault on one is a no-op that Chrome warns about */
      if (e.cancelable) e.preventDefault();
      userFramed.current = true;
      const g = readWheel(e, wheelModeRef.current);
      if (g.kind === "pan") {
        setVp((v) => ({ ...v, x: v.x + g.dx / v.zoom, y: v.y + g.dy / v.zoom }));
        return;
      }
      const r = svg.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      setVp((v) => zoomAt(v, screen, g.factor, minZoomRef.current));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ── stop a sideways pan from navigating the BROWSER back ──
     Now that a two-finger scroll pans, a leftward pan across a plan is also
     the macOS/Chrome overscroll-history gesture: swipe to go back a page. It
     fires mid-design and takes the canvas with it.

     `preventDefault` on the wheel does NOT reliably stop it. Once a gesture
     enters its momentum phase the events are dispatched non-cancelable, so
     the tail of exactly the fling that pans furthest is uncancellable — which
     is why this needs a declaration, not a handler.

     `overscroll-behavior` decides it, but only on the element that owns the
     viewport's scroll. Setting it on `.ds-canvas` alone does nothing: the
     canvas is `overflow:hidden` with nothing to scroll, so there is no scroll
     chain to stop and the gesture goes straight to the root. Hence the root,
     saved and restored on unmount so the rest of the app keeps swipe-back —
     the same shape as the body-scroll locks in the notices board and the
     upload drawer. */
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => {
      root.style.overscrollBehaviorX = prev;
    };
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
        setTape(null);
        // discard an in-progress wall-marking (a fresh draft makes no room)
        setWallSelect(null);
        // a cloud with nowhere to point is dropped, not stranded
        setNoteDraft(null);
        setNotePin(null);
      }
      // [ / ] rotate the selected simple unit in 90° steps
      if ((e.key === "[" || e.key === "]") && !isTyping(e) && selectedId) {
        const u = units.find((x) => x.id === selectedId);
        if (u && u.type === "unit" && u.geometry.kind === "point") {
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
  }, [selectedId, onMutate, onSelect, units, ahuRow, setDraftPipe]);

  /* ── document intents ── */
  /* A closed boundary lands the room on the plan LOOSE — the user tweaks its
     size, then Save pins it and hands over to wall-marking (which used to run
     straight off the draw). Nothing is external yet; the walls are marked on
     the saved shape. */
  const beginRoomAdjust = useCallback(
    (points: Point[], shape: "rect" | "poly") => {
      const id = newId("obj");
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
            externalWalls: [],
            hasExternalWalls: false,
            // rectangle-tool rooms stay rectangular when their corners are edited
            ...(shape ? { shape } : {}),
          },
        };
        return { ...d, objects: [...d.objects, room] };
      });
      setAdjust({ id, isNew: true });
      onSelect(id);
      onToolDone(); // back to select so the corners and body drag
    },
    [onMutate, floor.id, activeSystemId, onSelect, onToolDone]
  );

  /** Save: pin the room to the plan. A fresh room goes on to wall-marking; a
      re-opened one returns to its modal. Either way it stops being draggable. */
  const saveRoomAdjust = useCallback(() => {
    if (!adjust) return;
    const room = rooms.find((r) => r.id === adjust.id);
    setAdjust(null);
    if (!room) return;
    if (adjust.isNew) {
      setWallSelect({
        points: room.geometry.points,
        selected: new Set(),
        roomId: adjust.id,
        isNew: true,
      });
    } else {
      onRoomCreated?.(adjust.id);
    }
  }, [adjust, rooms, onRoomCreated]);

  /** Discard a just-drawn room. Re-opened rooms have no discard — their edits
      are already in history, so Ctrl-Z is the way back. */
  const discardRoomAdjust = useCallback(() => {
    if (!adjust?.isNew) return;
    const { id } = adjust;
    setAdjust(null);
    onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== id) }));
    onSelect(null);
  }, [adjust, onMutate, onSelect]);

  const confirmWallSelect = useCallback(() => {
    if (!wallSelect) return;
    const { points, selected, roomId } = wallSelect;
    const walls = [...selected].sort((a, b) => a - b);
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
    setWallSelect(null);
    onToolDone();
    onRoomCreated?.(roomId); // the load modal (fresh room) / back to it (re-mark)
  }, [wallSelect, floor.northDeg, onMutate, onToolDone, onRoomCreated]);

  const cancelWallSelect = useCallback(() => {
    if (!wallSelect) return;
    const { roomId, isNew } = wallSelect;
    setWallSelect(null);
    onToolDone();
    // a fresh room falls back to sizing; re-marking returns to the modal
    if (isNew) setAdjust({ id: roomId, isNew: true });
    else onRoomCreated?.(roomId);
  }, [wallSelect, onToolDone, onRoomCreated]);

  /* ── THE MODAL'S TWO ONE-SHOT REQUESTS ──
     The room modal never reaches into the canvas. It sets a prop to a room id
     ("re-mark this room's walls", "let me reshape this room"), the canvas
     consumes it, and `onRemarkConsumed`/`onReshapeConsumed` clear it again.

     Both are DERIVED DURING RENDER rather than applied in an effect. That is
     React's own shape for adjusting state when a prop changes, and here it is
     also what lets this component compile: a `setState` in an effect body
     breaks a React rule, and React Compiler refuses any component carrying a
     suppression for one — see the note at the top of this file.

     THE COMPARISON IS AGAINST THE PREVIOUS VALUE, not against a set of ids
     already seen, and that distinction is the whole behaviour. The parent
     clears the id the instant it is consumed, so pressing the same button
     twice arrives as null → "rm1" → null → "rm1". Anything remembering
     "I have handled rm1 already" swallows the second press, and the button
     quietly stops working the second time you use it on a room.
     canvas-remark.test.tsx pins exactly that. */
  const remarkRoom =
    remarkRoomId ? doc.objects.find((o) => o.id === remarkRoomId) ?? null : null;
  const [prevRemarkId, setPrevRemarkId] = useState<string | null>(null);
  if (remarkRoomId !== prevRemarkId) {
    setPrevRemarkId(remarkRoomId);
    if (remarkRoom && remarkRoom.geometry.kind === "polygon") {
      const walls = Array.isArray(remarkRoom.props.externalWalls)
        ? (remarkRoom.props.externalWalls as number[])
        : [];
      setWallSelect({
        points: remarkRoom.geometry.points,
        selected: new Set(walls),
        roomId: remarkRoom.id,
        isNew: false,
      });
    }
  }

  const reshapeRoom =
    reshapeRoomId ? doc.objects.find((o) => o.id === reshapeRoomId) ?? null : null;
  const reshapable = !!reshapeRoom && reshapeRoom.geometry.kind === "polygon";
  const [prevReshapeId, setPrevReshapeId] = useState<string | null>(null);
  if (reshapeRoomId !== prevReshapeId) {
    setPrevReshapeId(reshapeRoomId);
    if (reshapable) setAdjust({ id: reshapeRoomId as string, isNew: false });
  }

  /* Telling the parent stays in an effect, because `onSelect` and the two
     `on*Consumed` callbacks belong to somebody else's component and calling
     them mid-render is the one thing React genuinely forbids.

     No dependency array on purpose. The callbacks are inline arrows from the
     parent, so naming them would re-fire this on every parent render, and
     naming only the ids is the stale-closure suppression this replaced. The
     truthiness guard is what bounds it: the parent nulls the id in response,
     so this settles in one extra render, and a repeat call is harmless
     anyway — setting the same null twice does not re-render. */
  useEffect(() => {
    if (remarkRoomId) onRemarkConsumed?.();
  });

  useEffect(() => {
    if (!reshapeRoomId) return;
    if (reshapable) onSelect(reshapeRoomId);
    onReshapeConsumed?.();
  });

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
  const hitSystemObject =
    (w: Point): { id: string; kind: "unit" | "riser" | "pipe-run" | "plenum" } | null => {
      for (let i = plenums.length - 1; i >= 0; i--) {
        const s = plenumShapes.get(plenums[i].id);
        if (s && pointInPolygon(w, s.body)) return { id: plenums[i].id, kind: "plenum" };
      }
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        const at = pointAt(u);
        const fp = footprint(Number(u.props.widthMm ?? 800), Number(u.props.depthMm ?? 300));
        /* turn the POINT back into the unit's own frame rather than growing a
           bounding box — a rotated unit is grabbed by the footprint you can
           actually see */
        const deg =
          liveRotate?.id === u.id
            ? liveRotate.deg
            : (u.geometry as { rotation?: number }).rotation ?? 0;
        const rad = (-deg * Math.PI) / 180;
        const dx = w.x - at.x;
        const dy = w.y - at.y;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        if (Math.abs(lx) <= fp.w / 2 && Math.abs(ly) <= fp.h / 2)
          return { id: u.id, kind: "unit" };
      }
      for (let i = risers.length - 1; i >= 0; i--) {
        if (dist(pointAt(risers[i]), w) <= 12 / vp.zoom)
          return { id: risers[i].id, kind: "riser" };
      }
      const tol = HIT_EDGE_PX / vp.zoom;
      for (let i = runs.length - 1; i >= 0; i--) {
        const pts = runs[i].geometry.points;
        // curved runs are grabbed by the curve you can see, not the dots
        if (isCurvedRun(runs[i])) {
          if (distToSmoothed(w, pts) <= tol)
            return { id: runs[i].id, kind: "pipe-run" };
          continue;
        }
        for (let j = 0; j < pts.length - 1; j++) {
          if (distToSegment(w, pts[j], pts[j + 1]) <= tol)
            return { id: runs[i].id, kind: "pipe-run" };
        }
      }
      return null;
    };

  /* ── notes (the markup layer) ────────────────────────────────────────────
     Every measurement of a note — where its words sit, what you can click,
     what has to fit on paper — goes through ONE font size, so the text you
     click is always the text you can see. ── */
  const noteFontW = NOTE_FONT_PX / Math.max(vp.zoom, 1);

  /** a note as it stands RIGHT NOW: mid-drag that is the live position, at
      rest it is the document's */
  const noteAt = (o: NoteObject): NoteObject => {
    if (!liveNote || liveNote.id !== o.id) return o;
    if ("leader" in liveNote)
      return { ...o, props: { ...o.props, leader: liveNote.leader } };
    return moveNote(o, liveNote.dx, liveNote.dy) as NoteObject;
  };

  /** topmost note under the pointer, and which part of it — newest first, so
      a note drawn over an older one takes the click */
  const hitNote = (w: Point, tolPx = HIT_EDGE_PX) => {
    const tol = tolPx / vp.zoom;
    for (let i = notes.length - 1; i >= 0; i--) {
      const part = noteHit(noteAt(notes[i]), w, tol, noteFontW);
      if (part) return { id: notes[i].id, part };
    }
    return null;
  };

  const commitNote = (rect: NoteRect, leader: Point) => {
    const note = createNote({ floorId: floor.id, rect, leader });
    onMutate((d) => ({ ...d, objects: [...d.objects, note] }));
    onSelect(note.id);
    // straight into the words: a cloud with nothing to say is not a note
    setNoteEdit({ id: note.id, text: "" });
    onToolDone();
  };

  const saveNoteText = (id: string, text: string) => {
    const trimmed = text.trim();
    onMutate((d) => ({
      ...d,
      /* a note nobody typed into is not markup, it is a stray cloud — closing
         the box empty takes it back off the drawing rather than leaving a
         mystery balloon pointing at nothing */
      objects: trimmed
        ? d.objects.map((o) =>
            o.id === id ? { ...o, props: { ...o.props, text: trimmed } } : o
          )
        : d.objects.filter((o) => o.id !== id),
    }));
    if (!trimmed && selectedId === id) onSelect(null);
    setNoteEdit(null);
  };

  /* Eraser: objects only (a room deletes by selecting it and pressing Delete,
     which carries its units — canvas rule #6).
     A pipe loses just its nearest segment (one vertex) unless it's down to a
     single segment; units/risers delete whole. Forgiving hit tolerance. */
  const eraseAt =
    (w: Point) => {
      const tol = ERASE_HIT_PX / vp.zoom;
      // notes sit above the drawing, so the eraser meets them first. A note
      // goes whole — half a note is a leader pointing at nothing.
      const note = hitNote(w, ERASE_HIT_PX);
      if (note) {
        onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== note.id) }));
        if (selectedId === note.id) onSelect(null);
        if (noteEdit?.id === note.id) setNoteEdit(null);
        return;
      }
      // units next (on top of the plan), then risers
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
      // runs (pipe/drain/cable) — nearest segment across all runs. A curved
      // run is HIT by its visible curve, but the segment picked is still the
      // nearest control segment — that's the dot the splice removes.
      let bestRun: string | null = null, bestSeg = -1, bestDist = tol;
      for (let i = runs.length - 1; i >= 0; i--) {
        const pts = runs[i].geometry.points;
        const curved = isCurvedRun(runs[i]);
        // the gate is the distance to what's visible; the ranking too
        const gate = curved ? distToSmoothed(w, pts) : Infinity;
        if (curved && gate >= bestDist) continue;
        let segI = -1, segD = Infinity;
        for (let j = 0; j < pts.length - 1; j++) {
          const d = distToSegment(w, pts[j], pts[j + 1]);
          if (d < segD) { segD = d; segI = j; }
        }
        const d = curved ? gate : segD;
        if (d < bestDist && segI >= 0) { bestDist = d; bestRun = runs[i].id; bestSeg = segI; }
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
    };

  /* ── Stage-4 document intents ── */
  const addUnit = useCallback(
    (at: Point) => {
      if (!placing || !activeSystemId) return;
      onMutate((d) => {
        /* an IDU dropped inside a room is ATTRIBUTED to it (units → spaces);
           dropping into another system's room also adopts that room into this
           system's served list (the user's call: drop adopts). A split IDU
           dropped OUTSIDE every room still serves the lens room — the plan's
           own "Bulkhead AC in the hallway void" case; containment wins
           whenever there is containment. */
        const room =
          placing.role === "idu"
            ? (roomAtPoint(d.objects, floor.id, at) ?? lensRoom(d, activeSystemId))
            : null;
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
      // what the armed Draw tool commits: the type + its picked-at-draw props
      const runKind: { type: string; props: Record<string, unknown> } =
        tool === "drain"
          ? { type: "drain-run", props: { sizeMm: draw.drainMm } }
          : tool === "cable"
            ? { type: "cable-run", props: { kind: draw.cableKind } }
            : {
                type: "pipe-run",
                // hard-drawn is the default every pre-Draw run already is —
                // only soft is worth a word on the document
                props: draw.pipeForm === "soft" ? { form: "soft" } : {},
              };
      onMutate((d) => ({
        ...d,
        objects: [
          ...d.objects,
          {
            id: newId("obj"),
            type: runKind.type,
            systemId: activeSystemId,
            floorId: floor.id,
            geometry: { kind: "polyline", points },
            plane: "room",
            props: {
              ...runKind.props,
              ...(startAttach ? { startAttach } : {}),
              ...(endAttach ? { endAttach } : {}),
            },
          } satisfies DesignObject,
        ],
      }));
      setDraftPipe([]);
      pipeStartAttach.current = null;
    },
    [activeSystemId, onMutate, floor.id, tool, draw, setDraftPipe]
  );

  /* Enter finishes a drawn run open — the ending that can't misfire. The
     double-click's own first click lands an extra dot (collapsed at commit,
     see onDoubleClick), but a key adds nothing. */
  useEffect(() => {
    if (!isRunTool(tool)) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Enter") commitPipe(draftPipe, null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, draftPipe, commitPipe]);

  /* ── pointer handlers ── */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    const pan = () =>
      setDrag({ kind: "pan", startScreen: { x: e.clientX, y: e.clientY }, origVp: vp });
    /* A click-to-place tool no longer commits on pointer-DOWN. It parks the
       placement here and waits: drag past the slop and the gesture pans
       instead (see TAP_SLOP_PX), release in place and `commit` runs. Without
       this the only way to move the plan mid-calibration was middle-drag or
       hold-Space — and Space is swallowed the moment focus is in the
       measurement field. */
    const tap = (commit: () => void) =>
      setDrag({
        kind: "tap-pan",
        startScreen: { x: e.clientX, y: e.clientY },
        origVp: vp,
        commit,
      });

    /* The optional call is hoisted OUT of the try on purpose: React Compiler
       1.0 cannot handle a value block (here, optional chaining) inside a
       try/catch, and refuses the whole component when it meets one. See the
       note at the top of this file — this is one of the two blockers. */
    const capTarget = e.target as Element;
    if (capTarget.setPointerCapture) {
      try {
        capTarget.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }
    }

    if (e.button === 1 || spaceDown.current) return pan();
    if (e.button !== 0) return;

    // simulating: the canvas is read-only — every drag is a pan
    if (sim) return pan();

    // wall-marking captures clicks: toggle the nearest edge as external
    if (wallSelect) {
      tap(() => {
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
        if (hit < 0) return;
        setWallSelect((ws) => {
          if (!ws) return ws;
          const sel = new Set(ws.selected);
          if (sel.has(hit)) sel.delete(hit);
          else sel.add(hit);
          return { ...ws, selected: sel };
        });
      });
      return;
    }

    switch (tool) {
      case "select": {
        /* markup first: a note is drawn over the work, so it is what a click
           on it means. Grabbed by its OUTLINE and its words only — the middle
           of a cloud is full of the rooms and units it is drawn around, and
           those still have to be clickable through it. */
        const nh = hitNote(w);
        if (nh) {
          onSelect(nh.id);
          const grabbed = notes.find((x) => x.id === nh.id)!;
          setDrag(
            nh.part === "text"
              ? {
                  kind: "note-leader",
                  id: nh.id,
                  startWorld: w,
                  orig: noteLeader(grabbed),
                }
              : { kind: "note-move", id: nh.id, startWorld: w }
          );
          break;
        }
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
          if (su) {
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
          /* A saved room is PINNED: it selects on click but drags the plan, so
             panning across a drawing can't take a whole space with it. Only
             the room being adjusted moves — and only for the system that drew
             it (foreign rooms stay inspect-only). */
          if (roomEditable(room) && adjust?.id === hit) {
            // units stamped to this room travel with the move
            setDrag({
              kind: "move",
              id: hit,
              startWorld: w,
              orig: roomPoints(room),
              memberIds: roomMemberIds(doc.objects, hit),
            });
          } else {
            pan();
          }
        } else {
          onSelect(null);
          pan();
        }
        break;
      }
      case "place": {
        tap(() => addUnit(w));
        break;
      }
      case "component": {
        // Step 2 ships the plenum: land on the glowing AHU end
        tap(() => {
          const end = nearestPlenumEnd(w);
          if (end) addPlenum(end);
        });
        break;
      }
      case "pipe":
      case "drain":
      case "cable": {
        tap(() => {
          const anchor = nearestAnchor(w);
          // free first vertex; later vertices ortho-snap to the previous point
          // so runs stay horizontal/vertical (anchors always win). The curved
          // draws — soft pipe, cable — place their dots free: the smoothing
          // is the point.
          const curved = tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft");
          const prev = draftPipe[draftPipe.length - 1];
          const p = anchor ? anchor.at : prev && !curved ? orthoSnap(prev, w) : w;
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
        });
        break;
      }
      case "riser": {
        tap(() => addRiser(w));
        break;
      }
      case "room-poly": {
        tap(() => {
          if (draftPoly.length >= 3) {
            const firstScreen = worldToScreen(draftPoly[0], vp);
            const hereScreen = worldToScreen(w, vp);
            if (dist(firstScreen, hereScreen) <= CLOSE_SNAP_PX) {
              beginRoomAdjust(draftPoly, "poly");
              setDraftPoly([]);
              return;
            }
          }
          setDraftPoly((pts) => [...pts, w]);
        });
        break;
      }
      case "room-rect":
        setDrag({ kind: "rect", start: w });
        setDraftRect({ a: w, b: w });
        break;
      /* Two gestures, in the order the drawing is read: cloud what you are
         talking about, THEN say where the words go. The second click is a tap
         (so the plan can still be panned between the two) and it is what
         commits — until then nothing is on the document. */
      case "note": {
        if (notePin) {
          const pin = notePin;
          tap(() => {
            setNotePin(null);
            commitNote(pin, w);
          });
        } else {
          setDrag({ kind: "note-rect", start: w });
          setNoteDraft({ a: w, b: w });
        }
        break;
      }
      case "calibrate": {
        tap(() =>
          setCalib((c) => (!c.a ? { a: w } : !c.b ? { a: c.a, b: w } : c))
        );
        break;
      }
      case "set-north": {
        // drop the arrow at the click; keep any existing rotation
        tap(() => {
          const deg = floor.northDeg ?? 0;
          onMutate((d) => ({
            ...d,
            floors: d.floors.map((f) =>
              f.id === floor.id ? { ...f, northPos: { x: w.x, y: w.y }, northDeg: deg } : f
            ),
            objects: redetectOrientations(d.objects, floor.id, deg),
          }));
          onToolDone();
        });
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
        tap(() => eraseAt(w));
        break;
      }
      /* the ONE tool where a left-drag must not pan: the drag IS the
         measurement. Panning while measuring stays on middle-drag / Space. */
      case "measure": {
        setDrag({ kind: "tape", from: w });
        setTape({ a: w, b: w });
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
    /* Hover naming is a RESTING read: it goes quiet the moment a gesture, a
       drawing tool or the simulation takes over, so it can never sit over the
       work in hand — and during sim that corner is the sim's own readout. */
    const hit = drag || tool !== "select" || sim ? null : hitSystemObject(w);
    setHoverUnitId(hit?.kind === "unit" ? hit.id : null);
    if (!drag) return;
    switch (drag.kind) {
      case "pan": {
        const dx = (e.clientX - drag.startScreen.x) / vp.zoom;
        const dy = (e.clientY - drag.startScreen.y) / vp.zoom;
        if (dx || dy) userFramed.current = true;
        setVp({ ...vp, x: drag.origVp.x - dx, y: drag.origVp.y - dy });
        break;
      }
      /* the gesture is still undecided — the moment it travels past the slop
         it stops being a placement and becomes a pan, and the parked commit
         is dropped with it */
      case "tap-pan": {
        const dxs = e.clientX - drag.startScreen.x;
        const dys = e.clientY - drag.startScreen.y;
        if (Math.abs(dxs) <= TAP_SLOP_PX && Math.abs(dys) <= TAP_SLOP_PX) break;
        userFramed.current = true;
        setDrag({ kind: "pan", startScreen: drag.startScreen, origVp: drag.origVp });
        setVp({
          ...vp,
          x: drag.origVp.x - dxs / vp.zoom,
          y: drag.origVp.y - dys / vp.zoom,
        });
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
      case "note-rect":
        setNoteDraft({ a: drag.start, b: w });
        break;
      case "note-move":
        setLiveNote({
          id: drag.id,
          dx: w.x - drag.startWorld.x,
          dy: w.y - drag.startWorld.y,
        });
        break;
      case "note-leader":
        setLiveNote({
          id: drag.id,
          leader: {
            x: drag.orig.x + (w.x - drag.startWorld.x),
            y: drag.orig.y + (w.y - drag.startWorld.y),
          },
        });
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
      case "tape": {
        // Shift holds the tape square to the plan, like the pipe tool
        setTape({ a: drag.from, b: e.shiftKey ? orthoSnap(drag.from, w) : w });
        break;
      }
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    // released without travelling: the gesture was a click after all
    if (drag.kind === "tap-pan") {
      drag.commit();
      setDrag(null);
      return;
    }
    // letting go of the tape clears it — the reading was the whole point
    if (drag.kind === "tape") {
      setTape(null);
      setDrag(null);
      return;
    }
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
        beginRoomAdjust(
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
    /* the cloud is drawn; it now waits to be told where its words go. A drag
       that never travelled was a stray click, not a cloud. */
    if (drag.kind === "note-rect" && noteDraft) {
      const minW = NOTE_MIN_PX / vp.zoom;
      const rect = rectFromDrag(noteDraft.a, noteDraft.b);
      setNoteDraft(null);
      if (rect.w >= minW && rect.h >= minW) setNotePin(rect);
    }
    if ((drag.kind === "note-move" || drag.kind === "note-leader") && liveNote) {
      const live = liveNote;
      const moved =
        "leader" in live
          ? drag.kind === "note-leader" &&
            (live.leader.x !== drag.orig.x || live.leader.y !== drag.orig.y)
          : Math.abs(live.dx) > 1e-6 || Math.abs(live.dy) > 1e-6;
      if (moved) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.map((o) => {
            if (o.id !== live.id || !isNote(o)) return o;
            return "leader" in live
              ? { ...o, props: { ...o.props, leader: { x: live.leader.x, y: live.leader.y } } }
              : moveNote(o, live.dx, live.dy);
          }),
        }));
      }
      setLiveNote(null);
    }
    if (drag.kind === "point" && livePoint) {
      const { id, at } = livePoint;
      if (at.x !== drag.orig.x || at.y !== drag.orig.y) {
        onMutate((d) => {
          const moved = d.objects.find((o) => o.id === id);
          /* moving an IDU re-derives its room attribution (unless the user
             pinned it manually via roomLock) — and adopts a foreign room the
             same way a fresh drop does. Outside every room, a split falls
             back to its lens room, so nudging a bulkhead along the hallway
             never silently un-serves the room it was placed for. */
          const restamp =
            moved?.type === "unit" &&
            moved.props.role === "idu" &&
            !moved.props.roomLock;
          const room = restamp
            ? (roomAtPoint(d.objects, moved!.floorId, at) ??
              lensRoom(d, moved!.systemId ?? null))
            : null;
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
                /* spread the geometry rather than rebuilding it: a point also
                   carries `rotation`, and replacing the object dropped it —
                   so moving a unit you had turned snapped it back to 0°. Only
                   point geometry starts this drag (see the `point` drag kind),
                   so anything else is left alone. */
                if (o.geometry.kind !== "point") return o;
                const next = { ...o, geometry: { ...o.geometry, at } };
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

  /* ── right-click disarms: whatever tool is up, a right-click drops any
     in-progress draft and hands back to Select (Isaac, 2026-08-24). Only a
     resting Select keeps the browser's own menu. ── */
  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    if (sim) return;
    const draftUp =
      draftPipe.length > 0 ||
      draftPoly.length > 0 ||
      draftRect !== null ||
      wallSelect !== null ||
      noteDraft !== null ||
      notePin !== null;
    if (tool === "select" && !draftUp) return;
    e.preventDefault();
    setDraftPipe([]);
    pipeStartAttach.current = null;
    setDraftPoly([]);
    setDraftRect(null);
    setCalib({});
    setCalibMeters("");
    setWallSelect(null);
    setNoteDraft(null);
    setNotePin(null);
    onToolDone();
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

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (sim) return;
    /* double-click a room to open it (Isaac, 2026-08-25) — the same modal the
       panel's room row opens, and the same one the room was created through.
       Select only: while a tool is armed the gesture belongs to that tool, and
       the run tools below use a double-click to END a line.

       Markup is checked FIRST, for the same reason a single click is: a note
       is drawn over the work, so double-clicking one opens ITS words, not the
       room it happens to be clouding. */
    if (tool === "select") {
      const w = toWorld(e);
      const nh = hitNote(w);
      const note = nh ? notes.find((x) => x.id === nh.id) : null;
      if (note) {
        onSelect(note.id);
        setNoteEdit({ id: note.id, text: noteText(note) });
        return;
      }
      const hit = roomAtPoint(doc.objects, floor.id, w);
      if (hit) {
        onOpenRoom?.(hit.id);
        return;
      }
    }
    if (tool === "room-poly" && draftPoly.length >= 3) {
      beginRoomAdjust(draftPoly, "poly");
      setDraftPoly([]);
    }
    // double-click ends a drawn run without an end anchor (open run). Its own
    // clicks landed as dots first, so the tail carries one or two duplicates
    // within a click's travel of each other — collapse them before the commit
    // or every run ends with an extra tiny stub.
    if (isRunTool(tool) && draftPipe.length >= 2) {
      const tol = (TAP_SLOP_PX * 1.5) / vp.zoom;
      const pts = [...draftPipe];
      while (pts.length >= 2 && dist(pts[pts.length - 1], pts[pts.length - 2]) <= tol)
        pts.pop();
      // everything collapsed into one spot: a dot is not a line — keep drafting
      if (pts.length >= 2) commitPipe(pts, null);
    }
  };

  const startVertexDrag = (id: string, index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    /* The optional call is hoisted OUT of the try on purpose: React Compiler
       1.0 cannot handle a value block (here, optional chaining) inside a
       try/catch, and refuses the whole component when it meets one. See the
       note at the top of this file — this is one of the two blockers. */
    const capTarget = e.target as Element;
    if (capTarget.setPointerCapture) {
      try {
        capTarget.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }
    }
    const room = rooms.find((r) => r.id === id);
    // corners only pull on the room being sized — saved rooms are pinned
    if (room && adjust?.id === id)
      setDrag({ kind: "vertex", id, index, orig: roomPoints(room) });
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

  /* ── drop-to-attribute readout: while an indoor unit rides the cursor,
     every room reads how the armed capacity sits against its OWN load —
     the browser's ranking made spatial — and the room that would take the
     drop (containment, else the split's lens room) carries the verdict. ── */
  const armedIdu = tool === "place" && placing != null && placing.role === "idu";
  const armedLens = useMemo(
    () => (armedIdu ? lensRoom(doc, activeSystemId) : null),
    [armedIdu, doc, activeSystemId]
  );
  const dropTargetId = armedIdu
    ? ((cursor ? roomAtPoint(doc.objects, floor.id, cursor)?.id : null) ??
      armedLens?.id ??
      null)
    : null;

  /* what the corner card says about the hovered unit. Everything the labels
     used to spell out on the plan, plus the things that never fitted there —
     capacity, form factor, the room it serves. Selection is unaffected: this
     is a read, and clicking still opens the unit in the inspector. */
  const hoverCard = useMemo(() => {
    const u = hoverUnitId ? units.find((x) => x.id === hoverUnitId) : null;
    if (!u) return null;
    const isIdu = String(u.props.role ?? "idu") === "idu";
    const model = String(u.props.model ?? "");
    const spec = isIdu ? (iduSpec?.(model) ?? null) : (oduSpec?.(model) ?? null);
    const roomId = u.props.roomId
      ? String(u.props.roomId)
      : isIdu
        ? (roomAtPoint(doc.objects, u.floorId, pointAt(u))?.id ?? null)
        : null;
    return {
      model,
      colour: sysColour.get(u.systemId ?? "") ?? "#888",
      role: isIdu ? "Indoor unit" : "Outdoor unit",
      system: doc.systems.find((s) => s.id === u.systemId)?.name ?? null,
      kind:
        spec && "form_factor" in spec
          ? formFactorLabel(spec.form_factor)
          : spec
            ? spec.series
            : null,
      capacity: spec
        ? `${spec.capacity_cool_kw} kW cool · ${spec.capacity_heat_kw} kW heat`
        : null,
      room: roomId
        ? ((rooms.find((r) => r.id === roomId)?.props.name as string | undefined) ?? null)
        : null,
      size: `${Math.round(Number(u.props.widthMm ?? 0))} × ${Math.round(
        Number(u.props.depthMm ?? 0)
      )} mm`,
    };
  }, [hoverUnitId, units, iduSpec, oduSpec, doc.objects, doc.systems, rooms, sysColour, pointAt]);
  const activeColour = sysColour.get(activeSystemId ?? "") ?? "#888";
  const calibScreenB = calib.b ? worldToScreen(calib.b, vp) : null;

  /* Which end of the canvas the room panel should take. The bottom slot is
     home, but it's also where the room's bottom wall usually sits — and you
     can't click a wall through a panel. Whichever slot covers less of the
     room wins. */
  const panelSlot = (pts: Point[]) => {
    const s = pts.map((p) => worldToScreen(p, vp));
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    return dodgeSlot({
      rect: {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      },
      panel: roomPanel,
      box: size,
    });
  };

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
          /* the pan is named here because it is the whole reason the two
             points can be picked accurately — you can bring the far end of
             the wall into view without dropping the first point. Both routes
             are named: scroll is the trackpad's (a laptop has no middle
             button, and Space is swallowed by the measurement field), drag
             past the slop is the mouse's. */
          text: calib.a
            ? "Click the second point of the known dimension · scroll or drag to pan"
            : "Select two points a known distance apart · scroll or drag to pan",
        }
      : tool === "measure"
        ? { icon: "ruler", text: "Drag across anything to measure it — nothing is saved" }
      /* the room tools say their piece HERE now that the shape pill has moved
         into the cockpit — this and the crosshair are the canvas's whole half
         of the conversation, so Esc has to be named */
      : tool === "room-rect"
        ? { icon: "square", text: "Drag a rectangle over the room · Esc to cancel" }
      : tool === "room-poly"
        ? {
            icon: "hexagon",
            text:
              draftPoly.length >= 3
                ? "Click the first point to close the room · Esc to cancel"
                : "Click each corner of the room · Esc to cancel",
          }
      /* the drawn runs: the curved tools are new grammar (dots → curve), so
         the canvas says how a line ENDS — the one thing a first draw can't
         guess */
      : isRunTool(tool)
        ? {
            icon: tool === "cable" ? "zap" : tool === "drain" ? "droplet" : "pipe",
            text:
              tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft")
                ? "Place dots — the line curves through them · Enter, double-click or an anchor ends it · Esc to cancel"
                : "Click each corner · Enter, double-click or an anchor ends it · Esc to cancel",
          }
      : tool === "note"
        ? {
            icon: "note",
            text: notePin
              ? "Now click where the words go — out past the edge of the plan · Esc to cancel"
              : "Drag a box around what the note is about · Esc to cancel",
          }
      : tool === "set-north"
        ? floor.northPos
          ? { icon: "rotate", text: "Drag the N to rotate · drag the centre to move" }
          : { icon: "rotate", text: "Click to place the north marker · scroll or drag to pan" }
        : tool === "crop"
          ? { icon: "maximize", text: "Drag a rectangle over the area to keep" }
          : tool === "component" && component?.kind === "plenum"
            ? {
                icon: "wind",
                text: `Click a glowing air-handler end to fit the ${component.stream} plenum`,
              }
            : tool === "place" && placing
              ? {
                  icon: "unit",
                  /* the gesture IS the attribution — say so while it's armed */
                  text:
                    placing.role === "idu"
                      ? "Drop it in the room it serves · Esc to cancel"
                      : "Click where the outdoor unit sits · Esc to cancel",
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
        onPointerLeave={() => setHoverUnitId(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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
            if (!dims) return null;
            const pos = sheetPos(s);
            if (!url) {
              /* the raster is still on its way (first open of a design — after
                 that it comes off the local cache). Hold its footprint rather
                 than showing bare grid, so the plan lands INTO its frame
                 instead of arriving out of nowhere. */
              return (
                <rect
                  key={s.id}
                  className="ds-sheet-loading"
                  x={pos.x}
                  y={pos.y}
                  width={dims.w}
                  height={dims.h}
                />
              );
            }
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
            // the room being sized reads as loose (dashed) until it's saved
            const loose = adjust?.id === r.id;
            /* while an IDU is armed the fit verdict IS the room's paint;
               rooms with no load yet read neutral rather than pretending */
            const armLoad = armedIdu ? roomLoadKw(doc, r as RoomObj) : null;
            const armFit: UnitFit | null =
              armedIdu && placingKw != null && armLoad != null && armLoad > 0
                ? capacityFit(placingKw, armLoad, OVERSIZE_CAP)
                : null;
            const isTarget = armedIdu && dropTargetId === r.id;
            const covFit = roomFits?.[r.id];
            return (
              <g
                key={r.id}
                className={`ds-room${selected ? " sel" : ""}${ghost ? " ghost" : ""}${
                  loose ? " loose" : ""
                }${armedIdu ? ` armfit-${armFit ?? "none"}` : ""}${
                  isTarget ? " droptgt" : ""
                }`}
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
                      {/* the verdict that PERSISTS after a drop — a room served
                          by the wrong size keeps saying so; a state, never a
                          block (ranking-not-gating) */}
                      {covFit && (
                        <tspan className={`ds-room-covfit ${covFit}`}>
                          {covFit === "oversized" ? " · oversized" : " · undersized"}
                        </tspan>
                      )}
                    </text>
                  </>
                )}
                {/* the drop's verdict, on the room that would take it — the
                    lens room keeps carrying it while the cursor is outside
                    every room (that drop attributes here) */}
                {isTarget && placing && (
                  <text
                    x={c.x}
                    y={c.y + 32 / labelZoom}
                    fontSize={11 / labelZoom}
                    className={`ds-room-verdict${armFit ? ` ${armFit}` : ""}`}
                  >
                    {armFit === "fits"
                      ? `${placing.model} fits — needs ≈${armLoad!.toFixed(1)} kW`
                      : armFit === "oversized"
                        ? `${placing.model} oversized — needs ≈${armLoad!.toFixed(1)} kW`
                        : armFit === "undersized"
                          ? `${placing.model} won't hold it — needs ≈${armLoad!.toFixed(1)} kW`
                          : `${placing.model} lands here`}
                  </text>
                )}
                {loose &&
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

          {/* drawn runs (Stage 4 + Draw tools) — system colour, length when
              calibrated. Pipe wears the pairing's line sizes (per-run props
              override); drain wears its picked size; cable its kind. Curved
              runs (soft pipe, cable) render the smoothed spline through their
              dots. */}
          {layers.pipes && runs.map((r) => {
            const pts = liveRunPoints(r);
            const colour = sysColour.get(r.systemId ?? "") ?? "#888";
            const midI = Math.floor((pts.length - 1) / 2);
            const mid = {
              x: (pts[midI].x + pts[Math.min(midI + 1, pts.length - 1)].x) / 2,
              y: (pts[midI].y + pts[Math.min(midI + 1, pts.length - 1)].y) / 2,
            };
            const curved = isCurvedRun(r);
            const cls =
              r.type === "drain-run" ? "ds-drain" : r.type === "cable-run" ? "ds-cable" : "ds-pipe";
            const len = mm
              ? formatMeters(
                  unitsToMeters(curved ? smoothedLength(pts) : polylineLength(pts), mm)
                )
              : null;
            let tag: string | null = null;
            if (r.type === "pipe-run") {
              const auto = runSizes?.get(r.systemId ?? "") ?? null;
              const liq = Number(r.props.liquidMm) || auto?.liquidMm || null;
              const gas = Number(r.props.gasMm) || auto?.gasMm || null;
              tag = liq && gas ? `Ø${liq}/${gas}` : null;
            } else if (r.type === "drain-run") {
              tag = `Ø${Number(r.props.sizeMm) || 25} drain`;
            } else if (r.type === "cable-run") {
              tag = r.props.kind === "data" ? "Data" : "Power";
            }
            const label = [len, tag].filter(Boolean).join(" · ");
            return (
              <g
                key={r.id}
                className={`${cls}${r.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                {curved ? (
                  <path d={smoothPathD(pts)} />
                ) : (
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                )}
                {label && layers.labels && (
                  <text x={mid.x} y={mid.y - 7 / labelZoom} fontSize={11 / labelZoom} className="ds-pipe-len">
                    {label}
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
            /* air-capable ducted-form AHUs grow their air side (spec §1a):
               a straight-through flow arrow, dashed socket outlines on the
               unoccupied end faces, and the fused built-in return box */
            const air = ahuRow(u);
            const perMm = fp.w / Math.max(widthMm, 1);
            const ends = air ? ahuEnds.filter((e) => e.unit.id === u.id) : [];
            const sockD = 150 * perMm;
            const builtInD = 350 * perMm; // engine's default plenum depth
            const rot = unitRotDeg(u); // simple units only; AHUs stay at 0
            const rk = u.id === selectedId ? unitRotKnob(u) : null;
            return (
              <g
                key={u.id}
                className={`ds-unit${u.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                {/* the glyph and, on AHUs, its whole air side turn together */}
                <g transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined}>
                {unitGlyph(at.x, at.y, fp.w, fp.h, String(u.props.role ?? "idu"), zoom)}
                {(() => {
                  /* the airflow arrow + face labels appear only ONCE the unit
                     is determined — the first plenum, or a built-in return
                     (which orients the unit on its own). No `?` clutter and no
                     arrow on a bare unit (spec §1a). */
                  const oriented = ends.some((e) => e.determined);
                  if (!air || !oriented) return null;
                  const sdir = endFaceLocal(u, "supply").dir;
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
                          const f = endFaceLocal(e.unit, e.end);
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
                  // inside the rotate group: the unit's own frame
                  const f = endFaceLocal(e.unit, e.end);
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
                {/* No text on the unit. Role and model used to sit stacked on
                    every box, and with face labels, spigot diameters and pipe
                    lengths alongside them the plan stopped being readable. The
                    glyph and the system colour carry identity on the drawing;
                    hovering names the unit in the corner card, clicking opens
                    it in the inspector. (Print is a different renderer —
                    summary/plan-figure.tsx — and keeps the full labels, because
                    paper can't be hovered.) */}
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
                      /* the blank sits ACROSS the takeoff — the true tangent
                         (−ny, nx), so it stays square on a sloped side face */
                      <line
                        className="ds-spigot-cap"
                        x1={sp.cx + sp.ny * 4}
                        y1={sp.cy - sp.nx * 4}
                        x2={sp.cx - sp.ny * 4}
                        y2={sp.cy + sp.nx * 4}
                      />
                    )}
                    {/* the duct size sits ON its own takeoff, centred, where
                        the fitter is already looking — not rolled into one bar
                        under the plenum that has to be read back against the
                        drawing to work out which duct is which. */}
                    {layers.labels && (
                      <text
                        className="ds-spigot-dia"
                        x={sp.cx}
                        y={sp.cy}
                        fontSize={9 / labelZoom}
                      >
                        {formatDia(sp.diaMm, doc.settings.units)}
                      </text>
                    )}
                  </g>
                ))}
                {layers.labels && (
                  <text
                    className={`ds-plenum-label${s.derived ? " derived" : ""}`}
                    x={s.labelAt.x}
                    y={s.labelAt.y}
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
                    /* a polygon, not a rect: the zone stands off the face
                       along its own outward normal, so it stays on the face
                       when the AHU is turned */
                    const zone = [
                      f.a,
                      { x: f.a.x + f.out.x * zoneD, y: f.a.y + f.out.y * zoneD },
                      { x: f.b.x + f.out.x * zoneD, y: f.b.y + f.out.y * zoneD },
                      f.b,
                    ];
                    return (
                      <g key={`${e.unit.id}:${e.end}:${c.needsFlip ? "flip" : "as-is"}`}>
                        <polygon
                          className={`ds-plenum-dropzone${ready ? " ready" : ""}`}
                          points={zone.map((p) => `${p.x},${p.y}`).join(" ")}
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
                            // the ghost must promise the shape you'll get
                            stream: e.end,
                          });
                          const ghost = plenumShape({
                            cx: f.mid.x,
                            cy: f.mid.y,
                            out: f.out,
                            ax: f.ax,
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
          {isRunTool(tool) &&
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

          {/* run draft — straight tools preview the ortho-snapped tail, the
              curved ones preview the live spline through every dot */}
          {draftPipe.length > 0 &&
            (() => {
              const curved =
                tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft");
              const tail = cursor
                ? [
                    nearestAnchor(cursor)?.at ??
                      (curved
                        ? cursor
                        : orthoSnap(draftPipe[draftPipe.length - 1], cursor)),
                  ]
                : [];
              const pts = [...draftPipe, ...tail];
              return (
                <g className="ds-pipe-draft">
                  {curved ? (
                    <path d={smoothPathD(pts)} fill="none" />
                  ) : (
                    <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                  )}
                  {curved &&
                    draftPipe.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3 / zoom} className="dot" />
                    ))}
                  <circle cx={draftPipe[0].x} cy={draftPipe[0].y} r={4 / zoom} />
                </g>
              );
            })()}

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

          {/* tape measure — a reading in flight. Dashed and its own colour so
              it can't be mistaken for a pipe run or a calibration line, and
              gone the moment the pointer comes up. */}
          {tape && mm && (
            <g className="ds-tape" data-testid="tape-measure">
              <line x1={tape.a.x} y1={tape.a.y} x2={tape.b.x} y2={tape.b.y} />
              {[tape.a, tape.b].map((p, i) => (
                <line
                  key={i}
                  className="ds-tape-end"
                  x1={p.x}
                  y1={p.y - 6 / zoom}
                  x2={p.x}
                  y2={p.y + 6 / zoom}
                />
              ))}
              <text
                className="ds-tape-len"
                x={(tape.a.x + tape.b.x) / 2}
                y={(tape.a.y + tape.b.y) / 2 - 8 / labelZoom}
                fontSize={12 / labelZoom}
              >
                {formatMeters(unitsToMeters(dist(tape.a, tape.b), mm))}
              </text>
            </g>
          )}

          {/* ── markup: notes ──
              Drawn LAST inside the world group, so a note sits over the work
              it is about rather than under it — which is what a note on a
              drawing does. Cloud, leader and words are one <g>: the whole
              thing selects, moves and prints together. */}
          {notes.map((stored) => {
            const n = noteAt(stored);
            const rect = noteRect(n);
            const leader = noteLeader(n);
            const lay = noteTextLayout(rect, leader, noteText(n), noteFontW);
            const start = leaderStart(rect, leader);
            const on = stored.id === selectedId || noteEdit?.id === stored.id;
            return (
              <g key={stored.id} className={`ds-note${on ? " sel" : ""}`}>
                <path className="ds-note-cloud" d={cloudPath(rect)} />
                <polyline
                  className="ds-note-leader"
                  points={`${start.x},${start.y} ${lay.elbow.x},${lay.elbow.y} ${lay.shoulder.x},${lay.shoulder.y}`}
                />
                {/* the dot on the cloud is the drawing convention for "this
                    leader lands here", and it is also the grab handle */}
                <circle className="ds-note-dot" cx={start.x} cy={start.y} r={2.6 / vp.zoom} />
                <text
                  className="ds-note-text"
                  x={lay.textX}
                  y={lay.firstBaseline}
                  fontSize={noteFontW}
                  textAnchor={lay.anchor}
                >
                  {lay.lines.map((line, i) => (
                    <tspan key={i} x={lay.textX} dy={i === 0 ? 0 : lay.lineH}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

          {/* the cloud being dragged out — it is the shape you will get, not a
              box that turns into one on release */}
          {tool === "note" && noteDraft && (
            <g className="ds-note draft">
              <path className="ds-note-cloud" d={cloudPath(rectFromDrag(noteDraft.a, noteDraft.b))} />
            </g>
          )}
          {/* cloud drawn, waiting to be told where its words go: the leader
              rubber-bands to the cursor so the margin lands where you look */}
          {tool === "note" && notePin && (
            <g className="ds-note draft">
              <path className="ds-note-cloud" d={cloudPath(notePin)} />
              {cursor && (
                <polyline
                  className="ds-note-leader"
                  points={`${leaderStart(notePin, cursor).x},${
                    leaderStart(notePin, cursor).y
                  } ${cursor.x},${cursor.y}`}
                />
              )}
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

      {/* calibration prompt (absolute within the canvas, never position:fixed).
          Placement is measured, flips side near an edge and clamps inside the
          canvas — the card used to be positioned from two hard-coded numbers
          and got sliced off at the bottom. Reserves the tool-hint strip at the
          top and the readout HUD at the bottom. */}
      {calib.a && calib.b && calibScreenB && (
        <div
          className="ds-calib-card"
          ref={measureCalibCard}
          style={anchorFloating({
            anchor: calibScreenB,
            panel: calibCard,
            box: size,
            reserveTop: 46,
            reserveBottom: 40,
          })}
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

      {/* wall-marking panel — bottom-centre by default, top when the room's
          bottom edge is under that slot; never position:fixed */}
      {wallSelect &&
        (() => {
          const n = wallSelect.selected.size;
          return (
            <div
              className={`ds-wallsel-panel${
                panelSlot(wallSelect.points) === "top" ? " top" : ""
              }`}
              ref={measureRoomPanel}
              role="dialog"
              aria-label="Mark external walls"
            >
              <div className="ds-wallsel-title">Mark external walls</div>
              <div className="ds-wallsel-hint">
                Walls exposed to outside only — internal and party walls stay
                unmarked.
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

      {/* room sizing panel — the room is loose until this Save pins it */}
      {adjust &&
        (() => {
          const room = rooms.find((r) => r.id === adjust.id);
          if (!room) return null;
          const pts = roomPoints(room);
          const areaU = polygonArea(pts);
          return (
            <div
              className={`ds-wallsel-panel${panelSlot(pts) === "top" ? " top" : ""}`}
              ref={measureRoomPanel}
              role="dialog"
              aria-label="Size the room"
            >
              <div className="ds-wallsel-title">
                {adjust.isNew ? "Size the room" : "Edit the room"}
              </div>
              <div className="ds-wallsel-hint">
                Saving pins the room to the plan so panning can&apos;t drag it —
                reopen it any time with Edit shape.
              </div>
              <div className="ds-wallsel-count on">
                {mm ? formatArea(areaUnitsToM2(areaU, mm)) : "not calibrated"}
              </div>
              <div className="ds-wallsel-actions">
                {adjust.isNew && (
                  <button className="ds-calib-cancel" onClick={discardRoomAdjust}>
                    Discard
                  </button>
                )}
                <button className="ds-calib-ok" onClick={saveRoomAdjust}>
                  {/* not "Save room" — that's the load modal's own button */}
                  {adjust.isNew ? "Save & continue" : "Save shape"}
                </button>
              </div>
            </div>
          );
        })()}

      {/* the note's words. Anchored at the leader end — you type where the
          text will sit, so the margin you chose is the margin you see fill up.
          Absolute within the canvas, never position:fixed. */}
      {noteEdit &&
        (() => {
          const n = notes.find((x) => x.id === noteEdit.id);
          if (!n) return null;
          const at = worldToScreen(noteLeader(noteAt(n)), vp);
          return (
            <div
              className="ds-note-editor"
              ref={measureNotePanel}
              role="dialog"
              aria-label="Note"
              style={anchorFloating({
                anchor: at,
                panel: notePanel,
                box: size,
                reserveTop: 46,
                reserveBottom: 40,
              })}
            >
              <div className="ds-calib-t">Note</div>
              <textarea
                autoFocus
                rows={3}
                aria-label="Note text"
                value={noteEdit.text}
                onChange={(e) => setNoteEdit({ id: noteEdit.id, text: e.target.value })}
                onKeyDown={(e) => {
                  /* Enter commits, ⇧Enter breaks the line — a note is usually
                     one sentence, and the list is the exception */
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveNoteText(noteEdit.id, noteEdit.text);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    saveNoteText(noteEdit.id, noteEdit.text);
                  }
                }}
              />
              <div className="ds-note-actions">
                <button
                  className="ds-calib-cancel"
                  onClick={() => {
                    onMutate((d) => ({
                      ...d,
                      objects: d.objects.filter((o) => o.id !== noteEdit.id),
                    }));
                    if (selectedId === noteEdit.id) onSelect(null);
                    setNoteEdit(null);
                  }}
                >
                  Delete
                </button>
                <button
                  className="ds-calib-ok"
                  onClick={() => saveNoteText(noteEdit.id, noteEdit.text)}
                >
                  Done
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

      {/* what's under the pointer, named in the corner instead of on the plan */}
      {hoverCard && (
        <div className="ds-unitcard" role="status" aria-live="polite">
          <div className="ds-unitcard-h">
            <span className="ds-unitcard-sw" style={{ background: hoverCard.colour }} />
            <span className="ds-unitcard-role">{hoverCard.role}</span>
            {hoverCard.system && (
              <span className="ds-unitcard-sys">{hoverCard.system}</span>
            )}
          </div>
          <div className="ds-unitcard-model">{hoverCard.model || "No model yet"}</div>
          {hoverCard.kind && <div className="ds-unitcard-kind">{hoverCard.kind}</div>}
          <dl className="ds-unitcard-rows">
            {hoverCard.capacity && (
              <div>
                <dt>Capacity</dt>
                <dd>{hoverCard.capacity}</dd>
              </div>
            )}
            {hoverCard.room && (
              <div>
                <dt>Serves</dt>
                <dd>{hoverCard.room}</dd>
              </div>
            )}
            <div>
              <dt>Size</dt>
              <dd>{hoverCard.size}</dd>
            </div>
          </dl>
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
