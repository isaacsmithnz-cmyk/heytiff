"use client";

import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import {
  areaUnitsToM2,
  formatArea,
  formatMeters,
  polygonArea,
  polygonCentroid,
  polylineLength,
  smoothedLength,
  smoothPathD,
  unitsToMeters,
} from "@/lib/studio/geometry";
import {
  cloudPath,
  isNote,
  leaderStart,
  noteBounds,
  noteInkOf,
  noteLeader,
  noteRect,
  noteText,
  noteTextLayout,
  type NoteObject,
} from "@/lib/studio/notes";
import { unitGlyph, type LayerFlags } from "../canvas";

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

const REF_W = 900; // reference width: text sized as if on a 900px-wide sheet
/** The markup text's size at reference width — the print twin of NOTE_FONT_PX.

    Matches the ROOM NAME (13), not the room's area line (11), and that is the
    point: a note is a written instruction to whoever builds the job, so it has
    no business being quieter on paper than a derived measurement. It printed
    at 11 until a real sheet showed it losing to the labels around it
    (2026-08-26). The canvas always used 13; this is paper catching up. */
const NOTE_FONT_REF = 13;

export function planFigureBounds(
  doc: DesignDocument,
  floor: Floor
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const s of floor.plans) {
    if (!s.width || !s.height) continue; // legacy sheet without stored dims
    if (s.crop) {
      eat(s.x + s.crop.x, s.y + s.crop.y);
      eat(s.x + s.crop.x + s.crop.w, s.y + s.crop.y + s.crop.h);
    } else {
      eat(s.x, s.y);
      eat(s.x + s.width, s.y + s.height);
    }
  }
  const scale = floor.scaleMmPerUnit;
  for (const o of doc.objects) {
    if (o.floorId !== floor.id) continue;
    if (o.geometry.kind === "polygon" || o.geometry.kind === "polyline")
      for (const p of o.geometry.points) eat(p.x, p.y);
    if (o.geometry.kind === "point") {
      const at = o.geometry.at;
      const w = scale ? Number(o.props.widthMm ?? 800) / scale : 40;
      const h = scale ? Number(o.props.depthMm ?? 300) / scale : 20;
      eat(at.x - w, at.y - h);
      eat(at.x + w, at.y + h);
    }
  }
  if (floor.northPos) {
    const r = northRadius(floor) * 1.8;
    eat(floor.northPos.x - r, floor.northPos.y - r);
    eat(floor.northPos.x + r, floor.northPos.y + r);
  }
  if (!Number.isFinite(minX)) return null;

  /* Notes are measured in a SECOND pass, because their words are sized to the
     sheet: the font is a fraction of the figure's own width, so the width has
     to exist before the text that widens it can be measured. One extra pass
     settles it — the text grows by well under the 5% pad the figure already
     carries, so a third would move nothing. (Pass one has already eaten the
     cloud itself; its points are ordinary polygon geometry.) */
  const notes = doc.objects.filter(
    (o): o is NoteObject => o.floorId === floor.id && isNote(o)
  );
  if (notes.length > 0) {
    const font = (NOTE_FONT_REF * Math.max(maxX - minX, 1)) / REF_W;
    for (const n of notes) {
      const b = noteBounds(n, font);
      eat(b.x, b.y);
      eat(b.x + b.w, b.y + b.h);
    }
  }

  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const pad = Math.max(w, h) * 0.05;
  return { x: minX - pad, y: minY - pad, w: w + pad * 2, h: h + pad * 2 };
}

/** same formula as the canvas: the arrow holds the size it was placed at */
const northRadius = (floor: Floor): number => {
  const grid = floor.scaleMmPerUnit
    ? 1000 / floor.scaleMmPerUnit
    : floor.plans.length > 0
      ? 100
      : 50;
  return grid * 0.7;
};

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
}: {
  doc: DesignDocument;
  floor: Floor;
  layers: LayerFlags;
  grayscale: boolean;
  legend: boolean;
  /** sheet imageRef → resolvable URL (signed for print, data: for PNG) */
  urls: Record<string, string>;
}) {
  const bounds = planFigureBounds(doc, floor);
  if (!bounds) return null;
  const { x, y, w, h } = bounds;
  const u = w / REF_W; // "screen pixel" at reference width
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
      (o.type === "pipe-run" || o.type === "drain-run" || o.type === "cable-run") &&
      o.geometry.kind === "polyline"
  );
  const units = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
      o.type === "unit" && o.geometry.kind === "point"
  );
  const risers = onFloor.filter(
    (o): o is DesignObject & { geometry: { kind: "point"; at: Point } } =>
      o.type === "riser" && o.geometry.kind === "point"
  );
  /* markup prints unconditionally: a note is a written instruction, and the
     layer switches turn off DERIVED annotation (room names, run lengths), not
     what somebody chose to write on the drawing */
  const notes = onFloor.filter((o): o is NoteObject => isNote(o));
  const noteFont = NOTE_FONT_REF * u;

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
        .ds-pf .ds-pipe polyline, .ds-pf .ds-pipe path { fill: none; stroke: currentColor; stroke-width: 2.5px; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pfdrain polyline { fill: none; stroke: currentColor; stroke-width: 2px; stroke-dasharray: 8 5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pfcable path { fill: none; stroke: currentColor; stroke-width: 1.8px; stroke-dasharray: 2 5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-pipe-len { fill: currentColor; text-anchor: middle; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
        .ds-pf .ds-unit rect { fill: #fff; stroke: currentColor; stroke-width: 1.6px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-unit-detail { fill: none; stroke: currentColor; stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
        .ds-pf .ds-unit-hub { fill: currentColor; stroke: none; }
        .ds-pf .ds-unit-role { fill: currentColor; text-anchor: middle; font-weight: 800; }
        .ds-pf .ds-unit-model { fill: #3c4356; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 3px; font-weight: 700; }
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
                    <rect
                      x={s.x + s.crop.x}
                      y={s.y + s.crop.y}
                      width={s.crop.w}
                      height={s.crop.h}
                    />
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
          const c = polygonCentroid(pts);
          return (
            <g key={r.id} className="ds-room">
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
              {layers.labels && (
                <>
                  <text x={c.x} y={c.y} fontSize={13 * u} className="ds-room-name">
                    {String(r.props.name ?? "Room")}
                  </text>
                  <text
                    x={c.x}
                    y={c.y + 16 * u}
                    fontSize={11 * u}
                    className="ds-room-area"
                  >
                    {scale
                      ? formatArea(areaUnitsToM2(polygonArea(pts), scale))
                      : "not calibrated"}
                  </text>
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
            const midI = Math.floor((pts.length - 1) / 2);
            const mid = {
              x: (pts[midI].x + pts[Math.min(midI + 1, pts.length - 1)].x) / 2,
              y: (pts[midI].y + pts[Math.min(midI + 1, pts.length - 1)].y) / 2,
            };
            const curved =
              r.type === "cable-run" || (r.type === "pipe-run" && r.props.form === "soft");
            const cls =
              r.type === "drain-run" ? "ds-pfdrain" : r.type === "cable-run" ? "ds-pfcable" : "ds-pipe";
            const len = scale
              ? formatMeters(
                  unitsToMeters(curved ? smoothedLength(pts) : polylineLength(pts), scale)
                )
              : null;
            const tag =
              r.type === "drain-run"
                ? `Ø${Number(r.props.sizeMm) || 25} drain`
                : r.type === "cable-run"
                  ? r.props.kind === "data"
                    ? "Data"
                    : "Power"
                  : null;
            const label = [len, tag].filter(Boolean).join(" · ");
            return (
              <g key={r.id} className={cls} style={{ color: colourOf(r) }}>
                {curved ? (
                  <path d={smoothPathD(pts)} />
                ) : (
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                )}
                {label && layers.labels && (
                  <text
                    x={mid.x}
                    y={mid.y - 7 * u}
                    fontSize={11 * u}
                    className="ds-pipe-len"
                  >
                    {label}
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
            const depthMm = Number(o.props.depthMm ?? 300);
            const fp = scale
              ? { w: widthMm / scale, h: depthMm / scale }
              : { w: 45 * u, h: 45 * u * (depthMm / Math.max(widthMm, 1)) };
            const role = String(o.props.role ?? "idu");
            /* a turned unit prints turned — same rule as the canvas: the glyph
               rotates, the labels under it stay upright and readable */
            const rot = (o.geometry as { rotation?: number }).rotation ?? 0;
            return (
              <g key={o.id} className="ds-unit" style={{ color: colourOf(o) }}>
                <g transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined}>
                  {unitGlyph(at.x, at.y, fp.w, fp.h, role, 1 / u)}
                </g>
                {layers.labels && (
                  <>
                    <text
                      x={at.x}
                      y={at.y + 4 * u}
                      fontSize={11 * u}
                      className="ds-unit-role"
                    >
                      {role.toUpperCase()}
                    </text>
                    <text
                      x={at.x}
                      y={at.y + fp.h / 2 + 13 * u}
                      fontSize={10 * u}
                      className="ds-unit-model"
                    >
                      {String(o.props.model ?? "")}
                    </text>
                  </>
                )}
              </g>
            );
          })}

        {/* risers — disc + group letter */}
        {layers.pipes &&
          risers.map((r) => {
            const at = r.geometry.at;
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

        {/* markup — drawn last, over the work it is about */}
        {notes.map((n) => {
          const rect = noteRect(n);
          const leader = noteLeader(n);
          const lay = noteTextLayout(rect, leader, noteText(n), noteFont);
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
                fontSize={noteFont}
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
                  fill="#fff"
                  stroke="#3c4356"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />,
                "Riser"
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
