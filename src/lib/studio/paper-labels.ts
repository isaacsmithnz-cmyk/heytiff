/* THE PAPER'S WORDS, AND CALLOUTS KEPT CLEAR OF THEM (the next flow; scope 1
   of the Studio rework, "one layout keeps labels clear of each other on
   both"). 7 Cutler printed its PEA-M125HAA callout under the note
   "Underfloor Ducted for GF and Study. Location TBC": both were put by hand
   when the canvas drew them a third of their printed size, so nobody saw
   them meet.

   A callout is only an offset from its unit (callouts.ts), so it can move
   without losing anything: each one, in document order, keeps its spot if
   that is clear, else takes the nearest clear spot round it, inside the
   figure. Clear of the room names and run lengths as the paper places them,
   the notes' words and clouds, the units, and every callout already down.
   The notes stay where they were written: they are somebody's words.

   One door for both surfaces. The paper lays its words out through
   `paperLabelsIn`; the canvas asks the same question at the same size, so a
   callout the canvas shows nudged prints nudged, to the same spot. */

import type { DesignDocument, DesignObject, Floor, Point } from "./document";
import { calloutContent, calloutLayout, calloutOf, type CalloutPlacement } from "./callouts";
import { CALLOUT_FONT_REF, planFigureBounds } from "./figure-bounds";
import {
  areaUnitsToM2,
  formatArea,
  formatMeters,
  polygonArea,
  polylineLength,
  smoothedLength,
  unitsToMeters,
} from "./geometry";
import { isNote, noteLayoutOf, noteRect, type NoteRect } from "./notes";
import { grilleSize, isGrille } from "./grilles";
import { deviceHalf, isDevice } from "./devices";
import { footprintBox, layoutPlanLabels, roomLabelFixed, type Box, type PlanLabels, type PlanLabelsIn } from "./plan-labels";

type PointObject = DesignObject & { geometry: { kind: "point"; at: Point } };

export interface PaperLayers {
  labels: boolean;
  pipes: boolean;
  units: boolean;
  /** the next flow: words keep off the grilles, sensors and controllers too */
  air?: boolean;
}

/** what the air side puts on the plan that words keep off: each grille's
    face and each sensor's or controller's plate */
export function airSolids(doc: DesignDocument, floor: Floor, minUnits: number): Box[] {
  const mm = floor.scaleMmPerUnit;
  return doc.objects
    .filter((o) => o.floorId === floor.id)
    .flatMap((o) => {
      if (isGrille(o)) {
        const s = grilleSize(o);
        const k = mm ?? 10;
        return [footprintBox(o.geometry.at, s.wMm / k, s.hMm / k, o.geometry.rotation ?? 0)];
      }
      if (isDevice(o)) {
        const h = deviceHalf(o.type, mm, minUnits);
        return [{ x0: o.geometry.at.x - h, y0: o.geometry.at.y - h, x1: o.geometry.at.x + h, y1: o.geometry.at.y + h }];
      }
      return [];
    });
}

const RUN_TYPES = new Set(["pipe-run", "drain-run", "cable-run", "duct-run"]);

/** a unit's footprint on paper, in world units */
export function paperFootprint(o: DesignObject, floor: Floor, u: number): { w: number; h: number } {
  const widthMm = Number(o.props.widthMm ?? 800);
  const depthMm = Number(o.props.depthMm ?? 300);
  const scale = floor.scaleMmPerUnit;
  return scale ? { w: widthMm / scale, h: depthMm / scale } : { w: 45 * u, h: 45 * u * (depthMm / Math.max(widthMm, 1)) };
}

/** a run's words on paper: its length, and a drain's size, a cable's kind or a duct's size */
export function paperRunText(r: DesignObject & { geometry: { kind: "polyline"; points: Point[] } }, floor: Floor): string {
  const pts = r.geometry.points;
  const scale = floor.scaleMmPerUnit;
  const curved = r.type === "cable-run" || (r.type === "pipe-run" && r.props.form === "soft");
  const len = scale ? formatMeters(unitsToMeters(curved ? smoothedLength(pts) : polylineLength(pts), scale)) : null;
  const tag =
    r.type === "drain-run"
      ? `Ø${Number(r.props.sizeMm) || 25} drain`
      : r.type === "cable-run"
        ? r.props.kind === "data"
          ? "Data"
          : "Power"
        : r.type === "duct-run"
          ? `Ø${Number(r.props.diaMm) || 250} ${r.props.stream === "return" ? "return" : "supply"}`
          : null;
  return [len, tag].filter(Boolean).join(", ");
}

/** what the paper hands the label layout for one floor, at `u` world units a reference pixel */
export function paperLabelsIn(doc: DesignDocument, floor: Floor, u: number, layers: PaperLayers): PlanLabelsIn {
  const onFloor = doc.objects.filter((o) => o.floorId === floor.id);
  const scale = floor.scaleMmPerUnit;
  const rooms = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
      o.type === "room" && o.geometry.kind === "polygon"
  );
  const runs = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "polyline"; points: Point[] } } =>
      RUN_TYPES.has(o.type) && o.geometry.kind === "polyline"
  );
  const points = (type: string) => onFloor.filter((o): o is PointObject => o.type === type && o.geometry.kind === "point");
  return {
    px: u,
    rooms: rooms.map((r) => ({
      id: r.id,
      polygon: r.geometry.points,
      /* its tab where it was put on the wall; the old inside spot only
         when that is all there is — the canvas reads it the same way */
      edge: typeof r.props.labelEdge === "number" ? r.props.labelEdge : null,
      fixed: typeof r.props.labelEdge === "number" ? undefined : roomLabelFixed(r.props, r.geometry.points),
      lineGap: 16,
      lines: [
        { text: String(r.props.name ?? "Room"), size: 13 },
        {
          text: scale ? formatArea(areaUnitsToM2(polygonArea(r.geometry.points), scale)) : "not calibrated",
          size: 11,
        },
      ],
    })),
    runs: layers.pipes ? runs.map((r) => ({ id: r.id, points: r.geometry.points, text: paperRunText(r, floor), size: 11 })) : [],
    solids: [
      ...(layers.units
        ? points("unit").map((o) => {
            const fp = paperFootprint(o, floor, u);
            return footprintBox(o.geometry.at, fp.w, fp.h, (o.geometry as { rotation?: number }).rotation ?? 0);
          })
        : []),
      ...points("riser").map((o) => footprintBox(o.geometry.at, 24 * u, 24 * u)),
      ...(layers.air ? airSolids(doc, floor, 5 * u) : []),
    ],
  };
}

const boxOf = (r: NoteRect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/* the rings a callout tries round its spot: a line's height apart, out to
   twelve, sixteen ways round each */
const RINGS = 12;
const WAYS = 16;
/* air kept round a callout, in its own font size */
const AIR_EM = 0.35;

/**
 * Where each placed callout on `floor` is drawn, kept clear: the unit's id to
 * the offset to draw it at. `labels` is the paper's own layout of the floor's
 * words (`layoutPlanLabels(paperLabelsIn(...))`); `held` is a callout being
 * dragged, which stays under the pointer and the rest go round it.
 */
export function clearCallouts(
  doc: DesignDocument,
  floor: Floor,
  u: number,
  labels: PlanLabels | null,
  held?: { id: string; at: CalloutPlacement } | null
): Map<string, CalloutPlacement> {
  const out = new Map<string, CalloutPlacement>();
  const onFloor = doc.objects.filter((o) => o.floorId === floor.id);
  const units = onFloor.filter((o): o is PointObject => o.type === "unit" && o.geometry.kind === "point");
  const fontSize = CALLOUT_FONT_REF * u;
  const air = fontSize * AIR_EM;
  const bounds = planFigureBounds(doc, floor);
  const within = bounds ? { x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.w, y1: bounds.y + bounds.h } : null;

  const taken: Box[] = [
    ...(labels ? [...labels.rooms.values(), ...labels.runs.values()].map((l) => l.box) : []),
    ...onFloor.filter(isNote).flatMap((n) => [boxOf(noteLayoutOf(n).box), boxOf(noteRect(n))]),
    ...units.map((o) => {
      const fp = paperFootprint(o, floor, u);
      return footprintBox(o.geometry.at, fp.w, fp.h, (o.geometry as { rotation?: number }).rotation ?? 0);
    }),
  ];
  const roomName = (o: DesignObject): string | null => {
    const room = o.props.roomId ? onFloor.find((r) => r.id === String(o.props.roomId)) : undefined;
    return (room?.props.name as string | undefined) ?? null;
  };
  const boxAt = (o: PointObject, offset: CalloutPlacement): Box => {
    const lay = calloutLayout({
      at: o.geometry.at,
      footprint: paperFootprint(o, floor, u),
      offset,
      content: calloutContent(o, roomName(o)),
      fontSize,
      rotation: (o.geometry as { rotation?: number }).rotation ?? 0,
    });
    const b = boxOf(lay.box);
    return { x0: b.x0 - air, y0: b.y0 - air, x1: b.x1 + air, y1: b.y1 + air };
  };
  const crowding = (b: Box): number => taken.reduce((n, t) => n + overlap(b, t), 0);
  const inside = (b: Box) => !within || (b.x0 >= within.x0 && b.y0 >= within.y0 && b.x1 <= within.x1 && b.y1 <= within.y1);

  const placed = units.flatMap((o) => {
    const at = held?.id === o.id ? held.at : calloutOf(o);
    return at ? [{ o, at }] : [];
  });
  /* the one in the hand is down first: it goes where the pointer is */
  const order = [...placed.filter((p) => p.o.id === held?.id), ...placed.filter((p) => p.o.id !== held?.id)];
  for (const { o, at } of order) {
    if (o.id === held?.id) {
      out.set(o.id, at);
      taken.push(boxAt(o, at));
      continue;
    }
    let best = { at, box: boxAt(o, at), n: Infinity };
    best.n = crowding(best.box);
    for (let ring = 1; best.n > 0 && ring <= RINGS; ring++) {
      const r = ring * fontSize * 1.4;
      for (let k = 0; k < WAYS; k++) {
        const a = (k / WAYS) * Math.PI * 2;
        const cand = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
        const box = boxAt(o, cand);
        if (!inside(box)) continue;
        const n = crowding(box);
        if (n < best.n) best = { at: cand, box, n };
        if (n === 0) break;
      }
    }
    out.set(o.id, best.at);
    taken.push(best.box);
  }
  return out;
}

/** the paper's words for a floor, and its callouts kept clear of them */
export function paperLayout(
  doc: DesignDocument,
  floor: Floor,
  u: number,
  layers: PaperLayers,
  held?: { id: string; at: CalloutPlacement } | null
): { labels: PlanLabels | null; callouts: Map<string, CalloutPlacement> } {
  const labels = layers.labels ? layoutPlanLabels(paperLabelsIn(doc, floor, u, layers)) : null;
  return { labels, callouts: layers.units ? clearCallouts(doc, floor, u, labels, held) : new Map() };
}
