"use client";

import { faceFrame, openingFor, plenumFigure, plenumsFromDucts } from "@/lib/studio/unit-plenum";
import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import { AIRFLOW_INKS, isAirflowMark, markShapes, streamOf } from "@/lib/studio/airflow-marks";
import { DUCT_LABEL_STYLE, ductWidth, plenumInkOf, RISER_PAINT, riserMark, supplyInkOf } from "@/lib/studio/duct-size";
import { ductLinesOn, fittingKey, fittingName, linePathD } from "@/lib/studio/duct-fitting";
import { NoteBackdrop } from "../note-backdrop";
import { FreeDuctEnd, PaintedDuct, PaintedFitting, RiserDisc } from "../painted-duct";
import { grilleShape, grilleSize, grilleSplit, grilleStream, grilleStyle, isGrille, splitShape } from "@/lib/studio/grilles";
import { deviceHalf, deviceLetter, isDevice } from "@/lib/studio/devices";
import { areaUnitsToM2, formatArea, polygonArea, smoothPathD, unitsToMeters } from "@/lib/studio/geometry";
import { ductFreeEnds, ductJunctions, isCurvedRun, straightLegsOf } from "@/lib/studio/run-legs";
import { runLabelStyle } from "@/lib/studio/plan-labels";
import {
  cloudPath,
  isNote,
  noteBlurOf,
  leaderStart,
  noteInkOf,
  noteLeader,
  noteRect,
  noteLayoutOf,
  type NoteObject,
} from "@/lib/studio/notes";
import { calloutContent, calloutLayout, calloutOf } from "@/lib/studio/callouts";
import {
  CALLOUT_FONT_REF,
  northRadius,
  planFigureBounds,
  sheetUnitOf,
} from "@/lib/studio/figure-bounds";
import { unitGlyph, type LayerFlags } from "../canvas";
import { paperFootprint, paperLayout, paperRunText } from "@/lib/studio/paper-labels";
import { useStudioFlow } from "../flow";
import { tabPath } from "@/lib/studio/room-tab";
import type { UnitMark } from "@/lib/studio/export";

/* A STATIC plan rendering for print and image export — the same drawing the
   canvas shows, minus every interactive affordance (grid, handles, ghosts,
   HUDs). Deliberately not StudioCanvas: that component measures its container
   and owns pointer/zoom state, which a hidden print root can't provide.

   Self-contained on purpose: one embedded <style> carries every rule
   (explicit font-family included) so the figure survives both @media print
   and XMLSerializer→<img>→canvas rasterization, where studio.css never
   follows. Class names reuse the canvas vocabulary (.ds-room, .ds-unit…)
   scoped under .ds-pf so unitGlyph's own class names are covered.

   Black & white is an SVG <feColorMatrix saturate 0> on the whole content
   group — unlike the canvas's raster-only CSS filter, it desaturates the
   vector work (rooms, pipes, units) and the plan sheets alike, and it
   serializes. All ids are prefixed per-floor so several figures can share
   one print document. */

/* the frame and the type scale live in lib (figure-bounds.ts) */
export { planFigureBounds };

/** nice scale-bar length (m) for a plan that is `metres` across */
const barMetres = (metres: number): number => {
  const target = metres / 6;
  const nice = [1, 2, 5, 10, 20, 50, 100];
  let best = nice[0];
  for (const n of nice) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
};

export function PlanFigure({
  doc,
  floor,
  layers,
  grayscale,
  legend,
  urls,
  markOf,
}: {
  doc: DesignDocument;
  floor: Floor;
  layers: LayerFlags;
  grayscale: boolean;
  legend: boolean;
  /** sheet imageRef → resolvable URL (signed for print, data: for PNG) */
  urls: Record<string, string>;
  /** a head's kind and ducted faces from the pack, so paper draws the same
      mark the canvas does; absent, every head is the plain box */
  markOf?: (model: string) => UnitMark | undefined;
}) {
  const flow = useStudioFlow();
  const bounds = planFigureBounds(doc, floor);
  const unit = sheetUnitOf(doc, floor);
  if (!bounds || unit == null) return null;
  const { x, y, w, h } = bounds;
  /* "screen pixel" at reference width — off the DRAWING, not the finished
     figure, so markup in the margin can't shrink the labels */
  const u = unit;
  const scale = floor.scaleMmPerUnit;
  const pid = `pf-${floor.id}`;

  const sysColour = new Map<string, string>();
  for (const s of doc.systems) sysColour.set(s.id, s.colour);
  const colourOf = (o: DesignObject) => sysColour.get(o.systemId ?? "") ?? "#888";

  const onFloor = doc.objects.filter((o) => o.floorId === floor.id);
  const rooms = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
      o.type === "room" && o.geometry.kind === "polygon"
  );
  const runs = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "polyline"; points: Point[] } } =>
      (o.type === "pipe-run" || o.type === "drain-run" || o.type === "cable-run" || o.type === "duct-run") &&
      o.geometry.kind === "polyline"
  );
  const onFitting = ductLinesOn(ductJunctions(runs), (dia) => ductWidth(dia, scale ?? 10, u));
  const units = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
      o.type === "unit" && o.geometry.kind === "point"
  );
  const risers = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
      o.type === "riser" && o.geometry.kind === "point"
  );
  /** a run's words on paper: its length, and a drain's size or a cable's kind */
  const runText = (r: (typeof runs)[number]): string => paperRunText(r, floor);
  const unitFp = (o: (typeof units)[number]) => paperFootprint(o, floor, u);
  /* the words placed as the canvas places them (plan-labels.ts): off the
     pipes, the units and each other; in the next flow the callouts move
     clear of them too (paper-labels.ts), as the canvas shows them */
  const paper = paperLayout(doc, floor, u, { ...layers, air: flow === "next" });
  const planLabels = paper.labels;
  const calloutAt = (o: DesignObject) => (flow === "next" ? (paper.callouts.get(o.id) ?? null) : calloutOf(o));

  const labelBacks = doc.settings.labelBacks === true;
  const backOf = (b: { x0: number; y0: number; x1: number; y1: number }) => (
    <rect className="ds-label-back" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={2 * u} />
  );

  /* markup prints unconditionally: a note is a written instruction, and the
     layer switches turn off DERIVED annotation (room names, run lengths), not
     what somebody chose to write on the drawing */
  const notes = onFloor.filter((o): o is NoteObject => isNote(o));
  const calloutFont = CALLOUT_FONT_REF * u;

  /* legend rows: fixed symbol key + the systems present on this floor */
  const floorSystems = doc.systems.filter((s) =>
    onFloor.some((o) => o.systemId === s.id)
  );

  const bar = scale ? barMetres(unitsToMeters(w, scale)) : null;
  const barLen = scale && bar ? (bar * 1000) / scale : 0;

  return (
    <svg
      className="ds-pf"
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{`
        .ds-pf { font-family: 'Plus Jakarta Sans', 'Jakarta', sans-serif; }
        .ds-pf .ds-room polygon { fill: rgba(240,164,49,0.13); stroke: #d98f1f; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-room-name { fill: #0d1220; font-weight: 800; text-anchor: middle; }
        .ds-pf .ds-room-area { fill: #6a7284; font-weight: 600; text-anchor: middle; }
        .ds-pf .ds-room-tab { fill: rgba(244,244,244,0.88); stroke: none; }
        .ds-pf .ds-room-wall { fill: none; stroke: #d98f1f; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-room-tab-edge { fill: none; stroke: #d98f1f; stroke-width: 1.4; stroke-dasharray: 4 3; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-room-name.in-tab { font-weight: 700; text-anchor: start; }
        .ds-pf .ds-room-area.in-tab { text-anchor: start; }
        .ds-pf .ds-pipe polyline, .ds-pf .ds-pipe path { fill: none; stroke: currentColor; stroke-width: 2.5px; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pfdrain polyline { fill: none; stroke: currentColor; stroke-width: 2px; stroke-dasharray: 8 5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pfcable path { fill: none; stroke: currentColor; stroke-width: 1.8px; stroke-dasharray: 2 5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-label-back { fill: #fff; stroke: #d5d9e2; stroke-width: 1px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pipe-len { fill: currentColor; text-anchor: middle; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
        .ds-pf .ds-unit rect { fill: #fff; stroke: currentColor; stroke-width: 1.6px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-unit-detail { fill: none; stroke: currentColor; stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-unit-hub { fill: currentColor; stroke: none; }
        .ds-pf .ds-pf-plenum polygon { fill: #fff; stroke: currentColor; stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
        /* A CALLOUT PRINTS, so its words are text on white paper and the note
           palette's 4.5:1 floor applies — which four of the six system colours
           fail (amber 2.0, teal 3.1, orange 3.7, violet 4.1). The identity
           rides the EDGE; the words stay graphite. */
        .ds-pf .ds-callout-leader { fill: none; stroke: currentColor; stroke-width: 1.1px; stroke-linecap: round; }
        .ds-pf .ds-callout-box { fill: #fff; stroke: currentColor; stroke-width: 1.2px; }
        .ds-pf .ds-callout-text { fill: #222222; font-weight: 600; }
        .ds-pf .ds-callout-text .head { font-weight: 800; }
        .ds-pf .ds-riser circle { fill: #fff; stroke: currentColor; stroke-width: 2px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-riser text { fill: currentColor; text-anchor: middle; font-weight: 800; }
        .ds-pf .ds-north-ring { fill: rgba(255,255,255,0.9); stroke: #64748b; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-north-arrow { fill: #dc2626; }
        .ds-pf .ds-north-south { fill: #94a3b8; }
        .ds-pf .ds-north-hub { fill: #334155; }
        .ds-pf .ds-north-n { fill: #334155; font-weight: 800; text-anchor: middle; }
        .ds-pf .ds-pf-bar line { stroke: #334155; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pf-bar text { fill: #334155; font-weight: 700; text-anchor: middle; }
        .ds-pf .ds-pf-legend rect.card { fill: rgba(255,255,255,0.96); stroke: #d7dbe4; stroke-width: 1; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pf-legend text { fill: #3c4356; font-weight: 700; }
        .ds-pf .ds-pf-legend .swatch-room { fill: rgba(240,164,49,0.35); stroke: #d98f1f; }
        .ds-pf .ds-note { color: #222222; }
        .ds-pf .ds-note-cloud { fill: none; stroke: currentColor; stroke-width: 1.7px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-note-leader { fill: none; stroke: currentColor; stroke-width: 1.3px; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-note-dot { fill: currentColor; stroke: none; }
        .ds-pf .ds-note-text { fill: currentColor; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 3.5px; stroke-linejoin: round; stroke-linecap: round; }
      `}</style>
      {grayscale && (
        <filter id={`${pid}-desat`}>
          <feColorMatrix type="saturate" values="0" />
        </filter>
      )}
      <g filter={grayscale ? `url(#${pid}-desat)` : undefined}>
        {/* everything under the notes, which a note can blur behind its words */}
        <g id={`${pid}-under`}>
        {/* plan sheets under everything — crop clips, never re-rasters */}
        {layers.plan &&
          floor.plans.map((s) => {
            const url = urls[s.imageRef];
            if (!url || !s.width || !s.height) return null;
            const clipId = `${pid}-clip-${s.id}`;
            return (
              <g key={s.id}>
                {s.crop && (
                  <clipPath id={clipId}>
                    {s.shape ? (
                      <polygon points={s.shape.map((c) => `${s.x + c.x},${s.y + c.y}`).join(" ")} />
                    ) : (
                      <rect
                        x={s.x + s.crop.x}
                        y={s.y + s.crop.y}
                        width={s.crop.w}
                        height={s.crop.h}
                      />
                    )}
                  </clipPath>
                )}
                <image
                  href={url}
                  x={s.x}
                  y={s.y}
                  width={s.width}
                  height={s.height}
                  preserveAspectRatio="none"
                  clipPath={s.crop ? `url(#${clipId})` : undefined}
                />
              </g>
            );
          })}

        {/* rooms — every room full-strength (paper has no active system) */}
        {rooms.map((r) => {
          const pts = r.geometry.points;
          const spot = planLabels?.rooms.get(r.id);
          const tab = spot?.tab;
          /* the room's own label scale, as on the canvas (plan-labels fitIn) */
          const lu = spot?.px ?? u;
          return (
            <g key={r.id} className="ds-room">
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
              {/* the label's tab on its wall (room-tab.ts), exactly as the
                  canvas draws it: its grey over the room's wash, the wall
                  again over the tab, then its dashed edge */}
              {tab && (
                <>
                  <path className="ds-room-tab" d={tabPath(tab, lu)} />
                  {/* a path, not a polygon: paper's rooms have no states to
                      take a stroke from, and a polygon is what counts a room */}
                  <path className="ds-room-wall" d={`M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`} />
                  <path className="ds-room-tab-edge" d={tabPath(tab, lu, true)} />
                </>
              )}
              {spot && labelBacks && !tab && backOf(spot.box)}
              {spot && (
                <>
                  <text x={spot.x} y={spot.y} fontSize={13 * lu} className={`ds-room-name${tab ? " in-tab" : ""}`}>
                    {String(r.props.name ?? "Room")}
                  </text>
                  {!spot.nameOnly && (
                    <text
                      x={spot.x}
                      y={spot.y + 16 * lu}
                      fontSize={11 * lu}
                      className={`ds-room-area${tab ? " in-tab" : ""}`}
                    >
                      {scale
                        ? formatArea(areaUnitsToM2(polygonArea(pts), scale))
                        : "not calibrated"}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* drawn runs (pipe/drain/cable) — system colour, length when
            calibrated. Prints what the canvas shows: curved runs as the
            smoothed spline, drains dashed with their size, cables dash-dot
            with their kind. */}
        {layers.pipes &&
          runs.map((r) => {
            const pts = r.geometry.points;
            const curved = isCurvedRun(r);
            const legs = straightLegsOf(r.props);
            const cls =
              r.type === "drain-run"
                ? "ds-pfdrain"
                : r.type === "cable-run"
                  ? "ds-pfcable"
                  : r.type === "duct-run"
                    ? "ds-pfduct"
                    : "ds-pipe";
            const label = runText(r);
            const spot = planLabels?.runs.get(r.id);
            return (
              <g key={r.id} className={cls} style={{ color: colourOf(r) }}>
                {r.type === "duct-run" ? (
                  /* a duct at its true width, as the canvas draws it */
                  (() => {
                    const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
                    if (r.props.form) {
                      return (
                        <PaintedDuct
                          d={curved ? (onFitting.get(r.id) ? linePathD(onFitting.get(r.id)!) : smoothPathD(pts, legs)) : undefined}
                          points={curved ? undefined : onFitting.get(r.id) ? onFitting.get(r.id)!.map((p) => `${p.x},${p.y}`).join(" ") : line}
                          diaMm={Number(r.props.diaMm) || 250}
                          mmPerUnit={scale ?? 10}
                          pen={u}
                        />
                      );
                    }
                    const width = Math.max((Number(r.props.diaMm) || 250) / (scale ?? 10), 4 * u);
                    const ink = AIRFLOW_INKS[r.props.stream === "return" ? "return" : "supply"];
                    const core = Math.max(width - 3 * u, u);
                    /* a flex one along its curve */
                    return curved ? (
                      <g fill="none">
                        <path d={smoothPathD(pts, legs)} stroke={ink} strokeWidth={width} />
                        <path d={smoothPathD(pts, legs)} stroke="#fff" strokeWidth={core} />
                      </g>
                    ) : (
                      <g fill="none">
                        <polyline points={line} stroke={ink} strokeWidth={width} />
                        <polyline points={line} stroke="#fff" strokeWidth={core} />
                      </g>
                    );
                  })()
                ) : curved ? (
                  <path d={smoothPathD(pts, legs)} />
                ) : (
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                )}
                {label && spot?.leader && (
                  <line
                    stroke="currentColor"
                    x1={spot.leader[0].x}
                    y1={spot.leader[0].y}
                    x2={spot.leader[1].x}
                    y2={spot.leader[1].y}
                    strokeWidth={u}
                  />
                )}
                {label && spot && labelBacks && backOf(spot.box)}
                {label && spot && (
                  <text
                    x={spot.x}
                    y={spot.y}
                    fontSize={runLabelStyle(r, scale).size * u}
                    className="ds-pipe-len"
                    style={{ textAnchor: spot.anchor, ...(r.props.form ? DUCT_LABEL_STYLE : null) }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

        {/* where ducts meet, as the canvas draws it */}
        {layers.pipes && ductFreeEnds(runs).map((j) => <FreeDuctEnd key={fittingKey(j)} j={j} mmPerUnit={scale ?? 10} pen={u} />)}
        {layers.pipes &&
          ductJunctions(runs).map((j) => {
            const spot = planLabels?.runs.get(fittingKey(j));
            return (
              <g key={fittingKey(j)}>
                {spot?.leader && (
                  <line stroke={DUCT_LABEL_STYLE.fill} x1={spot.leader[0].x} y1={spot.leader[0].y} x2={spot.leader[1].x} y2={spot.leader[1].y} strokeWidth={u} />
                )}
                <PaintedFitting j={j} mmPerUnit={scale ?? 10} pen={u} />
                {spot && labelBacks && backOf(spot.box)}
                {spot && (
                  <text x={spot.x} y={spot.y} fontSize={8 * u} className="ds-pipe-len" style={{ textAnchor: spot.anchor, ...DUCT_LABEL_STYLE }}>
                    {fittingName(j)}
                  </text>
                )}
              </g>
            );
          })}

        {/* units — to-scale footprint via the canvas's own glyph */}
        {layers.units &&
          units.map((o) => {
            const at = o.geometry.at;
            const widthMm = Number(o.props.widthMm ?? 800);
            const fp = unitFp(o);
            const role = String(o.props.role ?? "idu");
            /* a turned unit prints turned — same rule as the canvas */
            const rot = (o.geometry as { rotation?: number }).rotation ?? 0;
            /* THE UNIT IS ITS GLYPH, AS IT IS ON THE CANVAS. Paper used to stamp
               "IDU"/"ODU" inside every footprint and the model under it,
               because paper cannot be hovered. On a whole-site sheet the
               footprints are small and the words piled onto each other, the
               run lengths and the notes — Isaac, 2026-09-28: it "shows up
               differently to what's on the actual design page". What names a
               unit on paper is what names it on the canvas: its callout,
               where somebody placed it, and the rooms table under the plan. */
            return (
              <g key={o.id} className={`ds-unit${o.plane === "floor-cavity" ? " under" : ""}`} style={{ color: colourOf(o) }}>
                <g transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined}>
                  {(() => {
                    const mark = markOf?.(String(o.props.model ?? ""));
                    return unitGlyph(at.x, at.y, fp.w, fp.h, role, 1 / u, mark?.form_factor, {
                      supply: mark?.supply_opening,
                      ret: mark?.return_opening,
                      perMm: fp.w / Math.max(widthMm, 1),
                      supplyDir: o.props.airFlip ? -1 : 1,
                    });
                  })()}
                </g>
              </g>
            );
          })}

        {/* the plenums the ducts on a unit made, as on the canvas (unit-plenum.ts) */}
        {layers.units &&
          scale != null &&
          units.flatMap((o) => {
            const mark = markOf?.(String(o.props.model ?? ""));
            const widthMm = Number(o.props.widthMm ?? 800);
            const fp = unitFp(o);
            return plenumsFromDucts(doc.objects, o, mark, scale).map((p) => {
              const end = p.props.end === "return" ? ("return" as const) : ("supply" as const);
              const figure = plenumFigure({
                props: p.props,
                widthMm,
                perMm: fp.w / Math.max(widthMm, 1),
                opening: openingFor(mark, end),
                face: faceFrame(o.geometry.at, (o.geometry as { rotation?: number }).rotation ?? 0, fp.h, o.props.airFlip === true, end),
              });
              if (!figure) return null;
              return (
                <g key={p.id} className="ds-pf-plenum" style={{ color: plenumInkOf(p.props) ?? colourOf(o) }}>
                  <polygon points={figure.body.map((pt) => `${pt.x},${pt.y}`).join(" ")} />
                  {figure.spigots.map((sp) => (
                    <polygon key={sp.id} points={sp.rect.map((pt) => `${pt.x},${pt.y}`).join(" ")} />
                  ))}
                </g>
              );
            });
          })}

        {/* risers — disc + group letter */}
        {layers.pipes &&
          risers.map((r) => {
            const at = r.geometry.at;
            if (flow === "next")
              return <RiserDisc key={r.id} at={at} mark={riserMark(doc.objects, r)} mmPerUnit={scale ?? 10} pen={u} />;
            return (
              <g key={r.id} className="ds-riser" style={{ color: colourOf(r) }}>
                <circle cx={at.x} cy={at.y} r={10 * u} />
                <text x={at.x} y={at.y + 3.5 * u} fontSize={10 * u}>
                  ⇅{String(r.props.group ?? "A")}
                </text>
              </g>
            );
          })}

        {/* north arrow — the placed compass, plain form */}
        {floor.northPos &&
          (() => {
            const R = northRadius(floor);
            const { x: cx, y: cy } = floor.northPos;
            return (
              <g
                className="ds-north"
                transform={`rotate(${floor.northDeg ?? 0} ${cx} ${cy})`}
              >
                <circle className="ds-north-ring" cx={cx} cy={cy} r={R} />
                <polygon
                  className="ds-north-arrow"
                  points={`${cx},${cy - R * 0.72} ${cx - R * 0.22},${cy} ${cx + R * 0.22},${cy}`}
                />
                <polygon
                  className="ds-north-south"
                  points={`${cx},${cy + R * 0.72} ${cx - R * 0.22},${cy} ${cx + R * 0.22},${cy}`}
                />
                <circle className="ds-north-hub" cx={cx} cy={cy} r={R * 0.08} />
                <text
                  className="ds-north-n"
                  x={cx}
                  y={cy - R - R * 0.18}
                  fontSize={R * 0.4}
                >
                  N
                </text>
              </g>
            );
          })()}

        {/* unit callouts — through the SAME two functions the canvas uses
            (`calloutContent` for the words, `calloutLayout` for the shape), so
            a label placed on screen prints exactly where it was put. That one
            door is the whole reason the geometry lives in lib and not here. */}
        {layers.units &&
          units.map((o) => {
            const off = calloutAt(o);
            if (!off) return null;
            const at = o.geometry.at;
            const fp = unitFp(o);
            const room = o.props.roomId
              ? ((rooms.find((r) => r.id === String(o.props.roomId))?.props.name as
                  | string
                  | undefined) ?? null)
              : null;
            const lay = calloutLayout({
              at,
              footprint: fp,
              offset: off,
              content: calloutContent(o, room),
              fontSize: calloutFont,
            });
            return (
              <g key={`co-${o.id}`} className="ds-callout" style={{ color: colourOf(o) }}>
                <line
                  className="ds-callout-leader"
                  x1={lay.start.x}
                  y1={lay.start.y}
                  x2={lay.end.x}
                  y2={lay.end.y}
                />
                <rect
                  className="ds-callout-box"
                  x={lay.box.x}
                  y={lay.box.y}
                  width={lay.box.w}
                  height={lay.box.h}
                  rx={lay.fontSize * 0.4}
                />
                <text
                  className="ds-callout-text"
                  x={lay.textX}
                  y={lay.firstBaseline}
                  fontSize={lay.fontSize}
                  textAnchor={lay.anchor}
                >
                  {lay.lines.map((line, i) => (
                    <tspan
                      key={i}
                      x={lay.textX}
                      dy={i === 0 ? 0 : lay.lineH}
                      className={i === 0 ? "head" : undefined}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

        {/* airflow marks, through the same geometry the canvas draws them by */}
        {onFloor.filter(isAirflowMark).map((o) => {
          const stream = streamOf(o);
          return (
            <g key={o.id} className="ds-pf-airflow">
              {markShapes(o.geometry.at, o.geometry.rotation ?? 0, stream, scale ?? 10).map((sh, i) => (
                <g key={i}>
                  <path d={sh.line} fill="none" stroke={AIRFLOW_INKS[stream]} strokeWidth={1.8 * u} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={sh.head} fill={AIRFLOW_INKS[stream]} />
                </g>
              ))}
            </g>
          );
        })}

        {/* grilles the person placed, through the canvas's geometry */}
        {onFloor.filter(isGrille).map((o) => {
          const stream = grilleStream(o);
          const split = grilleSplit(o);
          const supplyInk = supplyInkOf(doc.objects, o.id) ?? AIRFLOW_INKS.supply;
          if (split) {
            const c = splitShape(o.geometry.at, o.geometry.rotation ?? 0, grilleSize(o), split.supplyMm, scale ?? 10);
            return (
              <g key={o.id} className="ds-pf-grille">
                <polygon points={c.outline.map((p) => `${p.x},${p.y}`).join(" ")} fill="#fff" stroke="#050505" strokeWidth={1.6 * u} />
                {c.supply.map(([a, b], i) => (
                  <line key={`s${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={supplyInk} strokeWidth={u} />
                ))}
                {c.ret.map(([a, b], i) => (
                  <line key={`r${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={AIRFLOW_INKS.return} strokeWidth={u} />
                ))}
                <line x1={c.divider[0].x} y1={c.divider[0].y} x2={c.divider[1].x} y2={c.divider[1].y} stroke="#050505" strokeWidth={1.6 * u} />
              </g>
            );
          }
          const sh = grilleShape(o.geometry.at, o.geometry.rotation ?? 0, stream, grilleSize(o), scale ?? 10, grilleStyle(o));
          return (
            <g key={o.id} className="ds-pf-grille" stroke={stream === "supply" ? supplyInk : AIRFLOW_INKS[stream]}>
              <polygon points={sh.outline.map((p) => `${p.x},${p.y}`).join(" ")} fill="#fff" strokeWidth={1.6 * u} />
              {sh.lines.map(([a, b], i) => (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={u} />
              ))}
            </g>
          );
        })}

        {/* zone sensors and wall controllers, where they were put */}
        {layers.units &&
          onFloor.filter(isDevice).map((o) => {
            const at = o.geometry.at;
            const half = deviceHalf(o.type, scale, 5 * u);
            return (
              <g key={o.id} className="ds-pf-device" style={{ color: colourOf(o) }}>
                <rect
                  x={at.x - half}
                  y={at.y - half}
                  width={half * 2}
                  height={half * 2}
                  rx={o.type === "zone-sensor" ? half : half * 0.3}
                  fill="#fff"
                  stroke="currentColor"
                  strokeWidth={1.2 * u}
                />
                <text x={at.x} y={at.y + half * 0.42} fontSize={half * 1.2} fill="currentColor" fontWeight={700} textAnchor="middle">
                  {deviceLetter(o.type)}
                </text>
              </g>
            );
          })}

        </g>

        {notes.map((n) => {
          const blur = noteBlurOf(n);
          if (blur <= 0) return null;
          const lay = noteLayoutOf(n);
          return <NoteBackdrop key={n.id} id={`${pid}-blur-${n.id}`} under={`${pid}-under`} box={lay.box} fontSize={lay.fontSize} blur={blur} />;
        })}

        {/* markup — drawn last, over the work it is about */}
        {notes.map((n) => {
          const rect = noteRect(n);
          const leader = noteLeader(n);
          /* through the SAME door the canvas uses, at the world size the note
             was written at — so it prints exactly where and as big as it sat
             on the plan, with its own measure and scale on top */
          const lay = noteLayoutOf(n);
          const start = leaderStart(rect, leader);
          return (
            <g key={n.id} className="ds-note" style={{ color: noteInkOf(n) }}>
              <path className="ds-note-cloud" d={cloudPath(rect)} />
              <polyline
                className="ds-note-leader"
                points={`${start.x},${start.y} ${lay.elbow.x},${lay.elbow.y} ${lay.shoulder.x},${lay.shoulder.y}`}
              />
              <circle className="ds-note-dot" cx={start.x} cy={start.y} r={2.6 * u} />
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
            </g>
          );
        })}
      </g>

      {/* scale bar — bottom-right, outside the desat group (chrome, not plan) */}
      {bar && (
        <g className="ds-pf-bar">
          <line
            x1={x + w - barLen - 24 * u}
            y1={y + h - 20 * u}
            x2={x + w - 24 * u}
            y2={y + h - 20 * u}
          />
          <line
            x1={x + w - barLen - 24 * u}
            y1={y + h - 25 * u}
            x2={x + w - barLen - 24 * u}
            y2={y + h - 15 * u}
          />
          <line
            x1={x + w - 24 * u}
            y1={y + h - 25 * u}
            x2={x + w - 24 * u}
            y2={y + h - 15 * u}
          />
          <text
            x={x + w - barLen / 2 - 24 * u}
            y={y + h - 28 * u}
            fontSize={11 * u}
          >
            {bar} m
          </text>
        </g>
      )}

      {/* legend card — bottom-left; symbol key + this floor's systems */}
      {legend &&
        (() => {
          const rows = 3 + floorSystems.length;
          const rowH = 17 * u;
          const padd = 10 * u;
          const cardW = 150 * u;
          const cardH = padd * 2 + rows * rowH;
          const lx = x + 16 * u;
          const ly = y + h - cardH - 16 * u;
          const sw = 9 * u; // swatch size
          const item = (
            i: number,
            swatch: React.ReactNode,
            label: string
          ) => (
            <g key={i}>
              {swatch}
              <text
                x={lx + padd + sw * 2 + 6 * u}
                y={ly + padd + i * rowH + sw + 1 * u}
                fontSize={10 * u}
              >
                {label}
              </text>
            </g>
          );
          const cy0 = (i: number) => ly + padd + i * rowH + sw / 2;
          return (
            /* the legend desaturates WITH the plan — coloured swatches keying
               a grey drawing would key nothing */
            <g
              className="ds-pf-legend"
              filter={grayscale ? `url(#${pid}-desat)` : undefined}
            >
              <rect
                className="card"
                x={lx}
                y={ly}
                width={cardW}
                height={cardH}
                rx={6 * u}
              />
              {item(
                0,
                <rect
                  className="swatch-room"
                  x={lx + padd}
                  y={cy0(0) - sw / 2}
                  width={sw * 2}
                  height={sw}
                />,
                "Room"
              )}
              {item(
                1,
                <rect
                  x={lx + padd}
                  y={cy0(1) - sw / 2}
                  width={sw * 2}
                  height={sw}
                  fill="#fff"
                  stroke="#3c4356"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />,
                "Indoor / outdoor unit"
              )}
              {item(
                2,
                <circle
                  cx={lx + padd + sw}
                  cy={cy0(2)}
                  r={sw / 2}
                  fill={flow === "next" ? RISER_PAINT.body : "#fff"}
                  stroke={flow === "next" ? RISER_PAINT.body : "#3c4356"}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />,
                flow === "next" ? "Riser: DR duct, PR pipe" : "Riser"
              )}
              {floorSystems.map((s, i) =>
                item(
                  3 + i,
                  <circle
                    cx={lx + padd + sw}
                    cy={cy0(3 + i)}
                    r={sw / 2}
                    fill={s.colour}
                  />,
                  s.name
                )
              )}
            </g>
          );
        })()}
    </svg>
  );
}
