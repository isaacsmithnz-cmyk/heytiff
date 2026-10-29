"use client";

/* The grilles on the plan (grilles.ts): every grille the person placed on
   this floor. With Select, a click picks one (Delete removes it, as anything
   picked) and a drag moves it. A picked grille wears the unit's rotate ring
   (drag anywhere on it to turn, Shift for 15° steps; [ and ] turn 90°) and a
   handle in the middle of each edge that pulls that edge out or in, the far
   edge staying put. While the Grille component is armed, the one about to
   land follows the pointer. */

import { useState } from "react";
import type { DesignDocument, Floor, Point } from "@/lib/studio/document";
import { AIRFLOW_INKS, type AirStream } from "@/lib/studio/airflow-marks";
import {
  grilleEdges,
  grilleShape,
  grilleSize,
  grilleStream,
  isGrille,
  resizeGrille,
  type Grille,
  type GrilleEdge,
  type GrilleSize,
} from "@/lib/studio/grilles";

/** a press that moves less than this on screen is a click, px */
const CLICK_PX = 4;
/** the scale a plan without one is drawn at, mm a unit */
const UNSCALED_MM = 10;
/** an edge handle shows only when its edge is at least this long on screen,
    px: a 100 mm linear grille zoomed out has no room for a handle across it */
const HANDLE_ROOM_PX = 18;

type Drag =
  | { kind: "move"; id: string; from: Point; screen: Point; to: Point; moved: boolean }
  | { kind: "turn"; id: string; offset: number; deg: number }
  | { kind: "size"; id: string; edge: GrilleEdge; at: Point; size: GrilleSize };

/** the pointer's bearing from `c`, degrees clockwise from up the plan */
const bearing = (c: Point, p: Point) => ((Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI + 360) % 360;

export function GrilleLayer({
  doc,
  floor,
  zoom,
  interactive,
  selectedId,
  ghost,
  toWorld,
  onSelect,
  onMutate,
}: {
  doc: DesignDocument;
  floor: Floor;
  zoom: number;
  /** Select is armed and nothing is simulating */
  interactive: boolean;
  selectedId: string | null;
  /** the grille the armed component would put down, under the pointer */
  ghost: { at: Point; deg: number; stream: AirStream; size: GrilleSize } | null;
  toWorld: (e: { clientX: number; clientY: number }) => Point;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const mm = floor.scaleMmPerUnit ?? UNSCALED_MM;
  const grilles = doc.objects.filter((o): o is Grille => o.floorId === floor.id && isGrille(o));
  if (!grilles.length && !ghost) return null;

  const face = (key: string, at: Point, deg: number, stream: AirStream, size: GrilleSize, cls: string) => {
    const s = grilleShape(at, deg, stream, size, mm);
    const ink = AIRFLOW_INKS[stream];
    return (
      <g key={key} className={cls} aria-hidden="true">
        <polygon
          points={s.outline.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="#fff"
          stroke={ink}
          strokeWidth={1.6 / zoom}
        />
        {s.lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ink} strokeWidth={1 / zoom} />
        ))}
      </g>
    );
  };

  const capture = (e: React.PointerEvent<Element>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
  };
  const commit = (id: string, at: Point, deg: number, size: GrilleSize) =>
    onMutate((doc) => ({
      ...doc,
      objects: doc.objects.map((x) =>
        x.id === id && x.geometry.kind === "point"
          ? {
              ...x,
              geometry: { ...x.geometry, at, rotation: deg },
              props: { ...x.props, wMm: size.wMm, hMm: size.hMm },
            }
          : x
      ),
    }));

  return (
    <g className="ds-grilles" aria-label="Grilles">
      {grilles.map((o) => {
        const live = drag?.id === o.id ? drag : null;
        const stream = grilleStream(o);
        let at = o.geometry.at;
        let deg = o.geometry.rotation ?? 0;
        let size = grilleSize(o);
        if (live?.kind === "move" && live.moved) at = { x: at.x + live.to.x - live.from.x, y: at.y + live.to.y - live.from.y };
        if (live?.kind === "turn") deg = live.deg;
        if (live?.kind === "size") ({ at, size } = live);
        const picked = selectedId === o.id && interactive;
        const ink = AIRFLOW_INKS[stream];
        // the ring: 8px clear of the face's corners at any zoom, its grip at the grille's own "up"
        const ringR = Math.hypot(size.wMm / 2, size.hMm / 2) / mm + 8 / zoom;
        const rad = (deg * Math.PI) / 180;
        const grip = { x: at.x + Math.sin(rad) * ringR, y: at.y - Math.cos(rad) * ringR };
        const edges = grilleEdges(at, deg, size, mm);
        const room = (e: GrilleEdge) =>
          ((e === "e" || e === "w" ? size.hMm : size.wMm) / mm) * zoom >= HANDLE_ROOM_PX;
        return (
          <g
            key={o.id}
            className={`ds-grille${interactive ? " grab" : ""}${selectedId === o.id ? " picked" : ""}`}
            role="img"
            aria-label={stream === "supply" ? "Supply grille" : "Return grille"}
          >
            {picked && (
              <g className="ds-grille-turn" style={{ color: ink }}>
                <circle cx={at.x} cy={at.y} r={ringR} className="ds-grille-ring" strokeWidth={1.2 / zoom} strokeDasharray={`${2 / zoom} ${3 / zoom}`} />
                <circle cx={grip.x} cy={grip.y} r={5 / zoom} className="ds-grille-grip" strokeWidth={2 / zoom} />
                {/* the band you catch it by: 8px either side of the ring */}
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={ringR}
                  className="ds-grille-ring-hit"
                  strokeWidth={16 / zoom}
                  data-testid="grille-ring"
                  onPointerDown={(e) => {
                    capture(e);
                    setDrag({ kind: "turn", id: o.id, offset: bearing(at, toWorld(e)) - deg, deg });
                  }}
                  onPointerMove={(e) => {
                    if (live?.kind !== "turn") return;
                    e.stopPropagation();
                    let next = (((bearing(at, toWorld(e)) - live.offset) % 360) + 360) % 360;
                    if (e.shiftKey) next = (Math.round(next / 15) * 15) % 360;
                    setDrag({ ...live, deg: next });
                  }}
                  onPointerUp={(e) => {
                    if (live?.kind !== "turn") return;
                    e.stopPropagation();
                    setDrag(null);
                    commit(o.id, o.geometry.at, Math.round(live.deg * 10) / 10, grilleSize(o));
                  }}
                  onPointerCancel={() => setDrag(null)}
                />
              </g>
            )}
            <g
              onPointerDown={(e) => {
                if (!interactive) return;
                capture(e);
                const w = toWorld(e);
                setDrag({ kind: "move", id: o.id, from: w, to: w, screen: { x: e.clientX, y: e.clientY }, moved: false });
              }}
              onPointerMove={(e) => {
                if (live?.kind !== "move") return;
                e.stopPropagation();
                const moved = live.moved || Math.hypot(e.clientX - live.screen.x, e.clientY - live.screen.y) >= CLICK_PX;
                setDrag({ ...live, to: toWorld(e), moved });
              }}
              onPointerUp={(e) => {
                if (live?.kind !== "move") return;
                e.stopPropagation();
                setDrag(null);
                onSelect(o.id);
                if (!live.moved) return;
                commit(o.id, { x: o.geometry.at.x + live.to.x - live.from.x, y: o.geometry.at.y + live.to.y - live.from.y }, deg, size);
              }}
              onPointerCancel={() => setDrag(null)}
            >
              {face(o.id, at, deg, stream, size, "")}
            </g>
            {picked &&
              (["n", "e", "s", "w"] as const).filter(room).map((edge) => {
                const p = edges[edge];
                const r = 4 / zoom;
                return (
                  <rect
                    key={edge}
                    className={`ds-grille-handle ${edge === "e" || edge === "w" ? "ew" : "ns"}`}
                    data-testid={`grille-edge-${edge}`}
                    x={p.x - r}
                    y={p.y - r}
                    width={r * 2}
                    height={r * 2}
                    rx={1.5 / zoom}
                    stroke={ink}
                    strokeWidth={1.5 / zoom}
                    transform={deg ? `rotate(${deg} ${p.x} ${p.y})` : undefined}
                    onPointerDown={(e) => {
                      capture(e);
                      setDrag({ kind: "size", id: o.id, edge, at: o.geometry.at, size: grilleSize(o) });
                    }}
                    onPointerMove={(e) => {
                      if (live?.kind !== "size" || live.edge !== edge) return;
                      e.stopPropagation();
                      setDrag({ ...live, ...resizeGrille(o.geometry.at, deg, grilleSize(o), edge, toWorld(e), mm) });
                    }}
                    onPointerUp={(e) => {
                      if (live?.kind !== "size") return;
                      e.stopPropagation();
                      setDrag(null);
                      commit(o.id, live.at, deg, live.size);
                    }}
                    onPointerCancel={() => setDrag(null)}
                  />
                );
              })}
          </g>
        );
      })}
      {ghost && face("ghost", ghost.at, ghost.deg, ghost.stream, ghost.size, "ds-grille-ghost")}
    </g>
  );
}
