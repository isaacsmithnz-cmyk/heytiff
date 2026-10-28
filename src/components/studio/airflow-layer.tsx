"use client";

/* The airflow marks on the plan (airflow-marks.ts; Isaac, 2026-10-28: "just
   short arrows … two or three … slightly squiggly", "Blue for supply, red
   for return"). Every mark on the floor, whichever system is picked. With
   Select, a click picks a mark (Delete removes it, as anything picked) and a
   drag moves it; the draft while the Airflow tool is pulling is drawn here
   too. */

import { useState } from "react";
import type { DesignDocument, Floor, Point } from "@/lib/studio/document";
import { AIRFLOW_INKS, isAirflowMark, markShapes, streamOf, type AirStream, type AirflowMark } from "@/lib/studio/airflow-marks";

/** a press that moves less than this on screen is a click, px */
const CLICK_PX = 4;
/** the scale a plan without one is drawn at, mm a unit */
const UNSCALED_MM = 10;

export function AirflowLayer({
  doc,
  floor,
  zoom,
  interactive,
  selectedId,
  draft,
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
  /** the mark the Airflow tool is pulling out, before it is let go */
  draft: { at: Point; deg: number; stream: AirStream } | null;
  toWorld: (e: { clientX: number; clientY: number }) => Point;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; from: Point; screen: Point; to: Point; moved: boolean } | null>(null);
  const mm = floor.scaleMmPerUnit ?? UNSCALED_MM;
  const marks = doc.objects.filter((o): o is AirflowMark => o.floorId === floor.id && isAirflowMark(o));
  if (!marks.length && !draft) return null;

  const shape = (key: string, at: Point, deg: number, stream: AirStream, cls: string) => (
    <g key={key} className={cls} aria-hidden="true">
      {markShapes(at, deg, stream, mm).map((s, i) => (
        <g key={i}>
          <path d={s.line} fill="none" stroke={AIRFLOW_INKS[stream]} strokeWidth={1.8 / zoom} strokeLinecap="round" strokeLinejoin="round" />
          <path d={s.head} fill={AIRFLOW_INKS[stream]} stroke="none" />
        </g>
      ))}
    </g>
  );

  return (
    <g className="ds-airflow" aria-label="Airflow">
      {marks.map((o) => {
        const moving = drag?.id === o.id && drag.moved;
        const at = moving ? { x: o.geometry.at.x + drag.to.x - drag.from.x, y: o.geometry.at.y + drag.to.y - drag.from.y } : o.geometry.at;
        const deg = o.geometry.rotation ?? 0;
        const stream = streamOf(o);
        const r = 500 / mm;
        return (
          <g
            key={o.id}
            className={`ds-airflow-mark${interactive ? " grab" : ""}${selectedId === o.id ? " picked" : ""}`}
            role="img"
            aria-label={stream === "supply" ? "Supply airflow" : "Return airflow"}
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
            {/* the mark's own footprint takes the press, not just its strokes */}
            <circle cx={at.x} cy={at.y} r={r} className="ds-airflow-hit" />
            {selectedId === o.id && <circle cx={at.x} cy={at.y} r={r} className="ds-airflow-ring" />}
            {shape(o.id, at, deg, stream, "")}
          </g>
        );
      })}
      {draft && shape("draft", draft.at, draft.deg, draft.stream, "ds-airflow-draft")}
    </g>
  );
}
