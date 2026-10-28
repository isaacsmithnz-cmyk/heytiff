"use client";

/* The ductwork on the plan (ductwork.ts; Isaac, 2026-10-28: option 1's
   square routes "at the true width", and every junction "just a circle and
   ducts attached to that circle … you could select whether it's a Y or a
   BTO"). Every ducted unit on the floor gets its plenum as a box with a
   collar on the face each run leaves by, its runs at their true width with
   a line down their middle and their size, a circle where two part, named
   by the ducts on it, each room's outlets at their face size, and the
   return grille under the unit with its filter.

   With Select, an outlet or the return grille is dragged and the runs
   follow while it moves (the spot is kept on the system, settings.ductAt),
   and a circle is clicked to make it a Y or a BTO (settings.ductFitting);
   clicking the lit one again leaves it to the day. */

import { useState } from "react";
import type { DesignDocument, Floor, Point } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { hasAllocations } from "@/lib/studio/allocations";
import {
  dragDuctEnd,
  setFittingKind,
  systemDuctwork,
  unitFace,
  type DuctFitting,
  type DuctLayout,
  type DuctRun,
  type FittingKind,
} from "@/lib/studio/ductwork";

/** a square diffuser's face, from its neck: 250 → 600 */
const faceMm = (neckMm: number): number => Math.round((neckMm * 2.4) / 10) * 10;
/** a bend's radius on the plan, mm */
const BEND_MM = 300;
/** a collar's length off the plenum, mm */
const COLLAR_MM = 100;
/** how far a circle stands proud of its biggest duct, mm */
const RIM_MM = 60;

/** square legs with their corners rounded, as flex lies in a ceiling */
export function bendPathD(points: readonly Point[], r: number): string {
  if (!points.length) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const la = Math.hypot(b.x - a.x, b.y - a.y);
    const lc = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, la / 2, lc / 2);
    const s0 = { x: b.x - ((b.x - a.x) / la) * k, y: b.y - ((b.y - a.y) / la) * k };
    const s1 = { x: b.x + ((c.x - b.x) / lc) * k, y: b.y + ((c.y - b.y) / lc) * k };
    d += ` L${f(s0.x)} ${f(s0.y)} Q${f(b.x)} ${f(b.y)} ${f(s1.x)} ${f(s1.y)}`;
  }
  const z = points[points.length - 1];
  return `${d} L${f(z.x)} ${f(z.y)}`;
}

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
  /* the circle whose Y / BTO pick is open */
  const [open, setOpen] = useState<string | null>(null);
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
    const d = bendPathD(r.points, u(BEND_MM));
    const w = u(r.diaMm);
    return (
      <g key={r.key} className={`ds-duct ${r.stream}`}>
        <path
          className="ds-duct-edge"
          d={d}
          strokeWidth={w + 2 / zoom}
          strokeDasharray={r.stream === "return" ? `${6 / zoom} ${4 / zoom}` : undefined}
        />
        <path className="ds-duct-body" d={d} strokeWidth={w} />
        <path className="ds-duct-core" d={d} strokeWidth={1 / zoom} />
      </g>
    );
  };
  /* a run's size, on its longest leg; a stub too short to carry it goes
     without, its size being in the circle's name */
  const sizeTag = (r: DuctRun) => {
    let best = 0;
    let len = -1;
    for (let i = 0; i < r.points.length - 1; i++) {
      const l = Math.hypot(r.points[i + 1].x - r.points[i].x, r.points[i + 1].y - r.points[i].y);
      if (l > len) {
        len = l;
        best = i;
      }
    }
    if (len * zoom < 60) return null;
    const a = r.points[best];
    const b = r.points[best + 1] ?? a;
    return (
      <text key={`l:${r.key}`} className="ds-duct-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + fs * 0.35} fontSize={fs}>
        {`Ø${r.diaMm}`}
      </text>
    );
  };

  const pick = (systemId: string, f: DuctFitting, kind: FittingKind) => {
    setOpen(null);
    onMutate((doc) => setFittingKind(doc, systemId, f.key, f.kind === kind ? null : kind));
  };
  const junction = (systemId: string, f: DuctFitting) => {
    const r = u(Math.max(...f.ductsMm) / 2 + RIM_MM);
    const isOpen = open === f.key;
    /* the tray is the screen's size at any zoom, so it can be pressed */
    const px = 1 / zoom;
    const bw = 40 * px;
    const bh = 26 * px;
    const pad = 3 * px;
    const tray = { x: f.at.x + r + 6 * px, y: f.at.y - bh / 2 - pad };
    return (
      <g key={f.key} className="ds-duct-fitting">
        <circle
          cx={f.at.x}
          cy={f.at.y}
          r={r}
          className={interactive ? "grab" : undefined}
          role="button"
          tabIndex={interactive ? 0 : -1}
          aria-label={f.name}
          aria-expanded={isOpen}
          onPointerDown={(e) => interactive && e.stopPropagation()}
          onClick={(e) => {
            if (!interactive) return;
            e.stopPropagation();
            setOpen(isOpen ? null : f.key);
          }}
          onKeyDown={(e) => {
            if (interactive && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setOpen(isOpen ? null : f.key);
            }
          }}
        />
        <text className="ds-duct-label strong" x={f.at.x} y={f.at.y - r - fs * 0.5} fontSize={fs}>
          {f.name}
        </text>
        {isOpen && interactive && (
          <g className="ds-duct-pick" role="group" aria-label={`Make ${f.name} as`}>
            <rect className="tray" x={tray.x} y={tray.y} width={bw * 2 + pad * 2} height={bh + pad * 2} rx={bh / 2 + pad} />
            {(["y", "bto"] as const).map((k, i) => {
              const x = tray.x + pad + i * bw;
              const on = f.kind === k;
              return (
                <g
                  key={k}
                  className={`opt${on ? " on" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(systemId, f, k);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(systemId, f, k);
                    }
                  }}
                >
                  <rect x={x} y={tray.y + pad} width={bw} height={bh} rx={bh / 2} />
                  <text x={x + bw / 2} y={tray.y + pad + bh / 2 + 4.5 * px} fontSize={13 * px}>
                    {k === "y" ? "Y" : "BTO"}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </g>
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
            {lay.collars.map((c, i) => {
              const w = u(c.diaMm) / 2;
              const side = { x: -c.out.y, y: c.out.x };
              const tip = { x: c.at.x + c.out.x * u(COLLAR_MM), y: c.at.y + c.out.y * u(COLLAR_MM) };
              const pts = [
                { x: c.at.x + side.x * w, y: c.at.y + side.y * w },
                { x: tip.x + side.x * w, y: tip.y + side.y * w },
                { x: tip.x - side.x * w, y: tip.y - side.y * w },
                { x: c.at.x - side.x * w, y: c.at.y - side.y * w },
              ];
              return <polygon key={i} className="ds-duct-collar" points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />;
            })}
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
                {`Return${lay.ret.filter ? ", filter" : ""}`}
              </text>
            </g>
            {lay.supply.map(sizeTag)}
            {lay.returns[0] && sizeTag(lay.returns[0])}
            {lay.fittings.map((f) => junction(systemId, f))}
          </g>
        );
      })}
    </g>
  );
}
