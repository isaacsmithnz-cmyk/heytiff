"use client";

/* The ductwork on the plan (ductwork.ts; Isaac, 2026-10-28, A: "the Studio
   draws them for you once the outlets are in their rooms, joining neighbours
   with a BTO, and you drag to change"). Every ducted unit on the floor gets
   its plenum, its runs at their true width with their size and length, the
   Ys and BTOs by name, each room's outlets at their face size, and the
   return grille with its filter. An outlet or the return grille is dragged
   with Select, and the runs follow while it moves; the spot is kept on the
   system (settings.ductAt), nothing else is stored. */

import { useState } from "react";
import type { DesignDocument, Floor, Point } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { smoothPathD } from "@/lib/studio/geometry";
import { hasAllocations } from "@/lib/studio/allocations";
import { dragDuctEnd, systemDuctwork, unitFace, type DuctLayout, type DuctRun } from "@/lib/studio/ductwork";

/** a square diffuser's face, from its neck: 250 → 600 */
const faceMm = (neckMm: number): number => Math.round((neckMm * 2.4) / 10) * 10;

export function DuctLayer({
  doc,
  pack,
  floor,
  zoom,
  labelZoom,
  interactive,
  toWorld,
  onMutate,
}: {
  doc: DesignDocument;
  pack: DataPack;
  floor: Floor;
  zoom: number;
  labelZoom: number;
  /** Select is armed and nothing is simulating: the ends can be dragged */
  interactive: boolean;
  toWorld: (e: { clientX: number; clientY: number }) => Point;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const [drag, setDrag] = useState<{ systemId: string; key: string; at: Point } | null>(null);
  const s = floor.scaleMmPerUnit;
  if (!s) return null;
  /* while an end is dragged the runs follow it: lay out the draft */
  const live = drag ? dragDuctEnd(doc, drag.systemId, drag.key, drag.at) : doc;
  const layouts: { systemId: string; lay: DuctLayout }[] = [];
  for (const sys of live.systems) {
    if (!hasAllocations(sys)) continue;
    for (const lay of systemDuctwork(live, pack, sys)) if (lay.floorId === floor.id) layouts.push({ systemId: sys.id, lay });
  }
  if (!layouts.length) return null;
  const u = (mm: number) => mm / s;
  const fs = 11 / labelZoom;

  const grab = (systemId: string, key: string) => (e: React.PointerEvent<SVGElement>) => {
    if (!interactive) return;
    e.stopPropagation();
    const t = e.currentTarget;
    try {
      t.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
    setDrag({ systemId, key, at: toWorld(e) });
  };
  const move = (e: React.PointerEvent<SVGElement>) => {
    if (!drag) return;
    e.stopPropagation();
    setDrag({ ...drag, at: toWorld(e) });
  };
  const drop = (e: React.PointerEvent<SVGElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const d = drag;
    setDrag(null);
    onMutate((doc) => dragDuctEnd(doc, d.systemId, d.key, d.at));
  };
  const handlers = (systemId: string, key: string) => ({
    onPointerDown: grab(systemId, key),
    onPointerMove: move,
    onPointerUp: drop,
    onPointerCancel: () => setDrag(null),
  });

  const run = (r: DuctRun) => {
    const d = smoothPathD(r.points);
    const w = u(r.diaMm);
    return (
      <g key={r.key} className={`ds-duct ${r.stream}`}>
        <path
          className="ds-duct-edge"
          d={d}
          strokeWidth={w + 2 / zoom}
          strokeDasharray={r.stream === "return" ? `${6 / zoom} ${4 / zoom}` : undefined}
          strokeLinecap={r.stream === "return" ? "butt" : undefined}
        />
        <path className="ds-duct-body" d={d} strokeWidth={w} />
        <path className="ds-duct-core" d={d} strokeWidth={1 / zoom} strokeDasharray={`${2 / zoom} ${3 / zoom}`} />
      </g>
    );
  };
  /* the words are passed in or made here: React Compiler 1.0 cannot lower a
     template literal as a parameter's default, and refuses the component */
  const runLabel = (r: DuctRun, said?: string) => {
    const text = said ?? `Ø${r.diaMm}, ${r.lengthM.toFixed(1)} m`;
    const mid = r.points[Math.floor((r.points.length - 1) / 2)];
    const next = r.points[Math.floor((r.points.length - 1) / 2) + 1] ?? mid;
    const at = { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 };
    return (
      <text key={`l:${r.key}`} className="ds-duct-label" x={at.x} y={at.y} fontSize={fs}>
        {text}
      </text>
    );
  };

  return (
    <g className="ds-ducts" aria-label="Ductwork">
      {layouts.map(({ systemId, lay }) => {
        const unit = live.objects.find((o) => o.id === lay.unitId);
        const back = unit ? unitFace(unit, "return", s) : null;
        const ax = back?.ax ?? { x: 1, y: 0 };
        const deg = (Math.atan2(ax.y, ax.x) * 180) / Math.PI;
        const gw = u(lay.ret.wMm);
        const gh = u(lay.ret.hMm);
        return (
          <g key={lay.unitId}>
            {lay.returns.map(run)}
            {lay.supply.map(run)}
            <polygon className="ds-duct-plenum" points={lay.plenum.map((p) => `${p.x},${p.y}`).join(" ")} />
            {lay.spigots.map((sp, i) => (
              <circle key={i} className="ds-duct-spigot" cx={sp.at.x} cy={sp.at.y} r={u(sp.diaMm) / 2} />
            ))}
            {lay.fittings.map((f) => (
              <g key={f.key} className="ds-duct-fitting">
                <circle cx={f.at.x} cy={f.at.y} r={Math.max(u(f.inMm) * 0.45, 4 / zoom)} />
                <text className="ds-duct-label strong" x={f.at.x} y={f.at.y - u(f.inMm)} fontSize={fs}>
                  {f.name}
                </text>
              </g>
            ))}
            {lay.outlets.map((o) => {
              const half = u(faceMm(o.neckMm)) / 2;
              return (
                <g
                  key={o.key}
                  className={`ds-duct-outlet${interactive ? " grab" : ""}${drag?.key === o.key ? " moving" : ""}`}
                  role="img"
                  aria-label={`Square diffuser ${o.neckMm} neck, ${Math.round(o.ls)} L/s`}
                  {...handlers(systemId, o.key)}
                >
                  <rect x={o.at.x - half} y={o.at.y - half} width={half * 2} height={half * 2} />
                  <rect className="inner" x={o.at.x - half / 2} y={o.at.y - half / 2} width={half} height={half} />
                  <path
                    className="inner"
                    d={`M${o.at.x - half} ${o.at.y - half}L${o.at.x - half / 2} ${o.at.y - half / 2}M${o.at.x + half} ${o.at.y - half}L${o.at.x + half / 2} ${o.at.y - half / 2}M${o.at.x - half} ${o.at.y + half}L${o.at.x - half / 2} ${o.at.y + half / 2}M${o.at.x + half} ${o.at.y + half}L${o.at.x + half / 2} ${o.at.y + half / 2}`}
                  />
                  <text className="ds-duct-label quiet" x={o.at.x} y={o.at.y + half + fs * 1.2} fontSize={fs}>
                    {`Square ${o.neckMm}, ${Math.round(o.ls)} L/s`}
                  </text>
                </g>
              );
            })}
            <g
              className={`ds-duct-return${interactive ? " grab" : ""}${drag?.key === lay.ret.key ? " moving" : ""}`}
              role="img"
              aria-label={`Return air grille ${lay.ret.wMm} × ${lay.ret.hMm}${lay.ret.filter ? ", filter" : ""}`}
              {...handlers(systemId, lay.ret.key)}
            >
              <g transform={`rotate(${deg} ${lay.ret.at.x} ${lay.ret.at.y})`}>
                <rect x={lay.ret.at.x - gw / 2} y={lay.ret.at.y - gh / 2} width={gw} height={gh} />
                {Array.from({ length: 5 }, (_, i) => (
                  <line
                    key={i}
                    className="inner"
                    x1={lay.ret.at.x - gw / 2 + ((i + 1) * gw) / 6}
                    x2={lay.ret.at.x - gw / 2 + ((i + 1) * gw) / 6}
                    y1={lay.ret.at.y - gh / 2}
                    y2={lay.ret.at.y + gh / 2}
                  />
                ))}
              </g>
              <text className="ds-duct-label strong" x={lay.ret.at.x} y={lay.ret.at.y + gh / 2 + fs * 1.4} fontSize={fs}>
                {`Return ${lay.ret.wMm} × ${lay.ret.hMm}${lay.ret.filter ? ", filter" : ""}`}
              </text>
            </g>
            {lay.supply.map((r) => runLabel(r))}
            {/* the return's runs side by side: one label for them all */}
            {lay.returns[0] &&
              runLabel(
                lay.returns[0],
                `${lay.returns.length > 1 ? `${lay.returns.length} × ` : ""}Ø${lay.ret.diaMm}, ${Math.max(
                  ...lay.returns.map((r) => r.lengthM)
                ).toFixed(1)} m`
              )}
          </g>
        );
      })}
    </g>
  );
}
