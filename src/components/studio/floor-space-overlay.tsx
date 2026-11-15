"use client";

/* THE SUBFLOOR OR ROOF SPACE ON THE PLAN (floor-spaces.ts; the mock "Under
   the house", https://claude.ai/artifact/36TVHmDKkFttsLnQfRMpNK): its outline
   dashed over its floor, its name and height at a corner. Its name picks it;
   picked, its corners drag as a room's do, and a dragged corner makes it
   Drawn by hand. Drawn in the canvas's world, so a point is a plan point. */

import { useState } from "react";
import type { Point } from "@/lib/studio/document";
import type { SpaceKind } from "@/lib/studio/floor-spaces";

export type SpaceOnPlan = { kind: SpaceKind; pts: Point[]; label: string; picked: boolean };

export function FloorSpaceOverlay({
  spaces,
  zoom,
  active,
  onPick,
  onReshape,
}: {
  spaces: SpaceOnPlan[];
  zoom: number;
  /** the Select tool is armed: its name picks it and its corners drag */
  active: boolean;
  onPick: (kind: SpaceKind) => void;
  onReshape: (kind: SpaceKind, pts: Point[]) => void;
}) {
  const [drag, setDrag] = useState<{ kind: SpaceKind; index: number; pts: Point[] } | null>(null);
  const toWorld = (e: React.PointerEvent): Point | null => {
    const g = (e.currentTarget as SVGGraphicsElement).parentElement as unknown as SVGGraphicsElement | null;
    const m = g?.getScreenCTM?.();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      {spaces.map((s) => {
        const pts = drag?.kind === s.kind ? drag.pts : s.pts;
        const d = `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
        /* the name sits at the outline's bottom right corner, as a room's tab does */
        const corner = pts.reduce((b, p) => (p.x + p.y > b.x + b.y ? p : b), pts[0]);
        return (
          <g key={s.kind} className={`ds-space ${s.kind}${s.picked ? " picked" : ""}`}>
            <path className="ds-space-line" d={d} />
            <text
              className="ds-space-name"
              x={corner.x}
              y={corner.y + 18 / zoom}
              fontSize={12 / zoom}
              style={{ pointerEvents: active ? undefined : "none" }}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                if (active) onPick(s.kind);
              }}
            >
              {s.label}
            </text>
            {s.picked &&
              active &&
              pts.map((p, i) => (
                <circle
                  key={i}
                  className="ds-vertex"
                  cx={p.x}
                  cy={p.y}
                  r={5 / zoom}
                  onClick={stop}
                  onPointerDown={(e) => {
                    stop(e);
                    /* the capture call kept out of the try: React Compiler refuses optional chaining inside one */
                    const el = e.target as Element;
                    if (el.setPointerCapture) {
                      try {
                        el.setPointerCapture(e.pointerId);
                      } catch {
                        /* jsdom */
                      }
                    }
                    setDrag({ kind: s.kind, index: i, pts: s.pts });
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.kind !== s.kind || drag.index !== i) return;
                    const w = toWorld(e);
                    if (w) setDrag({ ...drag, pts: drag.pts.map((q, j) => (j === i ? w : q)) });
                  }}
                  onPointerUp={(e) => {
                    stop(e);
                    if (drag && drag.kind === s.kind && drag.pts !== s.pts) onReshape(s.kind, drag.pts);
                    setDrag(null);
                  }}
                />
              ))}
          </g>
        );
      })}
    </>
  );
}
