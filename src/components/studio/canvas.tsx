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
  type CSSProperties,
} from "react";
import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import { Icon } from "@/components/shell/icon";
import { orientationFromWalls } from "@/lib/studio/loads";
import { lensRoom, roomAtPoint } from "@/lib/studio/coverage";
import { setHintsOn, useHintsOn } from "./hints";
import { setArmedInk } from "./note-ink";
import {
  calloutCloseAt,
  calloutContent,
  calloutLayout,
  calloutOf,
  defaultCalloutOffset,
  hitCallout,
  withCallout,
  withoutCallout,
  type CalloutLayout,
  type CalloutPlacement,
} from "@/lib/studio/callouts";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { capacityFit, type UnitFit } from "@/lib/studio/fit";
import { OVERSIZE_CAP } from "@/lib/studio/select";
import { zoneIdsOf } from "@/lib/studio/zones";
import { isAirCapable } from "@/lib/studio/modules";
import { deleteZone } from "@/lib/studio/builder";
import { allocationsOf, hasAllocations } from "@/lib/studio/allocations";
import { attachOf, riserGapOf, setRiserHeight } from "@/lib/studio/graph";
import {
  branchBoxObject,
  deleteJoint,
  freeRunEnd,
  jointObject,
  jointOnRun,
  nearestOnRuns,
  riserOnRun,
  slideOnRun,
} from "@/lib/studio/joints";
import { pipeRefusal } from "@/lib/studio/pipe-rules";
import { strayFittingIds } from "@/lib/studio/verdict";
import { pairSize, sizeTone, vrfPipeViews, type FittingView } from "@/lib/studio/pipe-sizes";
import { footprintBox, layoutPlanLabels, roomLabelFixed, roomLabelOffset, type PlanLabels } from "@/lib/studio/plan-labels";
import type { SizedSection } from "@/lib/studio/vrf-tree";
import { usePipeUnits } from "./pipe-units";

/** a branch box on the plan: PAC-MK34BC / MK54BC are both 450 × 280 mm (M-P0860 p.44) */
const BOX_W_MM = 450;
const BOX_D_MM = 280;
import { anchorFloating, dodgeSlot, type Size } from "@/lib/studio/anchor";
import {
  moveEndpointTo,
  reconcileAttachedRuns,
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
  type DataPack,
  type IndoorUnit,
  type OpeningSpec,
  type OutdoorUnit,
} from "@/lib/studio/packs/schema";
import { formFactorLabel } from "@/lib/studio/unit-specs";
import {
  regionFromPoints,
  regionFromRect,
  regionOutline,
  withRegion,
  type PlanImages,
  type SheetRegion,
} from "@/lib/studio/plans";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import { SimOverlay } from "./sim-overlay";
import {
  areaUnitsToM2,
  boundsOfPoints,
  dist,
  distToSegment,
  fitBounds,
  clampViewport,
  fitZoom,
  formatArea,
  formatMeters,
  MIN_ZOOM,
  mmPerUnitFromCalibration,
  orthoSnap,
  squareInto,
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
  type Bounds,
} from "@/lib/studio/geometry";
import {
  cloudPath,
  createNote,
  isNote,
  leaderStart,
  moveNote,
  noteBounds,
  noteHit,
  noteInkOf,
  NOTE_INKS,
  DEFAULT_NOTE_INK,
  noteGripAt,
  noteGrips,
  noteLayoutOf,
  noteLeader,
  noteRect,
  noteScaleOf,
  noteText,
  noteWrapOf,
  rectFromDrag,
  scaleForGripY,
  wrapForEdgeX,
  type NoteGrip,
  type NoteObject,
  type NoteRect,
} from "@/lib/studio/notes";
import { type WheelMode } from "@/lib/studio/wheel";
import {
  readCanvasWheel,
  type WheelGestureState,
} from "@/lib/studio/wheel-gesture";

/* StudioCanvas — the SVG scene per ADR-001. Renders the document, emits
   intents via onMutate; it never mutates the document itself. World space is
   floor pixels; one <g> carries pan/zoom; strokes keep constant screen weight
   via vector-effect. */

/** a zone's fill: its system's colour at the strength the orange fill has */
function zoneFill(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "rgba(120, 130, 145, 0.12)";
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.13)`;
}

/** where a zone's corner dots sit */
function topLeftOf(pts: Point[]): Point {
  let x = Infinity;
  let y = Infinity;
  for (const p of pts) {
    if (p.x < x) x = p.x;
    if (p.y < y) y = p.y;
  }
  return { x, y };
}

export type CanvasTool =
  | "select"
  | "room-rect"
  | "room-poly"
  | "calibrate"
  | "measure" // throwaway tape measure — drag to read a distance, nothing is saved
  | "set-north" // place/rotate the true-north arrow
  | "crop" // trim a plan sheet's visible region
  | "split" // keep an area on this floor, give the rest of the page to a new floor
  | "erase"
  | "arrange"
  | "place" // place a unit (armed from the system panel with a model)
  | "claim" // claim mode: a click gives a zone to the system being built, or takes it back
  | "pipe" // refrigerant run — endpoints snap to unit/riser anchors
  | "drain" // condensate drain — straight segments, size picked at draw
  | "cable" // power/data cable — dots smoothed into a curve
  | "riser"
  | "joint" // a refrigerant joint: on a run it cuts it and branches there
  | "branch-box" // a PUMY branch box: the heads' runs end on it
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
/** what a run's end can attach to (graph.ts Attach) */
type AnchorKind = "unit" | "riser" | "joint" | "branch-box";

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
/** the rack's own drag type: the placing unit as JSON, so a drop lands even
    when the arm set on dragstart has not rendered yet (a quick drag) */
export const RACK_DRAG = "application/x-heytiff-rack";

export interface PlacingUnit {
  role: "idu" | "odu";
  model: string;
  widthMm: number;
  depthMm: number;
  /** a builder unit from the tray: the dropped object takes this id, this
      system and this room — never the active system or the room it lands in */
  allocationId?: string;
  systemId?: string;
  roomId?: string | null;
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
/* A callout's type, one step below a note's. Both hold a constant SCREEN size
   on the canvas and the sheet's own size on paper, and the gap between them is
   the hierarchy: a written instruction must not be quieter than machine data.
   11 is the area line's size, which is what the rest of the derived text on a
   plan already uses. */
const CALLOUT_FONT_PX = 11;
/** How close the pointer has to be to a note's grip, in screen px. Generous:
    on a one-line note the two grips sit about a line apart, and the nearest
    one wins, so a wide radius costs nothing and a narrow one costs the grip. */
const GRIP_HIT_PX = 10;
/** a cloud smaller than this (screen px, either side) was a stray click */
const NOTE_MIN_PX = 14;
const HIT_EDGE_PX = 6;
/* a joint or riser dragged further than this off its pipe comes free of it */
const SLIDE_OFF_PX = 28;
/* how near a pipe's free end a riser must land to join it */
const RISER_END_PX = 16;
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
export function unitGlyph(
  cx: number,
  cy: number,
  w: number,
  h: number,
  role: string,
  zoom: number,
  formFactor?: string | null,
  /** a ducted head's faces from the pack (supply and return openings), mm to
      world, which long face supplies (+1 = the front), and `bare` when its
      air side already draws the faces and the arrow */
  duct?: { supply?: OpeningSpec; ret?: OpeningSpec; perMm: number; supplyDir?: 1 | -1; bare?: boolean }
) {
  const left = cx - w / 2;
  const top = cy - h / 2;
  const right = left + w;
  const bottom = top + h;
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
  /* EACH KIND OF HEAD ITS OWN MARK (Isaac, 2026-09-30, from the maker's
     outline drawings; only what is true of every unit of the kind, so the
     mark never claims what a model doesn't have). Drawn in the unit's own
     frame — the discharge face is +y (the bottom edge), and the whole mark
     turns with the unit. */
  const inset = Math.min(w, h) * 0.12;
  const slot = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} className="ds-unit-slot" />
  );
  switch (formFactor) {
    case "wall":
    case "floor-console":
      /* against a wall: the wall behind it, dashed; a wall head's outlet slot
         along its front, a console's grille down its front and slot at the top */
      return (
        <>
          <line x1={left - w * 0.08} y1={top - 3 / zoom} x2={right + w * 0.08} y2={top - 3 / zoom} className="ds-unit-wall" />
          <rect x={left} y={top} width={w} height={h} rx={Math.min(h * 0.25, 6 / zoom)} />
          {formFactor === "wall"
            ? slot(left + inset, bottom - h * 0.25, right - inset, bottom - h * 0.25, "s")
            : [
                slot(left + inset, top + h * 0.28, right - inset, top + h * 0.28, "s"),
                ...Array.from({ length: 7 }, (_, i) => {
                  const x = left + inset + ((w - inset * 2) * (i + 0.5)) / 7;
                  return <line key={`g${i}`} x1={x} y1={top + h * 0.5} x2={x} y2={bottom - h * 0.18} className="ds-unit-detail" />;
                }),
              ]}
        </>
      );
    case "cassette-4way":
    case "cassette-compact":
    case "cassette-2way":
    case "cassette-1way": {
      /* the panel: its grille in the middle, an outlet slot along each
         face that blows — four, two opposite, or the front one */
      const gw = w * 0.4;
      const gh = h * (formFactor === "cassette-1way" ? 0.34 : 0.4);
      const gy = formFactor === "cassette-1way" ? top + h * 0.18 : cy - gh / 2;
      const i = inset;
      const slots =
        formFactor === "cassette-1way"
          ? [slot(left + i, bottom - i, right - i, bottom - i, "b")]
          : formFactor === "cassette-2way"
            ? [slot(left + i, top + i, right - i, top + i, "t"), slot(left + i, bottom - i, right - i, bottom - i, "b")]
            : [
                slot(left + i * 1.6, top + i, right - i * 1.6, top + i, "t"),
                slot(left + i * 1.6, bottom - i, right - i * 1.6, bottom - i, "b"),
                slot(left + i, top + i * 1.6, left + i, bottom - i * 1.6, "l"),
                slot(right - i, top + i * 1.6, right - i, bottom - i * 1.6, "r"),
              ];
      return (
        <>
          <rect x={left} y={top} width={w} height={h} rx={rx} />
          <rect x={cx - gw / 2} y={gy} width={gw} height={gh} className="ds-unit-detail" />
          {slots}
        </>
      );
    }
    case "ducted":
    case "bulkhead":
    case "floor-concealed": {
      /* a flange on the supply side and one on the return (Isaac,
         2026-09-30: "the most simple way"), or the factory spigots where
         the pack says a face has them (the HAA's two on the back), and the
         air across the depth. No piping or wiring side: the pack doesn't
         say, so the mark doesn't claim one. Once the unit's air side is
         drawn (a ducted system's plenums, sockets and flow arrow) the mark
         steps back to the body. */
      const sd = duct?.supplyDir ?? 1;
      const flange = Math.max(h * 0.08, 3 / zoom);
      const face = (dir: 1 | -1, opening: OpeningSpec | undefined, key: string) => {
        const y0 = dir === 1 ? bottom : top - flange;
        if (opening && hasFactorySpigots(opening)) {
          const dias = spigotDiametersMm(opening);
          const n = dias.length || 2;
          const per = duct?.perMm ?? 0;
          const stub = Math.max(flange * 1.6, 5 / zoom);
          return (
            <g key={key}>
              {Array.from({ length: n }, (_, i) => {
                const r = dias[i] && per ? (dias[i] * per) / 2 : Math.min(w / (n * 2.6), h * 0.35);
                const x = left + ((i + 1) / (n + 1)) * w;
                return (
                  <rect key={i} x={x - r} y={dir === 1 ? bottom : top - stub} width={r * 2} height={stub} className="ds-unit-flange" />
                );
              })}
            </g>
          );
        }
        return <rect key={key} x={left + w * 0.06} y={y0} width={w * 0.88} height={flange} className="ds-unit-flange" />;
      };
      /* big enough to read on a near-square body: over half its depth */
      const s = Math.min(h * 0.56, w * 0.4);
      const hw = s * 0.34;
      const ay = cy - (sd * s) / 2;
      return (
        <>
          <rect x={left} y={top} width={w} height={h} rx={rx} />
          {!duct?.bare && (
            <>
              {face(sd, duct?.supply, "supply")}
              {face(sd === 1 ? -1 : 1, duct?.ret, "return")}
              <path
                className="ds-unit-arrow"
                d={`M${cx - hw * 0.5} ${ay}V${ay + sd * s * 0.5}H${cx - hw}L${cx} ${ay + sd * s * 1.05}L${cx + hw} ${ay + sd * s * 0.5}H${cx + hw * 0.5}V${ay}Z`}
              />
            </>
          )}
        </>
      );
    }
    default:
      /* a head of a kind not drawn yet, or unknown: discharge louvres along
         the lower edge */
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
}
/* WHICH WAY A HEAD BLOWS — a solid arrow laid on the body, pointing out of
   the discharge face. One per throw: a wall head, floor unit, under-ceiling,
   ducted box or 1-way cassette throws out its front (+y in its own frame,
   which turns with the unit); a 4-way cassette throws out all four faces.

   It is SCREEN-sized, and it is BIG, because it is only ever shown while the
   unit is in hand — placing, moving or turning — when the one question is
   which way it faces. It starts at the back of the body and runs out past the
   discharge face as far as it needs to; it does not have to fit the unit.
   The head is a filled triangle, a third of the arrow, because a filled shape
   is the only kind that reads at a glance. Four rounds of mock-ups scaled the
   arrow to the footprint and drew smudges; this is what was measured instead.

   Shared by the placed unit and the placing ghost. */
export function throwArrows(
  cx: number,
  cy: number,
  w: number,
  h: number,
  formFactor: string,
  zoom: number
) {
  const four = formFactor === "cassette-4way";
  const dirs: Array<[number, number]> = four ? [[0, 1], [0, -1], [1, 0], [-1, 0]] : [[0, 1]];
  const px = (n: number) => n / zoom; // screen px → world units
  const headLen = px(12);
  const headHalf = px(8);
  const minLen = px(34);
  return dirs.map(([dx, dy]) => {
    const half = dx ? w / 2 : h / 2; // centre to the face it leaves by
    // a single throw starts at the back of the body; a 4-way's four start
    // just off the centre, so they read as four and not a cross
    const start = four ? px(3) : -(half - px(3));
    const end = Math.max(half, start + minLen);
    const x1 = cx + dx * start;
    const y1 = cy + dy * start;
    const x2 = cx + dx * end;
    const y2 = cy + dy * end;
    // the head sits on the tip; the stem stops where the head begins
    const bx = x2 - dx * headLen;
    const by = y2 - dy * headLen;
    const nx = -dy * headHalf; // across the direction of travel
    const ny = dx * headHalf;
    return (
      <g key={`th-${dx}-${dy}`} className="ds-throw">
        <line x1={x1} y1={y1} x2={bx} y2={by} />
        <path d={`M${x2} ${y2} L${bx + nx} ${by + ny} L${bx - nx} ${by - ny} Z`} />
      </g>
    );
  });
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
  /* `free`: a joint or riser dragged off its pipe's line stops sliding along
     it for the rest of the drag (joints.ts slideOnRun) */
  | { kind: "point"; id: string; startWorld: Point; orig: Point; free?: boolean }
  | { kind: "crop"; sheetId: string; start: Point }
  | { kind: "split"; sheetId: string; start: Point }
  | { kind: "north-move"; startWorld: Point; orig: { x: number; y: number } }
  | { kind: "north-rotate"; center: { x: number; y: number } }
  /* `offset` is where on the ring the grab landed, as degrees ahead of the
     unit's own up: the turn follows the pointer from THERE, so grabbing the
     ring at its side does not snap the unit to face the side */
  | { kind: "unit-rotate"; id: string; center: Point; offset: number }
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
  | { kind: "note-leader"; id: string; startWorld: Point; orig: Point }
  /** sliding a unit's callout to where there is room for it. `orig` + the
      travel, never the raw cursor, for the same reason `note-leader` does it:
      you grab the bubble somewhere in the middle, and snapping its anchor to
      the grab point would jump it out from under the pointer on pixel one. */
  | { kind: "callout"; id: string; startWorld: Point; orig: CalloutPlacement }
  /** a selected room's name slid to where it reads best: `orig` + the
      travel, as the callout does, so it never jumps to the grab point */
  | { kind: "room-label"; id: string; startWorld: Point; orig: Point }
  /** pulling the words' outer SIDE: the measure, in characters. The block
      reflows under the pointer and the type stays the size it was. */
  | { kind: "note-measure"; id: string }
  /** pulling the words' outer CORNER: the type size. `from` and `startY` are
      the drag's own origin — scaling off the live block would compound, since
      the grip moves as the type grows. */
  | { kind: "note-size"; id: string; from: number; startY: number; leaderY: number };

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
  sharedRefs,
  onSplitFloor,
  activeSystemId = null,
  placing = null,
  placingKw = null,
  roomFits,
  onPlaced,
  component = null,
  onComponentPlaced,
  iduSpec,
  pack,
  oduSpec,
  onRoomCreated,
  onClaimToggle,
  deleteRoom,
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
  armedInk = DEFAULT_NOTE_INK,
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
  /** images this floor shares with another floor (a split plan): the part of
      the page that belongs to the other floor shows faded, not hidden */
  sharedRefs?: ReadonlySet<string>;
  /** the Split tool's confirm: `keep` stays on this floor, `other` becomes a
      new floor above or below */
  onSplitFloor?: (
    sheetId: string,
    keep: SheetRegion,
    other: SheetRegion,
    place: "above" | "below"
  ) => void;
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
  /** the pack, for what a drawn VRF pipe may join (pipe-rules.ts) */
  pack?: DataPack | null;
  /** the same resolver for outdoor units — the hover card names both sides */
  oduSpec?: (model: string) => OutdoorUnit | null;
  /** a room finished wall-marking — open its configuration modal (Slice 2) */
  onRoomCreated?: (id: string) => void;
  /** claim mode (the zones flow): a click on a zone. Zones wear their
      systems' colours whenever this flow is on, from the claims themselves. */
  onClaimToggle?: (roomId: string) => void;
  /** how a room is deleted when the host knows more than the canvas: in the
      zones flow the systems let the zone and its heads go (builder.ts
      deleteZone, handed the pack). Absent, deleteZone runs without one. */
  deleteRoom?: (d: DesignDocument, roomId: string) => DesignDocument;
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
  /** the ink the NEXT note is drawn in (the Note flyout's armed swatch) */
  armedInk?: string;
  /** systemId → the pairing's line sizes; pipe-run labels autosize from this
      (per-run props override) */
  runSizes?: ReadonlyMap<string, { liquidMm: number; gasMm: number }>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Point | null>(null);
  /* Shift held: a straight run's last leg goes into a unit square (the
     preview has to know before the click, so it is tracked, not read off it) */
  const [shiftDown, setShiftDown] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Shift" && setShiftDown(e.type === "keydown");
    const off = () => setShiftDown(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
    };
  }, []);
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
  /* live crop rectangle while dragging a crop (or a split) over a sheet */
  const [liveCrop, setLiveCrop] = useState<{ sheetId: string; a: Point; b: Point } | null>(null);
  /* a freeform area being drawn: clicked corners (world units), and the tool
     that began it — a draft left behind when the tool changed stays dormant */
  const [draftShape, setDraftShape] = useState<{
    sheetId: string;
    tool: "crop" | "split";
    pts: Point[];
  } | null>(null);
  /* Split asks for two areas on one page: the one this floor keeps, then the
     one that becomes the new floor. Both in the sheet's own coordinates.
     Nothing changes in the design until Above / Below. */
  const [splitPending, setSplitPending] = useState<{
    sheetId: string;
    keep: SheetRegion;
    other: SheetRegion | null;
  } | null>(null);
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
  /** a note mid-drag: the offset it has travelled, its live leader end, or
      the live measure/size a grip is pulling. One state for all four so the
      note is drawn from ONE source while any of them is happening. */
  const [liveNote, setLiveNote] = useState<
    | { id: string; dx: number; dy: number }
    | { id: string; leader: Point }
    | { id: string; wrap: number }
    | { id: string; textScale: number }
    | null
  >(null);
  /* a callout mid-drag — the placement the pointer is currently asking for,
     never written to the document until the gesture ends */
  const [liveCallout, setLiveCallout] = useState<
    { id: string; at: CalloutPlacement } | null
  >(null);
  /* a room's name mid-drag, never written until the gesture ends */
  const [liveRoomLabel, setLiveRoomLabel] = useState<{ id: string; at: Point } | null>(null);
  /* the words as last placed, for the pointer handlers: they are laid out in
     render, after the handlers are made */
  const planLabelsRef = useRef<PlanLabels | null>(null);
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

  /* the plan is one house: every system's units and runs show at once, and
     rooms (zones) belong to the plan, not a system */
  const inScope = useCallback((o: DesignObject) => o.floorId === floor.id, [floor.id]);

  const rooms = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
          o.floorId === floor.id && o.type === "room" && o.geometry.kind === "polygon"
      ),
    [doc.objects, floor.id]
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

  /* a VRF drawn to every head, sized (pipe-sizes.ts): each run wears its
     section's size as colour and label, a click lights the whole section,
     and a joint or box says what goes in and out of it */
  const pipeUnits = usePipeUnits();
  const pipeView = useMemo(() => {
    const byRun = new Map<string, SizedSection>();
    const fittings = new Map<string, FittingView>();
    for (const v of vrfPipeViews(doc, pack ?? null)) {
      v.byRun.forEach((sec, id) => byRun.set(id, sec));
      v.fittings.forEach((f, id) => fittings.set(id, f));
    }
    return { byRun, fittings };
  }, [doc, pack]);
  /* joints that branch nothing and boxes with no pipe on, drawn in the bad
     colour so they are found (verdict.ts strayFittingIds) */
  const strayFits = useMemo(() => {
    const ids = new Set<string>();
    for (const sys of doc.systems) {
      const { joints, boxes, risers } = strayFittingIds(doc, sys);
      for (const id of [...joints, ...boxes, ...risers]) ids.add(id);
    }
    return ids;
  }, [doc]);
  /* the runs lit with the selection: every run of the picked run's section */
  const litRuns = useMemo(() => {
    const sec = selectedId ? pipeView.byRun.get(selectedId) : undefined;
    return new Set(sec ? sec.edges : selectedId ? [selectedId] : []);
  }, [selectedId, pipeView]);

  /* the zones flow: a zone wears the colour of the system that claimed it,
     the first system's when two share it, with a dot per system in its corner */
  const zoneOwners = useMemo(() => {
    const m = new Map<string, { id: string; colour: string }[]>();
    for (const sys of doc.systems) {
      for (const id of zoneIdsOf(sys)) {
        const list = m.get(id) ?? [];
        list.push({ id: sys.id, colour: sys.colour });
        m.set(id, list);
      }
    }
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
  const joints = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
          inScope(o) && o.type === "joint" && o.geometry.kind === "point"
      ),
    [doc.objects, inScope]
  );
  const boxes = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
          inScope(o) && o.type === "branch-box" && o.geometry.kind === "point"
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
  /** a joint or riser sliding along its pipe: the two runs it sits in, as
      they will be (joints.ts slideOnRun) */
  const [liveSlide, setLiveSlide] = useState<Map<string, Point[]> | null>(null);
  const pointById = useMemo(() => {
    const m = new Map<string, { id: string; geometry: { at: Point } }>();
    for (const o of [...units, ...risers, ...joints, ...boxes]) m.set(o.id, o);
    return m;
  }, [units, risers, joints, boxes]);
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
    (r: { id?: string; props: Record<string, unknown>; geometry: { points: Point[] } }): Point[] => {
      const slid = r.id ? liveSlide?.get(r.id) : undefined;
      if (slid) return slid;
      let pts = r.geometry.points;
      const s = attachOf(r.props.startAttach);
      const sAt = s ? liveAnchorAt(s.id) : null;
      if (sAt) pts = moveEndpointTo(pts, "start", sAt);
      const e = attachOf(r.props.endAttach);
      const eAt = e ? liveAnchorAt(e.id) : null;
      if (eAt) pts = moveEndpointTo(pts, "end", eAt);
      return pts;
    },
    [liveAnchorAt, liveSlide]
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
  const pipeStartAttach = useRef<{ kind: AnchorKind; id: string } | null>(null);
  /* a refrigerant pipe that can't exist is refused where it would attach
     (pipe-rules.ts); the reason stands in the hint window for a moment */
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!refusal) return;
    const t = window.setTimeout(() => setRefusal(null), 3500);
    return () => window.clearTimeout(t);
  }, [refusal]);

  /* IS SOMETHING HALF-DRAWN — the one answer both Esc and right-click ask,
     named once because they used to disagree. The calibration's first point
     and a live tape reading count: each is a gesture underway that a cancel
     has to be able to drop, the same as half a rectangle. */
  const draftUp =
    draftPipe.length > 0 ||
    draftPoly.length > 0 ||
    draftRect !== null ||
    wallSelect !== null ||
    noteDraft !== null ||
    notePin !== null ||
    calib.a !== undefined ||
    tape !== null ||
    liveCrop !== null ||
    draftShape !== null ||
    splitPending !== null;
  /* Esc's listener binds once, so the two things it needs at press time reach
     it through refs rather than by re-subscribing the window on every stroke.
     `onToolDone` is an inline arrow at the use site — a new function each
     render — so it is mirrored here for the same reason. */
  const draftUpRef = useRef(draftUp);
  const toolDoneRef = useRef(onToolDone);
  useEffect(() => {
    draftUpRef.current = draftUp;
    toolDoneRef.current = onToolDone;
  });


  /** connection anchors of the active system on this floor (units + risers).
      Pipe endpoints snap to these; the nearest within range lights up BEFORE
      the click (the show-the-snap-target-first rule). */
  const anchors = useMemo(
    () =>
      [...units, ...risers, ...joints, ...boxes]
        .filter((o) => o.systemId === activeSystemId)
        .map((o) => ({ kind: o.type as AnchorKind, id: o.id, at: pointAt(o) })),
    [units, risers, joints, boxes, activeSystemId, pointAt]
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
  /* THE ROTATE RING: a faint ring round the selected unit's footprint, 8px
     clear of its corners at any zoom, with one grip on it at the unit's own
     "up" so the current angle can be read off it. Drag anywhere on the ring
     to turn. It used to be a leg out of the top face with a knob on the end,
     and the leg was sized to the GRID: 71px long at 140% with a 6px dot on
     the end, gone at fit-to-screen — the one thing on a selected unit that
     was not sized to the screen, and it looked like it. */
  /* `zoom` is passed in rather than read off `vp` here: this closure is called
     from render and from the pointer handlers, and closing over the viewport
     object from up here changed the dependency shape the React Compiler
     inferred for three unrelated memoized callbacks (it reported it could
     not preserve their memoization). A number in, nothing captured. */
  const unitRotKnob = (o: UnitObj, zoomNow: number) => {
    const at = pointAt(o);
    const fp = footprint(Number(o.props.widthMm ?? 800), Number(o.props.depthMm ?? 300));
    const rad = (unitRotDeg(o) * Math.PI) / 180;
    const r = Math.hypot(fp.w / 2, fp.h / 2) + 8 / zoomNow;
    return {
      at,
      r,
      // the grip: local "up" on the ring, turned with the unit
      knob: { x: at.x + Math.sin(rad) * r, y: at.y - Math.cos(rad) * r },
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

  /* the topmost sheet under a world point — what Crop and Split start on */
  const sheetAt = (w: Point) => {
    for (let i = floor.plans.length - 1; i >= 0; i--) {
      const s = floor.plans[i];
      const dims = sheetSize(s);
      if (!dims) continue;
      const pos = sheetPos(s);
      if (w.x >= pos.x && w.x <= pos.x + dims.w && w.y >= pos.y && w.y <= pos.y + dims.h) {
        return s;
      }
    }
    return null;
  };

  /* viewport starts from an assumed size and re-fits once on first real
     measure (mount-time content captured in a ref — no setState in effects).
     Plan-sheet corners count as content so plan-backed floors open fitted. */
  /** the system objects on this floor: units, risers, joints and boxes by
      their point, runs by their dots (the Fit button's extra frame) */
  const pipeworkPoints = useCallback((): Point[] => {
    const pts: Point[] = [];
    for (const o of doc.objects) {
      if (o.floorId !== floor.id) continue;
      if (o.geometry.kind === "point" && (o.type === "unit" || o.type === "riser" || o.type === "joint" || o.type === "branch-box"))
        pts.push(o.geometry.at);
      else if (o.geometry.kind === "polyline" && RUN_TYPES.has(o.type)) pts.push(...o.geometry.points);
    }
    return pts;
  }, [doc.objects, floor.id]);
  const pipeworkPointsRef = useRef(pipeworkPoints);
  useEffect(() => {
    pipeworkPointsRef.current = pipeworkPoints;
  }, [pipeworkPoints]);
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
    /* A CALLOUT'S LEADER END COUNTS, for exactly the reason a note's does: it
       is placed AWAY from the unit on purpose, so a fit that framed only the
       plan would leave the label somebody moved somewhere legible off screen.
       The bubble itself cannot go in — like the note's words it holds a
       constant SCREEN size and so has no world extent until a zoom exists, and
       the fit's own 60px margin is what carries it. */
    for (const o of doc.objects) {
      if (o.floorId !== floor.id || o.type !== "unit" || o.geometry.kind !== "point") continue;
      const c = calloutOf(o);
      if (c) pts.push({ x: o.geometry.at.x + c.x, y: o.geometry.at.y + c.y });
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
  }, [rooms, roomPoints, notes, doc.objects, floor.id, floor.plans, sheetSize, sheetPos]);

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
  /* what this wheel gesture has spent so far — the only wheel state that
     survives an event, deliberately outside the pure reader */
  const gestureRef = useRef<WheelGestureState | null>(null);
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

  /* ── where the view is allowed to go ──
     Zoom has had a floor since the beginning: you cannot zoom out past roughly
     fit, so the drawing never shrinks into a speck. Pan had no matching rule,
     so the plan could be dragged off into empty grid indefinitely and Fit was
     the only way back to it.

     The bounds are deliberately a SUPERSET of what `fit` frames. Two reasons,
     and both are failures if they are got wrong:

       · `contentPoints` counts rooms, notes and plan sheets — not units. An
         outdoor unit dropped on bare grid outside every room is invisible to
         it, and a clamp built on it alone could hold the view somewhere that
         unit is unreachable. Every object on the floor goes in.
       · It is scoped to the FLOOR, never to the active system, for the same
         reason a note is: switching systems must not move the walls of the
         world. `units` above is system-scoped and is the wrong list here.

     Being a superset is also what stops the clamp fighting Fit — a viewport
     that frames the content is inside a box drawn round more of it. */
  const panBounds = useMemo((): Bounds => {
    const pts = contentPoints();
    for (const o of doc.objects) {
      if (o.floorId !== floor.id) continue;
      if (o.geometry.kind === "point") pts.push(o.geometry.at);
      else pts.push(...o.geometry.points);
    }
    // a blank floor has no bounds at all; a zero-size box at the origin makes
    // clampViewport degenerate into "the origin stays on screen"
    return boundsOfPoints(pts) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }, [contentPoints, doc.objects, floor.id]);
  const panBoundsRef = useRef(panBounds);
  useEffect(() => {
    panBoundsRef.current = panBounds;
  }, [panBounds]);

  /** ONE DOOR onto the viewport. Every pan, zoom and fit is committed through
      here, so no gesture — present or future — can leave the drawing behind.
      `box` is for the callers that already know a size the ref has not caught
      up to yet (the resize observer measures and re-frames in one go). */
  const commitVp = useCallback(
    (
      next: Viewport | ((v: Viewport) => Viewport),
      box?: { w: number; h: number }
    ) => {
      setVp((v) => {
        const n = typeof next === "function" ? next(v) : next;
        const s = box ?? sizeRef.current;
        return clampViewport(n, panBoundsRef.current, s.w, s.h);
      });
    },
    []
  );
  /* the zoom buttons frame the view by hand; Fit hands the framing back to
     the content, so it deliberately does NOT set the flag */
  const zoomBy = useCallback(
    (k: number) => {
      userFramed.current = true;
      commitVp((v) =>
        zoomAt(v, { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 }, k, minZoomRef.current)
      );
    },
    [commitVp]
  );
  const zoomInApi = useCallback(() => zoomBy(1.3), [zoomBy]);
  const zoomOutApi = useCallback(() => zoomBy(1 / 1.3), [zoomBy]);
  const fitApi = useCallback(() => {
    /* THE FIT BUTTON ALSO FRAMES THE PIPEWORK AND ITS UNITS: an outdoor is
       often placed outside every zone (a yard, a roof), and on a design
       without a plan sheet a Fit that framed only the zones left it, its runs
       and its branch box off screen (seen 2026-09-29). Only here: the opening
       frame and the pan limits keep reading the drawing itself. */
    const pts = [...contentPointsRef.current(), ...pipeworkPointsRef.current()];
    if (boundsOfPoints(pts))
      commitVp(
        defaultViewport(
          pts,
          sizeRef.current.w,
          sizeRef.current.h,
          fitExtrasRef.current.grid,
          fitExtrasRef.current.notes
        )
      );
    userFramed.current = false;
  }, [commitVp]);
  useEffect(() => {
    onZoomApi?.({ zoomIn: zoomInApi, zoomOut: zoomOutApi, fit: fitApi });
  }, [onZoomApi, zoomInApi, zoomOutApi, fitApi]);
  useEffect(() => {
    onZoomChange?.(Math.round(vp.zoom * 100));
  }, [vp.zoom, onZoomChange]);

  /** nearest connection anchor within snap range of a world point */
  const nearestAnchor = useCallback(
    (w: Point) => {
      let best: { kind: AnchorKind; id: string; at: Point } | null = null;
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

  /** where a click lands on one of the active system's refrigerant runs on
      this floor, within the edge tolerance: the joint's spot */
  const runLanding = useCallback(
    (w: Point) =>
      nearestOnRuns(
        runs.filter((r) => r.systemId === activeSystemId),
        w,
        HIT_EDGE_PX / vp.zoom
      ),
    [runs, activeSystemId, vp.zoom]
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
      commitVp(
        defaultViewport(
          points,
          r.width,
          r.height,
          mountContent.current.grid,
          mountContent.current.notes
        ),
        { w: r.width, h: r.height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
    // commitVp is stable (useCallback with no deps); naming it keeps the
    // exhaustive-deps rule quiet without letting the observer re-bind
  }, [commitVp]);

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
      commitVp(
        defaultViewport(
          pts,
          sizeRef.current.w,
          sizeRef.current.h,
          fitExtrasRef.current.grid,
          fitExtrasRef.current.notes
        )
      );
  }, [sheetDims, commitVp]);

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
      /* A trackpad flick is not one delta — sixty-odd events of ~5% each,
         still arriving through the momentum tail after the fingers have gone.
         With the wheel set to zoom that asks for a factor in the hundreds and
         buries the plan at MAX_ZOOM every time. The budget bounds ONE gesture
         (see wheel-gesture.ts); the event's own timeStamp is the clock, so a
         flick is replayable in a test with no device and no real clock. */
      const read = readCanvasWheel(e, wheelModeRef.current, e.timeStamp, gestureRef.current);
      gestureRef.current = read.state;
      const g = read.gesture;
      if (g.kind === "spent") return;
      if (g.kind === "pan") {
        commitVp((v) => ({ ...v, x: v.x + g.dx / v.zoom, y: v.y + g.dy / v.zoom }));
        return;
      }
      const r = svg.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      commitVp((v) => zoomAt(v, screen, g.factor, minZoomRef.current));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    /* commitVp is stable, so naming it cannot cost the rebind this listener
       must not have — the mode and the min-zoom still arrive through refs */
  }, [commitVp]);

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
        // a crop or split drag underway is dropped, never committed on release
        setLiveCrop(null);
        setDraftShape(null);
        setSplitPending(null);
        setDrag((d) => (d && (d.kind === "crop" || d.kind === "split") ? null : d));
        /* AND THEN IT LETS GO OF THE TOOL. Esc used to clear the draft and
           stop — so pressing it with nothing half-drawn did nothing at all,
           while the hint promising "Esc to cancel" sat on screen and the tool
           stayed armed (Isaac, 2026-08-26). Right-click has always done both;
           this is the same cancel on the key the hint actually names.

           Two stages, because "cancel" means different things a second apart:
           mid-gesture it is the shape you are drawing, and the tool stays up
           so the next attempt costs nothing. With nothing underway there is
           only the tool left to cancel, so that is what goes. */
        if (!draftUpRef.current) toolDoneRef.current();
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
            return deleteRoom ? deleteRoom(d, selectedId) : deleteZone(d, null, selectedId);
          }
          // a joint that cut a run puts the run back together (joints.ts)
          /* a joint or riser that cut a run puts it back together as it goes
             (Isaac, 2026-09-30: deleting riser A left the trunk in two) */
          const kind = d.objects.find((o) => o.id === selectedId)?.type;
          if (kind === "joint" || kind === "riser") return deleteJoint(d, selectedId);
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
  }, [selectedId, onMutate, onSelect, units, ahuRow, setDraftPipe, deleteRoom]);

  /* ── document intents ── */
  /* A closed boundary lands the room on the plan LOOSE — the user tweaks its
     size, then Save pins it and hands over to wall-marking (which used to run
     straight off the draw). Nothing is external yet; the walls are marked on
     the saved shape. */
  const beginRoomAdjust = useCallback(
    (points: Point[], shape: "rect" | "poly") => {
      const id = newId("obj");
      onMutate((d) => {
        // zones belong to the plan: no system, and numbered across the whole
        // design
        const n = d.objects.filter((o) => o.type === "room").length + 1;
        const room: DesignObject = {
          id,
          type: "room",
          systemId: null,
          floorId: floor.id,
          geometry: { kind: "polygon", points },
          plane: "room",
          props: {
            name: `Zone ${n}`,
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
    [onMutate, floor.id, onSelect, onToolDone]
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
    (w: Point): { id: string; kind: "unit" | "riser" | "joint" | "branch-box" | "pipe-run" | "plenum" } | null => {
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
      for (let i = joints.length - 1; i >= 0; i--) {
        if (dist(pointAt(joints[i]), w) <= 8 / vp.zoom)
          return { id: joints[i].id, kind: "joint" };
      }
      const bfp = footprint(BOX_W_MM, BOX_D_MM);
      for (let i = boxes.length - 1; i >= 0; i--) {
        const at = pointAt(boxes[i]);
        if (Math.abs(w.x - at.x) <= bfp.w / 2 && Math.abs(w.y - at.y) <= bfp.h / 2)
          return { id: boxes[i].id, kind: "branch-box" };
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
    if ("wrap" in liveNote)
      return { ...o, props: { ...o.props, wrap: liveNote.wrap } };
    if ("textScale" in liveNote)
      return { ...o, props: { ...o.props, textScale: liveNote.textScale } };
    return moveNote(o, liveNote.dx, liveNote.dy) as NoteObject;
  };

  /** the grip the pointer is on, if the SELECTED note has one there. Only the
      selected note carries grips, so this is one note's question, and it is
      asked before the note hit-test — a grip sits on the block's edge, which
      is inside the words' own (generous) hit box. */
  const hitNoteGrip = (w: Point, tolPx = GRIP_HIT_PX): { id: string; grip: NoteGrip } | null => {
    if (!selectedId) return null;
    const sel = notes.find((x) => x.id === selectedId);
    if (!sel) return null;
    const grip = noteGripAt(noteAt(sel), w, tolPx / vp.zoom, noteFontW);
    return grip ? { id: sel.id, grip } : null;
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
    const note = createNote({ floorId: floor.id, rect, leader, ink: armedInk });
    onMutate((d) => ({ ...d, objects: [...d.objects, note] }));
    onSelect(note.id);
    // straight into the words: a cloud with nothing to say is not a note
    setNoteEdit({ id: note.id, text: "" });
    onToolDone();
  };

  const setNoteInk = (id: string, ink: string) => {
    onMutate((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        o.id === id ? { ...o, props: { ...o.props, ink } } : o
      ),
    }));
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
      for (const pt of [...risers, ...joints, ...boxes].reverse()) {
        const reach = pt.type === "branch-box" ? footprint(BOX_W_MM, BOX_D_MM).w / 2 : (pt.type === "joint" ? 8 : 12) / vp.zoom;
        if (dist(pointAt(pt), w) <= reach + tol) {
          const id = pt.id;
          onMutate((d) =>
            pt.type === "joint"
              ? deleteJoint(d, id)
              : {
                  ...d,
                  objects: stripAttachesTo(
                    d.objects.filter((o) => o.id !== id),
                    new Set([id])
                  ),
                }
          );
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
    (at: Point, armed: PlacingUnit | null = placing) => {
      /* a builder unit from the tray: it keeps its own id, system and room —
         the builder decided the room, so where it lands never changes it */
      if (armed?.allocationId && armed.systemId) {
        const p = armed;
        onMutate((d) => {
          if (d.objects.some((o) => o.id === p.allocationId)) {
            return {
              ...d,
              objects: d.objects.map((o) =>
                o.id === p.allocationId
                  ? { ...o, floorId: floor.id, geometry: { kind: "point" as const, at } }
                  : o
              ),
            };
          }
          return {
            ...d,
            objects: [
              ...d.objects,
              {
                id: p.allocationId!,
                type: "unit",
                systemId: p.systemId!,
                floorId: floor.id,
                geometry: { kind: "point", at },
                plane: p.role === "odu" ? "external-ground" : "room",
                props: {
                  role: p.role,
                  model: p.model,
                  widthMm: p.widthMm,
                  depthMm: p.depthMm,
                  ...(p.roomId ? { roomId: p.roomId } : {}),
                },
              } satisfies DesignObject,
            ],
          };
        });
        onPlaced?.();
        return;
      }
      if (!placing || !activeSystemId) return;
      onMutate((d) => {
        /* an IDU dropped inside a room is ATTRIBUTED to it (units → spaces).
           A split IDU dropped OUTSIDE every room still serves the lens room —
           the plan's own "Bulkhead AC in the hallway void" case; containment
           wins whenever there is containment. The drop never adopts a zone
           into the system: its zones are its claim's to say. */
        const room =
          placing.role === "idu"
            ? (roomAtPoint(d.objects, floor.id, at) ?? lensRoom(d, activeSystemId))
            : null;
        return {
          ...d,
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
    (w: Point) => {
      if (!activeSystemId) return;
      /* dropped on one of the system's pipes: at a free end it takes that
         pipe up; mid-pipe it is a T with the riser round it (riserOnRun) */
      const onRun = runLanding(w);
      const at = onRun?.at ?? w;
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
        const riser = {
          id: newId("obj"),
          type: "riser",
          systemId: activeSystemId,
          floorId: floor.id,
          geometry: { kind: "point", at },
          plane: "room",
          props: { group },
        } satisfies DesignObject;
        return (
          (onRun && riserOnRun(d, onRun.runId, onRun.seg, riser, RISER_END_PX / vp.zoom)) || {
            ...d,
            objects: [...d.objects, riser],
          }
        );
      });
    },
    [activeSystemId, onMutate, floor.id, runLanding, vp.zoom]
  );

  const commitPipe = useCallback(
    (
      points: Point[],
      endAttach: { kind: AnchorKind; id: string } | null,
      /* the end landed on another refrigerant run: a joint goes there first,
         cutting it (joints.ts), and the new run ends on the joint */
      landOn?: { runId: string; seg: number; at: Point }
    ) => {
      if (!activeSystemId || points.length < 2) return;
      const startAttach = pipeStartAttach.current;
      const landId = landOn ? newId("obj") : null;
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
      onMutate((d0) => {
        const landed = landOn && landId ? jointOnRun(d0, landOn.runId, landOn.seg, landOn.at, landId) : null;
        const d = landed?.doc ?? d0;
        const end = landed ? { kind: "joint" as const, id: landed.jointId } : endAttach;
        return {
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
                ...(end ? { endAttach: end } : {}),
              },
            } satisfies DesignObject,
          ],
        };
      });
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

  /* ── areas drawn on a plan sheet (Crop and Split) ──
     One gesture draws either shape: drag a rectangle, or click each corner of
     a freeform outline and close it on the first point, a double-click or
     Enter. Crop trims the sheet to the area. Split needs two: the one this
     floor keeps, then the one that becomes the new floor. */
  const finishRegion = (kind: "crop" | "split", sheetId: string, region: SheetRegion) => {
    if (kind === "crop") {
      onMutate((d) => ({
        ...d,
        floors: d.floors.map((f) =>
          f.id === floor.id
            ? { ...f, plans: f.plans.map((s) => (s.id === sheetId ? withRegion(s, region) : s)) }
            : f
        ),
      }));
      onToolDone();
    } else if (splitPending && splitPending.sheetId === sheetId && !splitPending.other) {
      // the second area: the panel asks where the new floor goes
      setSplitPending({ ...splitPending, other: region });
      onToolDone();
    } else {
      // the first area: the tool stays armed for the second
      setSplitPending({ sheetId, keep: region, other: null });
    }
  };
  const finishShape = (pts: Point[] | null = null) => {
    if (!draftShape || draftShape.tool !== tool) return;
    const sheet = floor.plans.find((s) => s.id === draftShape.sheetId);
    const dims = sheet ? sheetSize(sheet) : null;
    const corners = pts ?? draftShape.pts;
    setDraftShape(null);
    if (!sheet || !dims) return;
    const pos = sheetPos(sheet);
    const region = regionFromPoints(
      corners.map((c) => ({ x: c.x - pos.x, y: c.y - pos.y })),
      dims
    );
    if (region) finishRegion(draftShape.tool, sheet.id, region);
  };
  const addShapePoint = (w: Point) => {
    if (!draftShape) return;
    const first = draftShape.pts[0];
    if (
      draftShape.pts.length >= 3 &&
      dist(worldToScreen(first, vp), worldToScreen(w, vp)) <= CLOSE_SNAP_PX
    ) {
      finishShape();
      return;
    }
    setDraftShape({ ...draftShape, pts: [...draftShape.pts, w] });
  };
  /* Enter closes a freeform area — the ending that can't misfire. Same ref
     pattern as Esc: the listener binds once and reads the latest closure. */
  const finishShapeRef = useRef(finishShape);
  useEffect(() => {
    finishShapeRef.current = finishShape;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "Enter") finishShapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        /* a grip on the selected note's words beats the words themselves —
           it lives on their edge, which is inside their own hit box */
        const gh = hitNoteGrip(w);
        if (gh) {
          const held = noteAt(notes.find((x) => x.id === gh.id)!);
          setDrag(
            gh.grip === "measure"
              ? { kind: "note-measure", id: gh.id }
              : {
                  kind: "note-size",
                  id: gh.id,
                  from: noteScaleOf(held),
                  startY: noteGrips(held, noteFontW).size.y,
                  leaderY: noteLeader(held).y,
                }
          );
          break;
        }
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
            /* anywhere on the ring turns it: a band 8px either side of the
               ring's line, in screen pixels, so it is as easy to catch zoomed
               out as in; the grip is on the ring, so it needs no case of its own */
            const rk = unitRotKnob(su, vp.zoom);
            const cs = worldToScreen(rk.at, vp);
            const ps = worldToScreen(w, vp);
            if (Math.abs(dist(ps, cs) - rk.r * vp.zoom) <= 8) {
              const grabDeg = ((Math.atan2(ps.x - cs.x, -(ps.y - cs.y)) * 180) / Math.PI + 360) % 360;
              setDrag({
                kind: "unit-rotate",
                id: su.id,
                center: pointAt(su),
                offset: grabDeg - unitRotDeg(su),
              });
              break;
            }
          }
        }
        /* A CALLOUT BEATS EVERYTHING UNDER IT, including the unit it names.
           It is drawn on top and it is text, so grabbing what you can see is
           the only rule that reads honestly — and the unit is still reachable
           by its own footprint, which the bubble never covers by default. It
           loses to the rotate knob above, which belongs to the selected unit
           and sits outside the footprint where a bubble might be dragged. */
        /* A SELECTED ROOM'S NAME can be picked up and moved (Isaac,
           2026-09-30: a kitchen island on the uploaded drawing under it).
           Only once the room is selected, so a drag across an unselected
           room's name still pans the plan — the room itself is pinned the
           same way. Its reset mark, shown once it has been moved, beats the
           words it sits beside. */
        const selRoom = rooms.find((r) => r.id === selectedId);
        const selSpot = selRoom ? planLabelsRef.current?.rooms.get(selRoom.id) : undefined;
        if (selRoom && selSpot) {
          if (
            roomLabelFixed(selRoom.props, roomPoints(selRoom)) &&
            dist(worldToScreen(labelResetAt(selSpot.box), vp), worldToScreen(w, vp)) <= 11
          ) {
            onMutate((d) => ({
              ...d,
              objects: d.objects.map((o) => {
                if (o.id !== selRoom.id) return o;
                const { labelAt: _gone, ...props } = o.props;
                void _gone;
                return { ...o, props };
              }),
            }));
            break;
          }
          const b = selSpot.box;
          if (w.x >= b.x0 && w.x <= b.x1 && w.y >= b.y0 && w.y <= b.y1) {
            setDrag({ kind: "room-label", id: selRoom.id, startWorld: w, orig: { x: selSpot.x, y: selSpot.y } });
            break;
          }
        }
        /* the remove mark beats the bubble it sits on, the way a note's grips
           beat the words they sit inside */
        const cx = callouts.find(
          (c) =>
            c.placed &&
            c.id === selectedId &&
            dist(worldToScreen(calloutCloseAt(c.lay), vp), worldToScreen(w, vp)) <= 11
        );
        if (cx) {
          onMutate((d) => ({
            ...d,
            objects: d.objects.map((o) => (o.id === cx.id ? withoutCallout(o) : o)),
          }));
          break;
        }
        const co = hitCalloutAt(w);
        if (co) {
          onSelect(co.id);
          const u = units.find((x) => x.id === co.id)!;
          const fp = footprint(
            Number(u.props.widthMm ?? 800),
            Number(u.props.depthMm ?? 300)
          );
          setDrag({
            kind: "callout",
            id: co.id,
            startWorld: w,
            orig: calloutOf(u) ?? defaultCalloutOffset(fp),
          });
          break;
        }
        const sys = hitSystemObject(w);
        if (sys) {
          onSelect(sys.id);
          // plenums are anchored (their position derives from the AHU) and
          // runs are polylines — only units/risers/joints start a point drag
          if (sys.kind === "unit" || sys.kind === "riser" || sys.kind === "joint" || sys.kind === "branch-box") {
            const o = [...units, ...risers, ...joints, ...boxes].find((x) => x.id === sys.id)!;
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
             the room being adjusted moves. */
          if (adjust?.id === hit) {
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
      case "claim": {
        tap(() => {
          const hit = hitRoom(w);
          if (hit) onClaimToggle?.(hit);
        });
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
          /* a refrigerant run's end on another run of its system branches
             there: a joint goes on it (anchors win when both are in reach) */
          const onRun = !anchor && tool === "pipe" ? runLanding(w) : null;
          // free first vertex; later vertices ortho-snap to the previous point
          // so runs stay horizontal/vertical (anchors always win). The curved
          // draws — soft pipe, cable — place their dots free: the smoothing
          // is the point.
          const curved = tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft");
          const prev = draftPipe[draftPipe.length - 1];
          const p = anchor ? anchor.at : onRun ? onRun.at : prev && !curved ? orthoSnap(prev, w) : w;
          /* a joint about to go on a run stands in as that end until it exists */
          const here = anchor ?? (onRun ? { kind: "joint" as const, id: "" } : null);
          const why =
            tool === "pipe" && here && activeSystemId
              ? pipeRefusal(
                  doc,
                  activeSystemId,
                  draftPipe.length === 0 ? here : pipeStartAttach.current,
                  draftPipe.length === 0 ? null : here,
                  pack,
                  anchor ? undefined : onRun?.runId
                )
              : null;
          if (why) {
            setRefusal(why);
            return;
          }
          if (draftPipe.length === 0) {
            if (onRun) {
              const jointId = newId("obj");
              onMutate((d) => jointOnRun(d, onRun.runId, onRun.seg, onRun.at, jointId)?.doc ?? d);
              pipeStartAttach.current = { kind: "joint", id: jointId };
            } else {
              pipeStartAttach.current = anchor
                ? { kind: anchor.kind, id: anchor.id }
                : null;
            }
            setDraftPipe([p]);
          } else if (anchor || onRun) {
            // landing on an anchor completes the run — the magnetic connection;
            // with Shift a straight run turns square into it
            const pts = [...(e.shiftKey && !curved ? squareInto(draftPipe, p) : draftPipe), p];
            if (anchor) commitPipe(pts, { kind: anchor.kind, id: anchor.id });
            else commitPipe(pts, null, onRun!);
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
      case "joint": {
        tap(() => {
          if (!activeSystemId) return;
          const onRun = runLanding(w);
          if (onRun) onMutate((d) => jointOnRun(d, onRun.runId, onRun.seg, onRun.at)?.doc ?? d);
          else onMutate((d) => ({ ...d, objects: [...d.objects, jointObject(activeSystemId, floor.id, w)] }));
        });
        break;
      }
      case "branch-box": {
        tap(() => {
          if (!activeSystemId) return;
          onMutate((d) => ({ ...d, objects: [...d.objects, branchBoxObject(activeSystemId, floor.id, w)] }));
        });
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
      case "crop":
      case "split": {
        if (draftShape && draftShape.tool === tool) {
          // corners of a freeform area: a click adds one, a drag still pans
          tap(() => addShapePoint(w));
          break;
        }
        // otherwise a drag starts a rectangle over the topmost sheet under the
        // cursor — and a click without a drag starts a freeform outline
        const hit = sheetAt(w);
        const secondArea = tool === "split" && splitPending !== null && splitPending.other === null;
        if (hit && (!secondArea || hit.id === splitPending?.sheetId)) {
          if (!secondArea) setSplitPending(null);
          setDrag({ kind: tool, sheetId: hit.id, start: w });
          setLiveCrop({ sheetId: hit.id, a: w, b: w });
          return;
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
        commitVp({ ...vp, x: drag.origVp.x - dx, y: drag.origVp.y - dy });
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
        commitVp({
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
      case "room-label":
        setLiveRoomLabel({
          id: drag.id,
          at: { x: drag.orig.x + (w.x - drag.startWorld.x), y: drag.orig.y + (w.y - drag.startWorld.y) },
        });
        break;
      case "callout":
        setLiveCallout({
          id: drag.id,
          at: {
            x: drag.orig.x + (w.x - drag.startWorld.x),
            y: drag.orig.y + (w.y - drag.startWorld.y),
          },
        });
        break;
      /* both grips read off the note AS STORED, never off the live one: the
         block reflows as it is pulled, so measuring against what the last
         pointer event produced would chase its own tail */
      case "note-measure": {
        const stored = notes.find((x) => x.id === drag.id);
        if (stored) {
          setLiveNote({
            id: drag.id,
            wrap: wrapForEdgeX(noteLayoutOf(stored, noteFontW), w.x),
          });
        }
        break;
      }
      case "note-size":
        setLiveNote({
          id: drag.id,
          textScale: scaleForGripY({
            from: drag.from,
            startY: drag.startY,
            leaderY: drag.leaderY,
            y: w.y,
          }),
        });
        break;
      case "sheet":
        setLiveSheet({
          id: drag.id,
          x: drag.orig.x + (w.x - drag.startWorld.x),
          y: drag.orig.y + (w.y - drag.startWorld.y),
        });
        break;
      case "point": {
        const want = {
          x: drag.orig.x + (w.x - drag.startWorld.x),
          y: drag.orig.y + (w.y - drag.startWorld.y),
        };
        /* a joint or riser in a pipe slides along it; pulled well off the
           line it comes free, and stays free for the rest of the drag */
        const slid = drag.free ? null : slideOnRun(doc.objects, drag.id, want, SLIDE_OFF_PX / vp.zoom);
        if (slid) {
          const pts = new Map<string, Point[]>();
          for (const o of slid.objects)
            if (o.type === "pipe-run" && o.geometry.kind === "polyline") {
              const was = doc.objects.find((x) => x.id === o.id);
              if (was !== o) pts.set(o.id, o.geometry.points);
            }
          setLiveSlide(pts);
          setLivePoint({ id: drag.id, at: slid.at });
        } else if (liveSlide && doc.objects.find((o) => o.id === drag.id)?.type === "riser") {
          /* a riser never drags its pipes (Isaac, 2026-09-30: crossing the
             refrigerant line "started dragging the pipes with me"): off every
             pipe it waits where it last sat on one */
        } else {
          if (!drag.free && liveSlide) setDrag({ ...drag, free: true });
          setLiveSlide(null);
          setLivePoint({ id: drag.id, at: want });
        }
        break;
      }
      case "crop":
      case "split":
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
        const pointerDeg = ((Math.atan2(s.x - c.x, -(s.y - c.y)) * 180) / Math.PI + 360) % 360;
        // the unit turns by as much as the pointer has, from wherever it grabbed
        let deg = (((pointerDeg - drag.offset) % 360) + 360) % 360;
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
    /* the grips write one prop each, and only when the pull actually changed
       it — a grip pressed and released is a selection, not an edit, and it
       must not land an undo step that does nothing */
    if ((drag.kind === "note-measure" || drag.kind === "note-size") && liveNote) {
      const live = liveNote;
      const patch =
        "wrap" in live
          ? { key: "wrap" as const, value: live.wrap }
          : "textScale" in live
            ? { key: "textScale" as const, value: live.textScale }
            : null;
      const stored = patch ? notes.find((x) => x.id === live.id) : null;
      /* the comparison happens HERE, not inside the map: onMutate lands an
         undo step whether or not the objects come back changed, and a grip
         pressed and let go must not put a do-nothing entry in the history */
      const now = stored
        ? patch!.key === "wrap"
          ? noteWrapOf(stored)
          : noteScaleOf(stored)
        : null;
      if (patch && stored && now !== patch.value) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.map((o) =>
            o.id === live.id && isNote(o)
              ? { ...o, props: { ...o.props, [patch.key]: patch.value } }
              : o
          ),
        }));
      }
      setLiveNote(null);
    }
    if ((drag.kind === "note-move" || drag.kind === "note-leader") && liveNote) {
      const live = liveNote;
      /* `live` carries four shapes now (move, leader, measure, size), so each
         branch names the ONE key it reads — an `else` on "leader" would hand
         a grip's payload to the mover */
      const moved =
        drag.kind === "note-leader"
          ? "leader" in live &&
            (live.leader.x !== drag.orig.x || live.leader.y !== drag.orig.y)
          : "dx" in live && (Math.abs(live.dx) > 1e-6 || Math.abs(live.dy) > 1e-6);
      if (moved) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.map((o) => {
            if (o.id !== live.id || !isNote(o)) return o;
            if ("leader" in live)
              return { ...o, props: { ...o.props, leader: { x: live.leader.x, y: live.leader.y } } };
            return "dx" in live ? moveNote(o, live.dx, live.dy) : o;
          }),
        }));
      }
      setLiveNote(null);
    }
    /* THE DRAG IS THE COMMIT. A callout appears on selection as a PREVIEW —
       drawn, but nowhere in the document — and only a deliberate placement
       writes it. That is what keeps this out of the orphan class the note tool
       shipped with (#541): there, the object reached the document at the
       leader click before its words existed, so anything that killed the
       editor another way left a cloud pointing at nothing and it took a repair
       pass on load to sweep them. Nothing here can be left behind, because
       nothing is written until somebody moves it.

       The did-anything-change test runs BEFORE onMutate, never inside the map:
       onMutate lands an undo step whether or not the objects come back
       different, so a bubble pressed and let go would otherwise cost a step. */
    /* a room's name let go: written only if it really moved (the same slop
       as a callout, so a press that rolls a few px costs no undo step) */
    if (drag.kind === "room-label") {
      const live = liveRoomLabel;
      if (
        live &&
        (Math.abs(live.at.x - drag.orig.x) * vp.zoom > TAP_SLOP_PX ||
          Math.abs(live.at.y - drag.orig.y) * vp.zoom > TAP_SLOP_PX)
      ) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.map((o) =>
            o.id === live.id && o.geometry.kind === "polygon"
              ? { ...o, props: { ...o.props, labelAt: roomLabelOffset(live.at, o.geometry.points) } }
              : o
          ),
        }));
      }
      setLiveRoomLabel(null);
    }
    if (drag.kind === "callout" && liveCallout) {
      const live = liveCallout;
      /* A SLOP, IN SCREEN PX, and the same one every click-to-place tool uses.
         A comparison against 0 is not enough here: the FIRST placement has no
         stored value to differ from, so a press that rolled two pixels on a
         trackpad would write a callout onto the document and cost an undo step
         — which is exactly the bug TAP_SLOP_PX exists to stop, and why it was
         raised from 4 to 10. */
      const moved =
        Math.abs(live.at.x - drag.orig.x) * vp.zoom > TAP_SLOP_PX ||
        Math.abs(live.at.y - drag.orig.y) * vp.zoom > TAP_SLOP_PX;
      if (moved) {
        onMutate((d) => ({
          ...d,
          objects: d.objects.map((o) => (o.id === live.id ? withCallout(o, live.at) : o)),
        }));
      }
      setLiveCallout(null);
    }
    if (drag.kind === "point" && livePoint && liveSlide) {
      /* slid along its pipe: the same slide on the document, then its
         branches follow their end */
      const { id, at } = livePoint;
      onMutate((d) => {
        const slid = slideOnRun(d.objects, id, at, 1e-3);
        return slid ? { ...d, objects: reconcileAttachedRuns(slid.objects, new Set([id])) } : d;
      });
      setLiveSlide(null);
      setLivePoint(null);
    } else if (drag.kind === "point" && livePoint) {
      const { id, at } = livePoint;
      if (at.x !== drag.orig.x || at.y !== drag.orig.y) {
        onMutate((d) => {
          const moved = d.objects.find((o) => o.id === id);
          /* a unit the builder allocated keeps the room it was built for —
             moving it on the plan only moves it (spec: placing never changes
             the room) */
          const movedSys = moved?.systemId ? d.systems.find((s) => s.id === moved.systemId) : undefined;
          const allocated =
            movedSys != null && hasAllocations(movedSys) && allocationsOf(movedSys).some((a) => a.id === id);
          /* moving an IDU re-derives its room attribution (unless the user
             pinned it manually via roomLock). Outside every room, a split
             falls back to its lens room, so nudging a bulkhead along the
             hallway never silently un-serves the room it was placed for. A
             system's zones are its claim's to say, so a move never adopts one. */
          const restamp =
            !allocated &&
            moved?.type === "unit" &&
            moved.props.role === "idu" &&
            !moved.props.roomLock;
          const room = restamp
            ? (roomAtPoint(d.objects, moved!.floorId, at) ??
              lensRoom(d, moved!.systemId ?? null))
            : null;
          return {
            ...d,
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
    if ((drag.kind === "crop" || drag.kind === "split") && liveCrop) {
      const { sheetId, a, b } = liveCrop;
      const sheet = floor.plans.find((s) => s.id === sheetId);
      setLiveCrop(null);
      if (sheet) {
        const dims = sheetSize(sheet);
        const pos = sheetPos(sheet);
        const dragged =
          Math.abs(b.x - a.x) * vp.zoom > TAP_SLOP_PX ||
          Math.abs(b.y - a.y) * vp.zoom > TAP_SLOP_PX;
        if (!dragged) {
          // a click, not a drag: the first corner of a freeform outline
          setDraftShape({ sheetId, tool: drag.kind, pts: [a] });
        } else if (dims) {
          // the dragged rectangle, clamped to the sheet, RELATIVE to its origin
          const region = regionFromRect(
            {
              x: Math.min(a.x, b.x) - pos.x,
              y: Math.min(a.y, b.y) - pos.y,
              w: Math.abs(b.x - a.x),
              h: Math.abs(b.y - a.y),
            },
            dims
          );
          if (region) finishRegion(drag.kind, sheetId, region);
        }
      }
    }
    setDrag(null);
  };

  /* ── right-click disarms: whatever tool is up, a right-click drops any
     in-progress draft and hands back to Select (Isaac, 2026-08-24). Only a
     resting Select keeps the browser's own menu. ── */
  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    if (sim) return;
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
    setLiveCrop(null);
    setDraftShape(null);
    setSplitPending(null);
    setDrag((d) => (d && (d.kind === "crop" || d.kind === "split") ? null : d));
    onToolDone();
  };

  /* ── drag-from-card placement (Slice 3): the panel arms `placing` on
     dragstart; dragover tracks the to-scale ghost, drop commits the unit ── */
  const rackDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(RACK_DRAG);
  const onDragOver = (e: React.DragEvent<SVGSVGElement>) => {
    if (!placing && !rackDrag(e)) return;
    e.preventDefault(); // allow the drop
    e.dataTransfer.dropEffect = "copy";
    setCursor(toWorld(e));
  };

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    if (sim) return;
    /* the arm set on dragstart is what lands; a drag quicker than a render
       carries the same unit in its own data, so it lands too */
    let armed: PlacingUnit | null = placing;
    if (!armed && rackDrag(e)) {
      try {
        const raw = e.dataTransfer.getData(RACK_DRAG);
        if (raw) armed = JSON.parse(raw) as PlacingUnit;
      } catch {
        armed = null;
      }
    }
    if (!armed) return;
    e.preventDefault();
    addUnit(toWorld(e), armed);
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
    // double-click closes a freeform area; its own clicks landed as corners
    // first, so the tail carries a duplicate within a click's travel — drop it
    if (draftShape && draftShape.tool === tool) {
      const tol = (TAP_SLOP_PX * 1.5) / vp.zoom;
      const corners = [...draftShape.pts];
      while (corners.length >= 2 && dist(corners[corners.length - 1], corners[corners.length - 2]) <= tol)
        corners.pop();
      if (corners.length >= 3) finishShape(corners);
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

  /** a run's words: its length, then its size (or a drain's, or a cable's kind) */
  const runLabelText = (r: DesignObject, pts: Point[]): string => {
    const sized = r.type === "pipe-run" ? pipeView.byRun.get(r.id) : undefined;
    const len = mm
      ? formatMeters(unitsToMeters(isCurvedRun(r) ? smoothedLength(pts) : polylineLength(pts), mm))
      : null;
    let tag: string | null = null;
    if (sized) {
      tag = pairSize(sized.liquidMm, sized.gasMm, pipeUnits);
    } else if (r.type === "pipe-run") {
      const auto = runSizes?.get(r.systemId ?? "") ?? null;
      const liq = Number(r.props.liquidMm) || auto?.liquidMm || null;
      const gas = Number(r.props.gasMm) || auto?.gasMm || null;
      tag = liq && gas ? `Ø${liq}/${gas}` : null;
    } else if (r.type === "drain-run") {
      tag = `Ø${Number(r.props.sizeMm) || 25} drain`;
    } else if (r.type === "cable-run") {
      tag = r.props.kind === "data" ? "Data" : "Power";
    }
    return [len, tag].filter(Boolean).join(", ");
  };
  /* every word on the plan placed knowing what is under it (plan-labels.ts):
     a room's name moves off a pipe or a unit, and a pipe's words go beside
     the copper where nothing else is */
  const planLabels = layers.labels
    ? layoutPlanLabels({
        px: 1 / labelZoom,
        rooms: rooms.map((r) => {
          const pts = roomPoints(r);
          const covFit = roomFits?.[r.id];
          return {
            id: r.id,
            polygon: pts,
            fixed: liveRoomLabel?.id === r.id ? liveRoomLabel.at : roomLabelFixed(r.props, pts),
            lineGap: 16,
            lines: [
              { text: `${String(r.props.name ?? "Zone")}${isSpillRoom(r) ? " ⤢" : ""}`, size: 13 },
              {
                text: `${mm ? formatArea(areaUnitsToM2(polygonArea(pts), mm)) : "not calibrated"}${
                  covFit ? `, ${covFit}` : ""
                }`,
                size: 11,
              },
            ],
          };
        }),
        runs: layers.pipes
          ? runs.map((r) => {
              const pts = liveRunPoints(r);
              return { id: r.id, points: pts, text: runLabelText(r, pts), size: 11 };
            })
          : [],
        solids: [
          ...(layers.units
            ? units.map((u) => {
                const fp = footprint(Number(u.props.widthMm ?? 800), Number(u.props.depthMm ?? 300));
                return footprintBox(pointAt(u), fp.w, fp.h, unitRotDeg(u));
              })
            : []),
          ...[...risers, ...joints].map((o) => footprintBox(pointAt(o), 24 / zoom, 24 / zoom)),
          ...boxes.map((o) => {
            const fp = footprint(BOX_W_MM, BOX_D_MM);
            return footprintBox(pointAt(o), fp.w, fp.h);
          }),
        ],
      })
    : null;
  useEffect(() => {
    planLabelsRef.current = planLabels;
  });
  /* a room's words wear a white backing where the design asks for it (View ›
     Label backing), so they read over a busy uploaded drawing */
  const labelBacks = doc.settings.labelBacks === true;
  /** where a placed-by-hand label's reset mark sits: off its top-right corner */
  const labelResetAt = (b: { x1: number; y0: number }): Point => ({ x: b.x1 + 4 / zoom, y: b.y0 - 4 / zoom });

  /* ── drop-to-attribute readout: while an indoor unit rides the cursor,
     every room reads how the armed capacity sits against its OWN load —
     the browser's ranking made spatial — and the room that would take the
     drop (containment, else the split's lens room) carries the verdict. ── */
  /* a tray unit already has its room, so no room is painted as its target */
  const armedIdu =
    tool === "place" && placing != null && placing.role === "idu" && !placing.allocationId;
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
        ? `${spec.capacity_cool_kw} kW cool, ${spec.capacity_heat_kw} kW heat`
        : null,
      room: roomId
        ? ((rooms.find((r) => r.id === roomId)?.props.name as string | undefined) ?? null)
        : null,
      /* W × D × H. The plan can only ever SHOW the first two — it is a view
         from above — so the height is carried here as a note: the figure you
         need to know whether a unit clears a bulkhead or sits under a window,
         and the one an elevation would draw if we ever draw one.

         It is read off the PACK rather than the object, because the placed
         object only ever stored the two dimensions the footprint needs, so
         every unit placed before today has no height on it to read. */
      size: `${Math.round(Number(u.props.widthMm ?? 0))} × ${Math.round(
        Number(u.props.depthMm ?? 0)
      )}${spec?.height_mm != null ? ` × ${Math.round(spec.height_mm)}` : ""} mm`,
      /* named so the card can say which figure is which — three bare numbers
         on a plan is the one place W×D×H is genuinely ambiguous */
      sizeAxes: spec?.height_mm != null ? "W × D × H" : "W × D",
    };
  }, [hoverUnitId, units, iduSpec, oduSpec, doc.objects, doc.systems, rooms, sysColour, pointAt]);

  /* WHAT A PICKED PIPE, JOINT OR BOX IS (Isaac, 2026-09-29: "when you click
     it, it highlights it, but it doesn't actually do anything"). A pipe says
     where its section runs, its sizes and length; a joint or a box says the
     size going in and each size coming out. Both units shown, the chosen
     one first, so the other is never a menu away. */
  const pipeCard = useMemo(() => {
    if (!selectedId) return null;
    const other = pipeUnits === "in" ? "mm" : "in";
    const both = (sec: SizedSection) =>
      `${pairSize(sec.liquidMm, sec.gasMm, pipeUnits)} (${pairSize(sec.liquidMm, sec.gasMm, other)})`;
    const byId = new Map(doc.objects.map((o) => [o.id, o]));
    const nameOf = (id: string) => {
      const o = byId.get(id);
      if (!o) return "?";
      if (o.type === "unit")
        return String(o.props.role) === "odu" ? "Outdoor unit" : String(o.props.model ?? "Indoor unit");
      return o.type === "branch-box" ? "Branch box" : "Joint";
    };
    const sec = pipeView.byRun.get(selectedId);
    if (sec) {
      return {
        role: "Pipe",
        tone: sizeTone(sec.gasMm),
        title: `${nameOf(sec.from)} to ${nameOf(sec.to)}`,
        rows: [
          { k: "Liquid / gas", v: both(sec) },
          ...(sec.lengthM != null ? [{ k: "Length", v: `${sec.lengthM.toFixed(1)} m` }] : []),
          ...(sec.upsized ? [{ k: "Liquid", v: "One size up, by the book's length rule" }] : []),
        ],
      };
    }
    const fit = pipeView.fittings.get(selectedId);
    if (!fit) return null;
    const kind = fit.fitting.kind === "box" ? "Branch box" : fit.fitting.kind === "header" ? "Header" : "Joint";
    return {
      role: kind,
      tone: fit.feed ? sizeTone(fit.feed.gasMm) : null,
      title: fit.fitting.part ?? "No part in the book",
      rows: [
        ...(fit.feed ? [{ k: "In", v: both(fit.feed) }] : []),
        ...fit.outs.map((o) => {
          /* a box's port, and the different-diameter joint its head needs */
          const port = fit.fitting.ports?.find((p) => p.to === o.to);
          const fits = port?.reducer
            ? [port.reducer.liquid, port.reducer.gas]
                .filter((r): r is NonNullable<typeof r> => r != null)
                .map((r) => r.part ?? `${r.fromMm} to ${r.toMm} mm joint`)
                .join(" + ")
            : "";
          return {
            k: `Out to ${nameOf(o.to)}${port ? ` (port ${port.port})` : ""}`,
            v: `${both(o)}${fits ? `, needs ${fits} at the box` : ""}`,
          };
        }),
      ],
    };
  }, [selectedId, pipeView, pipeUnits, doc.objects]);

  /* THE PICKED RISER'S HEIGHT (Isaac, 2026-09-30): from the plans (the
     floors' heights) by default, or set by hand — a floor console's pipe
     starts at the floor and may rise to the ceiling of the floor above, 6 m
     where the floors make it 3 */
  const riserPick = useMemo(() => {
    const r = selectedId ? doc.objects.find((o) => o.id === selectedId && o.type === "riser") : undefined;
    if (!r) return null;
    const floorName = (id: string) => doc.floors.find((f) => f.id === id)?.name ?? "a floor";
    return { group: String(r.props.group ?? "A"), gap: riserGapOf(doc.objects, doc.floors, r.id), floorName };
  }, [selectedId, doc.objects, doc.floors]);

  /* ── unit callouts ────────────────────────────────────────────────────
     A unit's own name, said on the drawing at the end of a leader — the same
     mechanic as a note's, because it is the same job. Geometry lives in
     lib/studio/callouts.ts so the print figure lays one out through the very
     same function; that single door is what stops paper drifting from screen.

     The bubble holds a constant SCREEN size like the note's words do, so its
     WORLD size depends on the zoom. Set below the note's 13 on purpose: a
     written instruction must stay the loudest thing on a sheet, and this is
     machine data. */
  const calloutFontW = CALLOUT_FONT_PX / Math.max(vp.zoom, 1);

  /** The room a unit serves, by name — the one thing the callout says that
      has to be looked up rather than read straight off the object. Stamped
      `roomId` first, else containment, exactly as the hover card resolves it. */
  const servedRoomName = (
    u: DesignObject & { geometry: { kind: "point"; at: Point } }
  ) => {
    const roomId = u.props.roomId
      ? String(u.props.roomId)
      : String(u.props.role ?? "idu") === "idu"
        ? (roomAtPoint(doc.objects, u.floorId, pointAt(u))?.id ?? null)
        : null;
    return roomId
      ? ((rooms.find((r) => r.id === roomId)?.props.name as string | undefined) ?? null)
      : null;
  };

  /* Every callout on the plan right now, laid out. NOT a useMemo and not a
     useCallback, deliberately: hand-memoising this made the React Compiler
     report "Compilation Skipped: Existing memoization could not be preserved"
     and drop the WHOLE canvas out of compilation — the same trap that keeps
     `hitSystemObject` and `eraseAt` plain at the top of this file. Quiet lint
     is not proof of compilation; the compiler memoises this for us.

     A unit shows one when it
     HAS one; the selected unit also shows a PREVIEW at the default offset, and
     that preview is a read — nothing reaches the document until it is dragged.
     That ordering is the whole reason a callout cannot be orphaned the way an
     untyped note could (#541). */
  const callouts = (() => {
    const out: { id: string; lay: CalloutLayout; placed: boolean; colour: string }[] = [];
    for (const u of units) {
      const stored = calloutOf(u);
      const at = pointAt(u);
      const fp = footprint(
        Number(u.props.widthMm ?? 800),
        Number(u.props.depthMm ?? 300)
      );
      const offset =
        liveCallout?.id === u.id
          ? liveCallout.at
          : (stored ?? (u.id === selectedId ? defaultCalloutOffset(fp) : null));
      if (!offset) continue;
      out.push({
        id: u.id,
        placed: stored !== null,
        colour: sysColour.get(u.systemId ?? "") ?? "#888",
        lay: calloutLayout({
          at,
          footprint: fp,
          offset,
          content: calloutContent(u, servedRoomName(u)),
          fontSize: calloutFontW,
          rotation: unitRotDeg(u),
        }),
      });
    }
    return out;
  })();

  /** The callout under a world point, topmost first. The BOX is the target and
      the leader is not — a line that grabbed whatever it swept over would make
      the plan underneath it unusable. */
  /* A PLAIN CONST, not a useCallback — `hitSystemObject` and `eraseAt` above
     are plain for the same reason: hand-memoising a hit test in this file is
     what dropped the whole component out of the React Compiler once already,
     and quiet lint is not proof of compilation. */
  const hitCalloutAt = (w: Point) => {
    for (let i = callouts.length - 1; i >= 0; i--) {
      if (hitCallout(callouts[i].lay, w)) return callouts[i];
    }
    return null;
  };
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

  /* the areas already chosen on the page being split — plus the rectangle
     being dragged right now — as outlines in world units. The rest of the page
     fades behind them, live while you draw and held while the panel asks. */
  const splitHoles = (() => {
    const out: { sheetId: string; outlines: Point[][] } = { sheetId: "", outlines: [] };
    const sheetFor = (id: string) => floor.plans.find((s) => s.id === id) ?? null;
    const add = (id: string, region: SheetRegion) => {
      const sheet = sheetFor(id);
      if (!sheet) return;
      const pos = sheetPos(sheet);
      out.sheetId = id;
      out.outlines.push(regionOutline(region).map((p) => ({ x: pos.x + p.x, y: pos.y + p.y })));
    };
    if (splitPending) {
      add(splitPending.sheetId, splitPending.keep);
      if (splitPending.other) add(splitPending.sheetId, splitPending.other);
    }
    if (drag?.kind === "split" && liveCrop) {
      const sheet = sheetFor(liveCrop.sheetId);
      const dims = sheet ? sheetSize(sheet) : null;
      if (sheet && dims) {
        const pos = sheetPos(sheet);
        const live = regionFromRect(
          {
            x: Math.min(liveCrop.a.x, liveCrop.b.x) - pos.x,
            y: Math.min(liveCrop.a.y, liveCrop.b.y) - pos.y,
            w: Math.abs(liveCrop.b.x - liveCrop.a.x),
            h: Math.abs(liveCrop.b.y - liveCrop.a.y),
          },
          dims
        );
        if (live) add(sheet.id, live);
      }
    }
    return out.outlines.length > 0 ? out : null;
  })();

  const cancelSplit = () => setSplitPending(null);
  const confirmSplit = (place: "above" | "below") => {
    if (!splitPending || !splitPending.other) return;
    onSplitFloor?.(splitPending.sheetId, splitPending.keep, splitPending.other, place);
    setSplitPending(null);
  };

  const cursorClass =
    drag?.kind === "pan"
      ? "ds-cur-grabbing"
      : tool === "select"
        ? ""
        : tool === "erase"
          ? "ds-cur-erase"
          : tool === "set-north"
            ? "ds-cur-north"
            : tool === "claim"
              ? "ds-cur-claim"
              : "ds-cur-cross";

  /* whether this machine still wants to be talked through the armed tool */
  const hintsOn = useHintsOn();

  /* in-progress guidance while a step tool is active */
  /* where a run can finish, in plain words (Isaac, 2026-09-29: "I can't
     understand what it's trying to tell me"): a refrigerant pipe also
     finishes on another pipe, which puts a joint there */
  const runEnds =
    tool === "pipe"
      ? "Click a unit, a box or another pipe to finish, or press Enter to stop where you are. Esc cancels."
      : "Click a unit to finish, or press Enter to stop where you are. Esc cancels.";
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
            ? "Click the second point of the known dimension. Scroll or drag to pan"
            : "Select two points a known distance apart. Scroll or drag to pan",
        }
      : tool === "measure"
        ? { icon: "ruler", text: "Drag across anything to measure it — nothing is saved" }
      /* the zone tools say their piece HERE — this and the crosshair are the
         canvas's whole half of the conversation, so Esc has to be named */
      : tool === "room-rect"
        ? { icon: "square", text: "Drag a rectangle over the zone · Esc to cancel" }
      : tool === "room-poly"
        ? {
            icon: "hexagon",
            text:
              draftPoly.length >= 3
                ? "Click the first point to close the zone · Esc to cancel"
                : "Click each corner of the zone · Esc to cancel",
          }
      /* the drawn runs: the curved tools are new grammar (dots → curve), so
         the canvas says how a line ENDS — the one thing a first draw can't
         guess */
      : isRunTool(tool)
        ? {
            icon: tool === "cable" ? "zap" : tool === "drain" ? "droplet" : "pipe",
            text:
              tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft")
                ? `Click to start, then click the points the line should curve through. ${runEnds}`
                : `Click to start, then click at each bend. Hold Shift over a unit to go in at a right angle. ${runEnds}`,
          }
      : tool === "joint"
        ? { icon: "pipe", text: "Click a run to branch it there, or anywhere to place a joint" }
      : tool === "riser"
        ? { icon: "pipe", text: "Click a pipe's end to take it up there, the middle of one for a T up, or anywhere to place one. Risers with the same letter join the floors" }
      : tool === "branch-box"
        ? { icon: "pipe", text: "Click where the branch box goes, then run each head's pipe to it" }
      : tool === "note"
        ? {
            icon: "note",
            text: notePin
              ? "Now click where the words go — out past the edge of the plan · Esc to cancel"
              : "Drag a box around what the note is about · Esc to cancel",
          }
      : tool === "set-north"
        ? floor.northPos
          ? { icon: "rotate", text: "Drag the N to rotate. Drag the centre to move" }
          : { icon: "rotate", text: "Click to place the north marker. Scroll or drag to pan" }
        : tool === "crop" || tool === "split"
          ? {
              icon: "maximize",
              text:
                draftShape && draftShape.tool === tool && draftShape.pts.length >= 3
                  ? "Click the first point, or press Enter, to close the shape"
                  : tool === "crop"
                    ? "Drag a rectangle, or click each corner, over the area to keep"
                    : splitPending && splitPending.other === null
                      ? "Now the area for the new floor — drag a rectangle, or click each corner"
                      : "Drag a rectangle, or click each corner, around the area this floor keeps",
            }
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
                      ? "Drop it in the zone it serves · Esc to cancel"
                      : "Click where the outdoor unit sits · Esc to cancel",
                }
              /* picking a system's zones: the card's Add zones started it,
                 and this corner is where the plan says so (Isaac,
                 2026-09-23) — the system being built is the active one */
              : tool === "claim"
                ? {
                    icon: "plus",
                    text: `Select zones to add to ${doc.systems.find((s) => s.id === activeSystemId)?.name ?? "the system"}`,
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
                    {s.shape ? (
                      <polygon points={s.shape.map((c) => `${pos.x + c.x},${pos.y + c.y}`).join(" ")} />
                    ) : (
                      <rect x={pos.x + crop.x} y={pos.y + crop.y} width={crop.w} height={crop.h} />
                    )}
                  </clipPath>
                )}
                {crop && sharedRefs?.has(s.imageRef) && (
                  /* a split page: the other floor's part, faded not hidden */
                  <image
                    className="ds-plan-ghost"
                    href={url}
                    x={pos.x}
                    y={pos.y}
                    width={dims.w}
                    height={dims.h}
                    preserveAspectRatio="none"
                    style={grayscale ? { filter: "grayscale(1) brightness(1.05) contrast(0.92)" } : undefined}
                  />
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
                {splitHoles && splitHoles.sheetId === s.id && (
                  /* Split: the page fades everywhere outside the chosen areas */
                  <>
                    <mask id={`split-mask-${s.id}`}>
                      <rect x={pos.x} y={pos.y} width={dims.w} height={dims.h} fill="white" />
                      {splitHoles.outlines.map((o, i) => (
                        <polygon key={i} points={o.map((c) => `${c.x},${c.y}`).join(" ")} fill="black" />
                      ))}
                    </mask>
                    <rect
                      className="ds-crop-dim"
                      x={pos.x}
                      y={pos.y}
                      width={dims.w}
                      height={dims.h}
                      mask={`url(#split-mask-${s.id})`}
                    />
                  </>
                )}
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
            /* a unit dragged off its system's rack outlines its own zone */
            const ownZone =
              tool === "place" && placing?.allocationId != null && placing.roomId === r.id;
            const covFit = roomFits?.[r.id];
            const roomSpot = planLabels?.rooms.get(r.id);
            const owners = zoneOwners.get(r.id) ?? [];
            const zoneStyle = owners.length
              ? ({ "--zc": owners[0].colour, "--zc-fill": zoneFill(owners[0].colour) } as CSSProperties)
              : undefined;
            const corner = owners.length >= 2 ? topLeftOf(pts) : null;
            return (
              <g
                key={r.id}
                className={`ds-room${selected ? " sel" : ""}${
                  loose ? " loose" : ""
                }${armedIdu ? ` armfit-${armFit ?? "none"}` : ""}${
                  isTarget || ownZone ? " droptgt" : ""
                }${owners.length ? " zoned" : ""}`}
                style={zoneStyle}
              >
                <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                {corner &&
                  owners.map((o, i) => (
                    <circle
                      key={o.id}
                      className="ds-zone-dot"
                      cx={corner.x + (10 + 14 * i) / labelZoom}
                      cy={corner.y + 10 / labelZoom}
                      r={5 / labelZoom}
                      style={{ fill: o.colour }}
                    />
                  ))}
                {roomSpot && labelBacks && (
                  <rect
                    className="ds-label-back"
                    x={roomSpot.box.x0}
                    y={roomSpot.box.y0}
                    width={roomSpot.box.x1 - roomSpot.box.x0}
                    height={roomSpot.box.y1 - roomSpot.box.y0}
                    rx={2 / labelZoom}
                  />
                )}
                {roomSpot && selected && (
                  <rect
                    className="ds-label-grab"
                    x={roomSpot.box.x0}
                    y={roomSpot.box.y0}
                    width={roomSpot.box.x1 - roomSpot.box.x0}
                    height={roomSpot.box.y1 - roomSpot.box.y0}
                    rx={2 / labelZoom}
                  />
                )}
                {roomSpot && (
                  <>
                    <text x={roomSpot.x} y={roomSpot.y} fontSize={13 / labelZoom} className="ds-room-name">
                      {String(r.props.name ?? "Zone")}
                      {/* spill rooms wear the ⤢ chip (ducted spec §9c) */}
                      {isSpillRoom(r) ? " ⤢" : ""}
                    </text>
                    <text
                      x={roomSpot.x}
                      y={roomSpot.y + 16 / labelZoom}
                      fontSize={11 / labelZoom}
                      className="ds-room-area"
                    >
                      {mm ? formatArea(areaUnitsToM2(areaU, mm)) : "not calibrated"}
                      {/* the verdict that PERSISTS after a drop — a room served
                          by the wrong size keeps saying so; a state, never a
                          block (ranking-not-gating) */}
                      {covFit && (
                        <tspan className={`ds-room-covfit ${covFit}`}>
                          {covFit === "oversized" ? ", oversized" : ", undersized"}
                        </tspan>
                      )}
                    </text>
                  </>
                )}
                {/* back to automatic: offered on the selected room once its
                    name has been moved by hand */}
                {roomSpot && selected && roomLabelFixed(r.props, pts) && (() => {
                  const x = labelResetAt(roomSpot.box);
                  const rr = 7 / zoom;
                  return (
                    <g className="ds-label-reset">
                      <title>Put the name back where the Studio places it</title>
                      <circle cx={x.x} cy={x.y} r={rr} />
                      <path
                        d={`M ${x.x + rr * 0.45} ${x.y - rr * 0.1} A ${rr * 0.45} ${rr * 0.45} 0 1 1 ${x.x + rr * 0.05} ${x.y - rr * 0.45} M ${x.x + rr * 0.05} ${x.y - rr * 0.45} l ${rr * 0.25} ${-rr * 0.2} M ${x.x + rr * 0.05} ${x.y - rr * 0.45} l ${rr * 0.2} ${rr * 0.25}`}
                      />
                    </g>
                  );
                })()}
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
            const sized = r.type === "pipe-run" ? pipeView.byRun.get(r.id) : undefined;
            /* a refrigerant pipe that reaches nothing is drawn whole in the
               bad colour, dashed, so it is found to be finished or erased */
            const loose =
              r.type === "pipe-run" && (!attachOf(r.props.startAttach) || !attachOf(r.props.endAttach));
            const colour = loose
              ? "var(--bad-t)"
              : sized
                ? `var(--pipe-${sizeTone(sized.gasMm)})`
                : (sysColour.get(r.systemId ?? "") ?? "#888");
            const curved = isCurvedRun(r);
            const cls =
              r.type === "drain-run" ? "ds-drain" : r.type === "cable-run" ? "ds-cable" : "ds-pipe";
            const label = runLabelText(r, pts);
            const spot = planLabels?.runs.get(r.id);
            return (
              <g
                key={r.id}
                className={`${cls}${litRuns.has(r.id) ? " sel" : ""}${loose ? " loose" : ""}`}
                style={{ color: colour }}
              >
                {curved ? (
                  <path d={smoothPathD(pts)} />
                ) : (
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                )}
                {/* a refrigerant end that reaches nothing is marked where it
                    stops (verdict.ts loosePipes says it on the card) */}
                {r.type === "pipe-run" &&
                  (
                    [
                      [r.props.startAttach, pts[0]],
                      [r.props.endAttach, pts[pts.length - 1]],
                    ] as const
                  ).map(([att, at], i) =>
                    attachOf(att) ? null : (
                      <circle key={i} className="ds-pipe-open" cx={at.x} cy={at.y} r={5 / zoom} />
                    )
                  )}
                {label && spot && labelBacks && (
                  <rect
                    className="ds-label-back"
                    x={spot.box.x0}
                    y={spot.box.y0}
                    width={spot.box.x1 - spot.box.x0}
                    height={spot.box.y1 - spot.box.y0}
                    rx={2 / labelZoom}
                  />
                )}
                {label && spot && (
                  <text x={spot.x} y={spot.y} fontSize={11 / labelZoom} className="ds-pipe-len" style={{ textAnchor: spot.anchor }}>
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
            const rk = u.id === selectedId ? unitRotKnob(u, zoom) : null;
            return (
              <g
                key={u.id}
                className={`ds-unit${u.id === selectedId ? " sel" : ""}`}
                style={{ color: colour }}
              >
                {/* the glyph and, on AHUs, its whole air side turn together */}
                <g transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined}>
                {(() => {
                  const spec = iduSpec?.(String(u.props.model ?? ""));
                  return unitGlyph(at.x, at.y, fp.w, fp.h, String(u.props.role ?? "idu"), zoom, spec?.form_factor, {
                    supply: spec?.supply_opening,
                    ret: spec?.return_opening,
                    perMm,
                    supplyDir: air ? (endFaceLocal(u, "supply").dir as 1 | -1) : 1,
                    /* its air side draws the faces and the arrow once a plenum,
                       a built-in return or factory spigots have oriented it */
                    bare: ends.some((e) => e.determined),
                  });
                })()}
                {(() => {
                  /* THE THROW SHOWS WHILE THE UNIT IS BEING MOVED OR TURNED,
                     and not at rest: orientation is the question while you
                     hold it, and a plan of resting heads each wearing an
                     arrow was a plan of arrows. An air-capable ducted unit
                     hands over to its own flow arrow once a plenum has
                     oriented it — the block below. */
                  if (String(u.props.role ?? "idu") !== "idu") return null;
                  const moving =
                    (drag?.kind === "point" && drag.id === u.id) || liveRotate?.id === u.id;
                  if (!moving) return null;
                  if (air && ends.some((e) => e.determined)) return null;
                  const ff = iduSpec?.(String(u.props.model ?? ""))?.form_factor;
                  if (!ff) return null;
                  return throwArrows(at.x, at.y, fp.w, fp.h, ff, zoom);
                })()}
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
                  // the handle (drag anywhere on the ring to spin, Shift snaps
                  // 15°; [ / ] step 90°)
                  /* the ring: faint and dashed in the system's colour, 8px
                     clear of the footprint's corners at any zoom, with one
                     grip on it at the unit's "up". Nothing crosses the face. */
                  const s = 1 / zoom;
                  return (
                    <g className="ds-rot-knob">
                      <circle
                        cx={rk.at.x}
                        cy={rk.at.y}
                        r={rk.r}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.2 * s}
                        strokeDasharray={`${2 * s} ${3 * s}`}
                        opacity={0.8}
                      />
                      <circle
                        cx={rk.knob.x}
                        cy={rk.knob.y}
                        r={5 * s}
                        fill="#fff"
                        stroke="currentColor"
                        strokeWidth={2 * s}
                      />
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* ── unit callouts ──
              A leader out of the unit and its name at the end of it, placed by
              hand. The bubble a SELECTED unit shows before anyone has moved it
              is a preview: it wears `.pre`, and nothing about it has reached
              the document. Dragging it is what makes it part of the drawing.

              Painted after the units so a callout is never buried under the
              next unit along, and before the plenums for the same reason the
              labels are — this is text, and text goes on top. */}
          {layers.units &&
            callouts.map((c) => (
              <g
                key={`co-${c.id}`}
                className={`ds-callout${c.placed ? "" : " pre"}${
                  c.id === selectedId ? " sel" : ""
                }`}
                style={{ color: c.colour }}
              >
                <line
                  className="ds-callout-leader"
                  x1={c.lay.start.x}
                  y1={c.lay.start.y}
                  x2={c.lay.end.x}
                  y2={c.lay.end.y}
                />
                <rect
                  className="ds-callout-box"
                  x={c.lay.box.x}
                  y={c.lay.box.y}
                  width={c.lay.box.w}
                  height={c.lay.box.h}
                  rx={c.lay.fontSize * 0.4}
                />
                {c.lay.lines.map((line, i) => (
                  <text
                    key={i}
                    className={`ds-callout-line${i === 0 ? " head" : ""}`}
                    x={c.lay.textX}
                    y={c.lay.firstBaseline + i * c.lay.lineH}
                    fontSize={c.lay.fontSize}
                    textAnchor={c.lay.anchor}
                  >
                    {line}
                  </text>
                ))}
                {c.placed && c.id === selectedId && (() => {
                  // the way back off the drawing, offered only while the unit
                  // is selected — a close mark on every label would be chrome
                  const x = calloutCloseAt(c.lay);
                  const r = 7 / zoom;
                  return (
                    <g className="ds-callout-x">
                      <circle cx={x.x} cy={x.y} r={r} />
                      <path
                        d={`M ${x.x - r * 0.4} ${x.y - r * 0.4} L ${x.x + r * 0.4} ${x.y + r * 0.4} M ${x.x + r * 0.4} ${x.y - r * 0.4} L ${x.x - r * 0.4} ${x.y + r * 0.4}`}
                      />
                    </g>
                  );
                })()}
              </g>
            ))}

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
            const colour = strayFits.has(r.id) ? "var(--bad-t)" : (sysColour.get(r.systemId ?? "") ?? "#888");
            const tee =
              doc.objects.filter(
                (o) =>
                  o.type === "pipe-run" &&
                  o.floorId === r.floorId &&
                  (attachOf(o.props.startAttach)?.id === r.id || attachOf(o.props.endAttach)?.id === r.id)
              ).length >= 2;
            return (
              <g
                key={r.id}
                className={`ds-riser${r.id === selectedId ? " sel" : ""}${tee ? " tee" : ""}`}
                style={{ color: colour }}
              >
                <circle cx={at.x} cy={at.y} r={(tee ? 12 : 10) / zoom} />
                {tee ? (
                  /* dropped mid-pipe it is a T with the riser round it
                     (Isaac, 2026-09-30): the T's square inside the ring, its
                     letter beside */
                  <>
                    <rect x={at.x - 4 / zoom} y={at.y - 4 / zoom} width={8 / zoom} height={8 / zoom} />
                    <text x={at.x + 22 / zoom} y={at.y + 3.5 / zoom} fontSize={10 / zoom}>
                      ⇅{String(r.props.group ?? "A")}
                    </text>
                  </>
                ) : (
                  <text x={at.x} y={at.y + 3.5 / zoom} fontSize={10 / zoom}>
                    ⇅{String(r.props.group ?? "A")}
                  </text>
                )}
              </g>
            );
          })}

          {/* branch boxes — to scale (PAC-MK·BC, 450 × 280 mm), the heads' runs end on them */}
          {layers.pipes && boxes.map((b) => {
            const at = pointAt(b);
            /* fittings are drawn in ink, not the system's colour: the pipes
               carry colour (their size), and a fitting has to stand apart */
            const fp = footprint(BOX_W_MM, BOX_D_MM);
            const part = pipeView.fittings.get(b.id)?.fitting.part;
            /* its pipe in on one end and a port for each head on the other
               (Isaac, 2026-09-30): as many ports as the box it sizes to has,
               three until then */
            const ports = (part && pack?.parts.find((x) => x.model === part)?.ports) || 3;
            const stub = 7 / zoom;
            const bl = at.x - fp.w / 2;
            const br = at.x + fp.w / 2;
            return (
              <g key={b.id} className={`ds-bbox${b.id === selectedId ? " sel" : ""}`} style={{ color: strayFits.has(b.id) ? "var(--bad-t)" : "var(--ink)" }}>
                <line className="ds-bbox-port" x1={bl - stub} y1={at.y} x2={bl} y2={at.y} />
                {Array.from({ length: ports }, (_, i) => {
                  const y = at.y - fp.h / 2 + ((i + 1) / (ports + 1)) * fp.h;
                  return <line key={i} className="ds-bbox-port" x1={br} y1={y} x2={br + stub} y2={y} />;
                })}
                <rect x={at.x - fp.w / 2} y={at.y - fp.h / 2} width={fp.w} height={fp.h} />
                {part && layers.labels && (
                  <text x={at.x} y={at.y + fp.h / 2 + 12 / labelZoom} fontSize={10 / labelZoom} className="ds-bbox-part">
                    {part}
                  </text>
                )}
              </g>
            );
          })}

          {/* joints — a solid T where the refrigerant branches (Isaac,
              2026-09-30: "more of a block, T-shape"): a short thick arm down
              each pipe on it, so the T points the way the pipes go; a joint
              with no pipe on keeps the square */}
          {layers.pipes && joints.map((j) => {
            const at = pointAt(j);
            const half = 5 / zoom;
            const arm = 9 / zoom;
            const legs = runs.flatMap((r) => {
              const atStart = attachOf(r.props.startAttach)?.id === j.id;
              if (!atStart && attachOf(r.props.endAttach)?.id !== j.id) return [];
              const raw = liveRunPoints(r);
              if (raw.length < 2) return [];
              const pts = atStart ? raw : [...raw].reverse();
              const p0 = pts[0];
              /* aim at the first point further off than the arm: a tiny jog
                 where the pipe leaves (a few cm before it turns) would
                 otherwise lay the arm flat along the bar */
              const p1 = pts.slice(1).find((q) => Math.hypot(q.x - p0.x, q.y - p0.y) > arm * 1.5) ?? pts[pts.length - 1];
              const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
              return len > 0 ? [{ x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len }] : [];
            });
            return (
              <g key={j.id} className={`ds-joint${j.id === selectedId ? " sel" : ""}`} style={{ color: strayFits.has(j.id) ? "var(--bad-t)" : "var(--ink)" }}>
                {legs.length ? (
                  <>
                    {legs.map((u, i) => (
                      <line key={`h${i}`} className="halo" x1={at.x} y1={at.y} x2={at.x + u.x * arm} y2={at.y + u.y * arm} />
                    ))}
                    {legs.map((u, i) => (
                      <line key={`a${i}`} className="arm" x1={at.x} y1={at.y} x2={at.x + u.x * arm} y2={at.y + u.y * arm} />
                    ))}
                  </>
                ) : (
                  <rect x={at.x - half} y={at.y - half} width={half * 2} height={half * 2} />
                )}
              </g>
            );
          })}

          {/* connection anchors — visible while piping; nearest one glows
              BEFORE the click (pre-click snap feedback). A refrigerant run's
              end over another run shows the joint it will make there. */}
          {/* the Riser tool shows the same: where on a pipe it will go in
              (Isaac, 2026-09-30: "it doesn't show you where you can connect") */}
          {(isRunTool(tool) || tool === "joint" || tool === "riser") &&
            (() => {
              const near = cursor && tool !== "joint" && tool !== "riser" ? nearestAnchor(cursor) : null;
              const landing =
                cursor && !near && (tool === "pipe" || tool === "joint" || tool === "riser") ? runLanding(cursor) : null;
              const half = 6 / zoom;
              return [
                ...(tool === "joint" || tool === "riser"
                  ? []
                  : anchors.map((a) => (
                      <circle
                        key={`${a.kind}:${a.id}`}
                        className={`ds-anchor${near?.id === a.id ? " ready" : ""}`}
                        cx={a.at.x}
                        cy={a.at.y}
                        r={(near?.id === a.id ? 9 : 5) / zoom}
                      />
                    ))),
                ...(landing
                  ? [
                      tool === "riser" ? (
                        /* rung where it will go: onto a free end near one,
                           else in the pipe there */
                        (() => {
                          const end = cursor ? freeRunEnd(doc.objects, landing.runId, cursor, RISER_END_PX / zoom) : null;
                          const at = end?.at ?? landing.at;
                          return <circle key="landing" className="ds-anchor ready" cx={at.x} cy={at.y} r={10 / zoom} />;
                        })()
                      ) : (
                        <rect
                          key="landing"
                          className="ds-anchor ready"
                          x={landing.at.x - half}
                          y={landing.at.y - half}
                          width={half * 2}
                          height={half * 2}
                        />
                      ),
                    ]
                  : []),
              ];
            })()}

          {/* run draft — straight tools preview the ortho-snapped tail, the
              curved ones preview the live spline through every dot */}
          {draftPipe.length > 0 &&
            (() => {
              const curved =
                tool === "cable" || (tool === "pipe" && draw.pipeForm === "soft");
              const target = cursor
                ? nearestAnchor(cursor)?.at ?? (tool === "pipe" ? runLanding(cursor)?.at : undefined)
                : undefined;
              const head = target && shiftDown && !curved ? squareInto(draftPipe, target) : draftPipe;
              const tail = cursor
                ? [
                    target ??
                      (curved
                        ? cursor
                        : orthoSnap(draftPipe[draftPipe.length - 1], cursor)),
                  ]
                : [];
              const pts = [...head, ...tail];
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
                /* the throw travels with the ghost, so which way the unit
                   will face is known before it is let go of */
                const ghostFf =
                  placing.role === "idu" ? iduSpec?.(placing.model)?.form_factor : undefined;
                return (
                  <>
                    {unitGlyph(at.x, at.y, fp.w, fp.h, placing.role, zoom, ghostFf)}
                    {ghostFf && throwArrows(at.x, at.y, fp.w, fp.h, ghostFf, zoom)}
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
              className={drag?.kind === "split" ? "ds-crop-keep" : "ds-crop-preview"}
              x={Math.min(liveCrop.a.x, liveCrop.b.x)}
              y={Math.min(liveCrop.a.y, liveCrop.b.y)}
              width={Math.abs(liveCrop.b.x - liveCrop.a.x)}
              height={Math.abs(liveCrop.b.y - liveCrop.a.y)}
            />
          )}
          {/* the areas chosen for a split, held while the second is drawn and
              while the panel asks: the first stays, the second is the new floor */}
          {splitPending &&
            (() => {
              const sheet = floor.plans.find((s) => s.id === splitPending.sheetId);
              if (!sheet) return null;
              const pos = sheetPos(sheet);
              const pts = (r: SheetRegion) =>
                regionOutline(r)
                  .map((c) => `${pos.x + c.x},${pos.y + c.y}`)
                  .join(" ");
              return (
                <>
                  <polygon className="ds-crop-keep" points={pts(splitPending.keep)} />
                  {splitPending.other && (
                    <polygon className="ds-crop-keep other" points={pts(splitPending.other)} />
                  )}
                </>
              );
            })()}
          {/* a freeform area being drawn: the corners so far, closing on the
              first (the same markup as the zone polygon) */}
          {draftShape &&
            draftShape.tool === tool &&
            (() => {
              const closing =
                cursor != null &&
                draftShape.pts.length >= 3 &&
                dist(worldToScreen(draftShape.pts[0], vp), worldToScreen(cursor, vp)) <=
                  CLOSE_SNAP_PX;
              const tail = closing ? draftShape.pts[0] : cursor;
              return (
                <g className="ds-draft">
                  <polyline
                    points={[...draftShape.pts, ...(tail ? [tail] : [])]
                      .map((c) => `${c.x},${c.y}`)
                      .join(" ")}
                  />
                  <circle
                    className={closing ? "close-ready" : undefined}
                    cx={draftShape.pts[0].x}
                    cy={draftShape.pts[0].y}
                    r={(CLOSE_SNAP_PX / zoom) * (closing ? 1.1 : 0.6)}
                  />
                </g>
              );
            })()}

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
            const lay = noteLayoutOf(n, noteFontW);
            const start = leaderStart(rect, leader);
            const on = stored.id === selectedId || noteEdit?.id === stored.id;
            /* the words become a TEXT FRAME once the note is selected: the
               block outlined, a grip on its outer side for the measure and
               one at its outer corner for the size. Screen-constant, like the
               leader dot, so they stay grabbable at any zoom. */
            const grips = on ? noteGrips(n, noteFontW) : null;
            const gr = 3.4 / vp.zoom;
            return (
              <g
                key={stored.id}
                className={`ds-note${on ? " sel" : ""}`}
                style={{ color: noteInkOf(n) }}
              >
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
                  fontSize={lay.fontSize}
                  textAnchor={lay.anchor}
                >
                  {lay.lines.map((line, i) => (
                    <tspan key={i} x={lay.textX} dy={i === 0 ? 0 : lay.lineH}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {grips && (
                  <g className="ds-note-frame">
                    <rect
                      x={lay.box.x}
                      y={lay.box.y}
                      width={lay.box.w}
                      height={lay.box.h}
                      strokeWidth={1 / vp.zoom}
                      strokeDasharray={`${3 / vp.zoom} ${3 / vp.zoom}`}
                    />
                    {/* the measure: a bar, because it moves along ONE axis */}
                    <rect
                      className="ds-note-grip measure"
                      x={grips.measure.x - gr}
                      y={grips.measure.y - gr * 2.2}
                      width={gr * 2}
                      height={gr * 4.4}
                      rx={gr}
                    />
                    {/* the size: a corner, because it scales the whole block */}
                    <circle
                      className="ds-note-grip size"
                      cx={grips.size.x}
                      cy={grips.size.y}
                      r={gr}
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* the cloud being dragged out — it is the shape you will get, not a
              box that turns into one on release */}
          {tool === "note" && noteDraft && (
            <g className="ds-note draft" style={{ color: armedInk }}>
              <path className="ds-note-cloud" d={cloudPath(rectFromDrag(noteDraft.a, noteDraft.b))} />
            </g>
          )}
          {/* cloud drawn, waiting to be told where its words go: the leader
              rubber-bands to the cursor so the margin lands where you look */}
          {tool === "note" && notePin && (
            <g className="ds-note draft" style={{ color: armedInk }}>
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

      {/* split panel — the first area stays, the second becomes a floor above
          or below. Nothing changes until one of the buttons. */}
      {splitPending &&
        splitPending.other &&
        (() => {
          const sheet = floor.plans.find((s) => s.id === splitPending.sheetId);
          const pos = sheet ? sheetPos(sheet) : { x: 0, y: 0 };
          const pts = regionOutline(splitPending.other).map((c) => ({
            x: pos.x + c.x,
            y: pos.y + c.y,
          }));
          return (
            <div
              className={`ds-wallsel-panel${panelSlot(pts) === "top" ? " top" : ""}`}
              ref={measureRoomPanel}
              role="dialog"
              aria-label="Split the plan"
            >
              <div className="ds-wallsel-title">New floor from the second area</div>
              <div className="ds-wallsel-actions">
                <button className="ds-calib-cancel" onClick={cancelSplit}>
                  Cancel
                </button>
                <button className="ds-calib-cancel" onClick={() => confirmSplit("below")}>
                  Add floor below
                </button>
                <button className="ds-calib-ok" onClick={() => confirmSplit("above")}>
                  Add floor above
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
              aria-label="Size the zone"
            >
              <div className="ds-wallsel-title">
                {adjust.isNew ? "Size the zone" : "Edit the zone"}
              </div>
              <div className="ds-wallsel-hint">
                Saving pins the zone to the plan so panning can&apos;t drag it —
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
          const live = noteAt(n);
          const at = worldToScreen(noteLeader(live), vp);
          /* the cloud, in screen px — the card flips around it rather than
             landing on it. Reading a note means reading what it CIRCLES. */
          const r = noteRect(live);
          const c0 = worldToScreen({ x: r.x, y: r.y }, vp);
          const c1 = worldToScreen({ x: r.x + r.w, y: r.y + r.h }, vp);
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
                avoid: {
                  x0: Math.min(c0.x, c1.x),
                  y0: Math.min(c0.y, c1.y),
                  x1: Math.max(c0.x, c1.x),
                  y1: Math.max(c0.y, c1.y),
                },
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
              {/* the ink, on the note it belongs to. Recolouring is a
                  document edit like any other — one press, one undo step. */}
              <div className="ds-note-inks" role="radiogroup" aria-label="Note colour">
                {NOTE_INKS.map((ink) => {
                  const on = noteInkOf(n) === ink.hex;
                  return (
                    <button
                      key={ink.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`ds-note-ink${on ? " on" : ""}`}
                      style={{ background: ink.hex, color: ink.hex }}
                      title={ink.label}
                      aria-label={ink.label}
                      onClick={() => {
                        /* BOTH things: recolour this note, and arm the ink for
                           the next one. Choosing a colour here is the natural
                           way to do it — the note is open and the swatches are
                           in front of you — and it was the one door that told
                           the bench nothing, so every following note came out
                           graphite again. See note-ink.ts. */
                        setNoteInk(noteEdit.id, ink.hex);
                        setArmedInk(ink.hex);
                      }}
                    />
                  );
                })}
              </div>
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

      {/* in-progress guidance while a step tool is active — a window tucked
          into the canvas's own top-right corner, taking its outer radius from
          the canvas so it reads as part of the sheet rather than a pill
          floating over the middle of the drawing (Isaac, 2026-08-25). Grey,
          not the dark chrome: it sits over the plan for as long as the tool is
          armed, and the dark pill kept pulling the eye off the shape being
          drawn. Anyone who knows the gestures turns it off on the × . */}
      {refusal ? (
        <div className="ds-tool-hint" role="alert">
          <Icon name="x" size={14} />
          <span className="ds-tool-hint-t">{refusal}</span>
        </div>
      ) : toolHint && hintsOn && (
        <div className="ds-tool-hint" role="status">
          <Icon name={toolHint.icon} size={14} />
          <span className="ds-tool-hint-t">{toolHint.text}</span>
          <button
            className="ds-tool-hint-x"
            title="Turn hints off"
            aria-label="Turn tool hints off"
            onClick={() => setHintsOn(false)}
          >
            <Icon name="x" size={13} />
          </button>
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
              <dt>{hoverCard.sizeAxes}</dt>
              <dd>{hoverCard.size}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* the picked pipe, joint or box — shown while nothing is hovered */}
      {!hoverCard && pipeCard && (
        <div className="ds-unitcard pipe" role="status" aria-live="polite">
          <div className="ds-unitcard-h">
            {pipeCard.tone != null && (
              <span className="ds-unitcard-sw" style={{ background: `var(--pipe-${pipeCard.tone})` }} />
            )}
            <span className="ds-unitcard-role">{pipeCard.role}</span>
          </div>
          <div className="ds-unitcard-model">{pipeCard.title}</div>
          <dl className="ds-unitcard-rows">
            {pipeCard.rows.map((r, i) => (
              <div key={i}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* the picked riser: where it runs, and its height */}
      {!hoverCard && riserPick && (
        <div className="ds-unitcard pipe riser" role="group" aria-label={`Riser ${riserPick.group}`}>
          <div className="ds-unitcard-h">
            <span className="ds-unitcard-role">Riser</span>
          </div>
          <div className="ds-unitcard-model">{`Riser ${riserPick.group}`}</div>
          <dl className="ds-unitcard-rows">
            <div>
              <dt>Runs</dt>
              <dd>
                {riserPick.gap
                  ? `${riserPick.floorName(riserPick.gap.fromFloorId)} to ${riserPick.floorName(riserPick.gap.toFloorId)}`
                  : "Not joined to another floor"}
              </dd>
            </div>
            {riserPick.gap && (
              <div>
                <dt>Height</dt>
                <dd>
                  {riserPick.gap.manualM != null
                    ? `${riserPick.gap.manualM} m, set by hand`
                    : `${Math.round(riserPick.gap.planM * 10) / 10} m, from the floor heights`}
                </dd>
              </div>
            )}
          </dl>
          {riserPick.gap &&
            (() => {
              const gap = riserPick.gap;
              const manual = gap.manualM != null;
              return (
                <div className="ds-riser-set">
                  <div className="ds-riser-seg" role="radiogroup" aria-label="Riser height">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!manual}
                      className={manual ? "" : "on"}
                      onClick={() => manual && onMutate((d) => setRiserHeight(d, gap.lowerId, null))}
                    >
                      From plans
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={manual}
                      className={manual ? "on" : ""}
                      onClick={() =>
                        !manual &&
                        onMutate((d) => setRiserHeight(d, gap.lowerId, Math.round(gap.planM * 10) / 10 || 3))
                      }
                    >
                      Manual
                    </button>
                  </div>
                  {manual && (
                    <label className="ds-riser-m">
                      <input
                        key={`${gap.lowerId}:${gap.manualM}`}
                        type="number"
                        min={0.1}
                        max={100}
                        step={0.1}
                        defaultValue={gap.manualM ?? ""}
                        aria-label="Riser height, metres"
                        onBlur={(e) => {
                          const v = Number(e.currentTarget.value);
                          if (!Number.isFinite(v) || v <= 0 || v === gap.manualM) return;
                          onMutate((d) => setRiserHeight(d, gap.lowerId, v));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <span>m</span>
                    </label>
                  )}
                </div>
              );
            })()}
        </div>
      )}

      {/* readouts + zoom controls */}
      <div className="ds-canvas-hud">
        <span>
          {mm
            ? `1 grid = 1 m, ${mm.toFixed(2)} mm/px`
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
