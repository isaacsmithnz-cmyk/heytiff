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
  drawLinearEnd,
  linearEnds,
  setFittingKind,
  systemDuctwork,
  unitFace,
  type DuctFitting,
  type DuctLayout,
  type DuctOutlet,
  type DuctRun,
  type FittingKind,
} from "@/lib/studio/ductwork";
import {
  LINEAR_HEIGHTS_MM,
  OUTLET_NECKS_MM,
  outletName,
  setOutletPick,
  type OutletKind,
  type OutletPick,
} from "@/lib/studio/outlets";

/** a square diffuser's face, from its neck: 250 → 600 */
const faceMm = (neckMm: number): number => Math.round((neckMm * 2.4) / 10) * 10;
/** a round diffuser's face, from its neck: 250 → 550 */
const roundFaceMm = (neckMm: number): number => Math.round((neckMm * 2.2) / 10) * 10;
/** a press that moves less than this on screen is a click, px */
const CLICK_PX = 4;
/** the outlet tray's width, px */
const TRAY_W = 232;
const KIND_WORD: Record<OutletKind, string> = { square: "Square", round: "Round", linear: "Linear" };
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
  /* what is held: an outlet or the return moving, or one end of a linear
     being drawn; `from` is where the press began on screen, so a press
     that hardly moves is a click */
  const [drag, setDrag] = useState<{
    systemId: string;
    key: string;
    at: Point;
    end: 0 | 1 | null;
    outlet: DuctOutlet | null;
    from: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  /* the circle whose Y / BTO pick is open */
  const [open, setOpen] = useState<string | null>(null);
  /* the outlet whose tray is open */
  const [chosen, setChosen] = useState<string | null>(null);
  const s = floor.scaleMmPerUnit;
  if (!s) return null;
  const held = (d: DesignDocument) => {
    if (!drag || !drag.moved) return d;
    if (drag.end != null && drag.outlet) return drawLinearEnd(d, drag.systemId, drag.outlet, drag.end, drag.at, s);
    return dragDuctEnd(d, drag.systemId, drag.key, drag.at);
  };
  /* while something is held the runs follow it: lay out the draft */
  const live = held(doc);
  const layouts: { systemId: string; lay: DuctLayout }[] = [];
  for (const sys of live.systems) {
    if (!hasAllocations(sys)) continue;
    for (const lay of systemDuctwork(live, pack, sys)) if (lay.floorId === floor.id) layouts.push({ systemId: sys.id, lay });
  }
  if (!layouts.length) return null;
  const u = (mm: number) => mm / s;
  const fs = 11 / labelZoom;

  const grab = (systemId: string, key: string, end: 0 | 1 | null = null, outlet: DuctOutlet | null = null) =>
    (e: React.PointerEvent<SVGElement>) => {
      if (!interactive) return;
      e.stopPropagation();
      const t = e.currentTarget;
      try {
        t.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }
      setDrag({ systemId, key, at: toWorld(e), end, outlet, from: { x: e.clientX, y: e.clientY }, moved: false });
    };
  const move = (e: React.PointerEvent<SVGElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const moved = drag.moved || Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) >= CLICK_PX;
    setDrag({ ...drag, at: toWorld(e), moved });
  };
  const drop = (e: React.PointerEvent<SVGElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      /* a click on an outlet opens its tray; again, closes it */
      if (d.end == null && d.outlet) setChosen(chosen === d.key ? null : d.key);
      return;
    }
    onMutate((doc) =>
      d.end != null && d.outlet ? drawLinearEnd(doc, d.systemId, d.outlet, d.end, d.at, s) : dragDuctEnd(doc, d.systemId, d.key, d.at)
    );
  };
  const handlers = (systemId: string, key: string, end: 0 | 1 | null = null, outlet: DuctOutlet | null = null) => ({
    onPointerDown: grab(systemId, key, end, outlet),
    onPointerMove: move,
    onPointerUp: drop,
    onPointerCancel: () => setDrag(null),
  });
  const choose = (systemId: string, o: DuctOutlet, change: OutletPick) =>
    onMutate((doc) => setOutletPick(doc, systemId, o.key, change));

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

  /* one outlet at its face size: a square diffuser, a round one, or a
     linear bar grille along the ceiling */
  const outletShape = (o: DuctOutlet) => {
    if (o.kind === "linear") {
      const ends = linearEnds(o, s);
      if (!ends || !o.along) return null;
      const h = u(o.heightMm ?? 150) / 2;
      const n = { x: -o.along.y, y: o.along.x };
      const corner = (p: Point, k: number) => `${p.x + n.x * h * k},${p.y + n.y * h * k}`;
      const bars = Math.max(2, Math.round((o.heightMm ?? 150) / 30));
      return (
        <>
          <polygon points={[corner(ends[0], 1), corner(ends[1], 1), corner(ends[1], -1), corner(ends[0], -1)].join(" ")} />
          {Array.from({ length: bars }, (_, i) => {
            const k = -1 + (2 * (i + 1)) / (bars + 1);
            return (
              <line
                key={i}
                className="inner"
                x1={ends[0].x + n.x * h * k}
                y1={ends[0].y + n.y * h * k}
                x2={ends[1].x + n.x * h * k}
                y2={ends[1].y + n.y * h * k}
              />
            );
          })}
        </>
      );
    }
    if (o.kind === "round") {
      const r = u(roundFaceMm(o.neckMm)) / 2;
      return (
        <>
          <circle cx={o.at.x} cy={o.at.y} r={r} />
          <circle className="inner" cx={o.at.x} cy={o.at.y} r={r * 0.66} />
          <circle className="inner" cx={o.at.x} cy={o.at.y} r={r * 0.2} />
        </>
      );
    }
    const half = u(faceMm(o.neckMm)) / 2;
    return (
      <>
        <rect x={o.at.x - half} y={o.at.y - half} width={half * 2} height={half * 2} />
        <rect className="inner" x={o.at.x - half / 2} y={o.at.y - half / 2} width={half} height={half} />
        <path
          className="inner"
          d={`M${o.at.x - half} ${o.at.y - half}L${o.at.x - half / 2} ${o.at.y - half / 2}M${o.at.x + half} ${o.at.y - half}L${o.at.x + half / 2} ${o.at.y - half / 2}M${o.at.x - half} ${o.at.y + half}L${o.at.x - half / 2} ${o.at.y + half / 2}M${o.at.x + half} ${o.at.y + half}L${o.at.x + half / 2} ${o.at.y + half / 2}`}
        />
      </>
    );
  };
  /* the tray beside a chosen outlet: its kind, and its neck, or a linear's
     length and height. It is the screen's size at any zoom */
  const tray = (systemId: string, o: DuctOutlet) => {
    const reach = o.kind === "linear" ? u((o.lengthMm ?? 1200) / 2) : u(faceMm(o.neckMm) / 2);
    const px = 1 / zoom;
    const name = outletName(o);
    return (
      <foreignObject x={o.at.x + reach + 10 * px} y={o.at.y - 24 * px} width={TRAY_W * px} height={180 * px} className="ds-outlet-fo">
        <div
          className="ds-outlet-tray"
          role="group"
          aria-label={`${name}, ${Math.round(o.ls)} L/s`}
          style={{ width: TRAY_W, transform: `scale(${px})`, transformOrigin: "0 0" }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") setChosen(null);
          }}
        >
          <div className="seg">
            {(["square", "round", "linear"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={o.kind === k}
                className={o.kind === k ? "on" : undefined}
                onClick={() => choose(systemId, o, { kind: k })}
              >
                {KIND_WORD[k]}
              </button>
            ))}
          </div>
          {o.kind === "linear" ? (
            <>
              <label className="row">
                <span>Length</span>
                <input
                  key={`${o.key}:${o.lengthMm}`}
                  type="number"
                  inputMode="numeric"
                  min={300}
                  step={100}
                  defaultValue={o.lengthMm ?? 1200}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.currentTarget.value));
                    if (v >= 300 && v !== o.lengthMm) choose(systemId, o, { lengthMm: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </label>
              <div className="row" role="group" aria-label="Height">
                <span>Height</span>
                <div className="seg">
                  {LINEAR_HEIGHTS_MM.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={(o.heightMm ?? 150) === h}
                      className={(o.heightMm ?? 150) === h ? "on" : undefined}
                      onClick={() => choose(systemId, o, { heightMm: h })}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="row" role="group" aria-label="Neck">
              <span>Neck</span>
              <div className="seg">
                {[...new Set([...OUTLET_NECKS_MM, o.neckMm])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={o.neckMm === n}
                      className={o.neckMm === n ? "on" : undefined}
                      onClick={() => choose(systemId, o, { neckMm: n })}
                    >
                      {n}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <p className={o.over ? "air over" : "air"}>
            {`${Math.round(o.ls)} L/s${o.over ? (o.kind === "linear" ? ", over 2 m/s across its face" : ", over 3 m/s at its neck") : ""}`}
          </p>
        </div>
      </foreignObject>
    );
  };
  const outlet = (systemId: string, o: DuctOutlet) => {
    const isChosen = chosen === o.key && interactive;
    const ends = o.kind === "linear" ? linearEnds(o, s) : null;
    return (
      <g key={o.key}>
        <g
          className={`ds-duct-outlet${interactive ? " grab" : ""}${drag?.key === o.key && drag.end == null ? " moving" : ""}${o.over ? " over" : ""}${isChosen ? " chosen" : ""}`}
          role="img"
          aria-label={`${outletName(o)}, ${Math.round(o.ls)} L/s`}
          {...handlers(systemId, o.key, null, o)}
        >
          {outletShape(o)}
        </g>
        {isChosen &&
          ends?.map((p, i) => (
            <circle
              key={i}
              className="ds-outlet-end"
              cx={p.x}
              cy={p.y}
              r={5 / zoom}
              role="img"
              aria-label={i === 0 ? "Start of the grille" : "End of the grille"}
              {...handlers(systemId, `${o.key}#${i}`, i as 0 | 1, o)}
            />
          ))}
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
            {lay.outlets.map((o) => outlet(systemId, o))}
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
            {/* the open tray last, over everything else */}
            {interactive && lay.outlets.filter((o) => o.key === chosen).map((o) => <g key={`tray:${o.key}`}>{tray(systemId, o)}</g>)}
          </g>
        );
      })}
    </g>
  );
}
