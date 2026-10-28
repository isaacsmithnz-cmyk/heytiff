"use client";

/* The grilles on the plan (grilles.ts): every grille the person placed on
   this floor. With Select, a click picks one (Delete removes it, as anything
   picked) and a drag moves it; while the Grille component is armed, the one
   about to land follows the pointer. */

import { useState } from "react";
import type { DesignDocument, Floor, Point } from "@/lib/studio/document";
import { AIRFLOW_INKS, type AirStream } from "@/lib/studio/airflow-marks";
import { grilleShape, grilleSize, grilleStream, isGrille, type Grille, type GrilleSize } from "@/lib/studio/grilles";

/** a press that moves less than this on screen is a click, px */
const CLICK_PX = 4;
/** the scale a plan without one is drawn at, mm a unit */
const UNSCALED_MM = 10;

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
  const [drag, setDrag] = useState<{ id: string; from: Point; screen: Point; to: Point; moved: boolean } | null>(null);
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

  return (
    <g className="ds-grilles" aria-label="Grilles">
      {grilles.map((o) => {
        const moving = drag?.id === o.id && drag.moved;
        const at = moving ? { x: o.geometry.at.x + drag.to.x - drag.from.x, y: o.geometry.at.y + drag.to.y - drag.from.y } : o.geometry.at;
        const deg = o.geometry.rotation ?? 0;
        const stream = grilleStream(o);
        const size = grilleSize(o);
        const ring = grilleShape(at, deg, stream, { wMm: size.wMm + 120, hMm: size.hMm + 120 }, mm).outline;
        return (
          <g
            key={o.id}
            className={`ds-grille${interactive ? " grab" : ""}${selectedId === o.id ? " picked" : ""}`}
            role="img"
            aria-label={stream === "supply" ? "Supply grille" : "Return grille"}
            onPointerDown={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* jsdom */
              }
              const w = toWorld(e);
              setDrag({ id: o.id, from: w, to: w, screen: { x: e.clientX, y: e.clientY }, moved: false });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.id !== o.id) return;
              e.stopPropagation();
              const moved = drag.moved || Math.hypot(e.clientX - drag.screen.x, e.clientY - drag.screen.y) >= CLICK_PX;
              setDrag({ ...drag, to: toWorld(e), moved });
            }}
            onPointerUp={(e) => {
              if (!drag || drag.id !== o.id) return;
              e.stopPropagation();
              const d = drag;
              setDrag(null);
              onSelect(o.id);
              if (!d.moved) return;
              const dx = d.to.x - d.from.x;
              const dy = d.to.y - d.from.y;
              onMutate((doc) => ({
                ...doc,
                objects: doc.objects.map((x) =>
                  x.id === o.id && x.geometry.kind === "point"
                    ? { ...x, geometry: { ...x.geometry, at: { x: x.geometry.at.x + dx, y: x.geometry.at.y + dy } } }
                    : x
                ),
              }));
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {face(o.id, at, deg, stream, size, "")}
            {selectedId === o.id && (
              <polygon className="ds-grille-ring" points={ring.map((p) => `${p.x},${p.y}`).join(" ")} />
            )}
          </g>
        );
      })}
      {ghost && face("ghost", ghost.at, ghost.deg, ghost.stream, ghost.size, "ds-grille-ghost")}
    </g>
  );
}
