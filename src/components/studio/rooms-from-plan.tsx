"use client";

/* ROOMS (v2, 20 October; the boards flow-rooms and flow-adjust at
   https://claude.ai/artifact/ST5TfR7UjifF9S81ZnTkFo). Once a floor has its
   scale, the rooms Tiff read on its plan, over the plan: click a room to
   pick it (a room left out comes back in); the picked one shows its
   corners to drag, and beside it its name, area, glass, where it faces and
   its load, the Studio's own. Join with puts a room and its robe together.
   Done makes each kept one a Studio room, exactly as one drawn by hand.

   "You decide while looking at the thing" (Isaac, 19 October): picking,
   adjusting and naming are one page, on the plan. */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Dot } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import { formatArea, polygonArea, polygonCentroid } from "@/lib/studio/geometry";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import type { PlanImages } from "@/lib/studio/plans";
import type { SheetReading } from "@/lib/studio/reading";
import { glassM2, glazingFor, joinOutlines, orientationFor, roomFrom, suggestionsFor, type Suggestion } from "@/lib/studio/rooms-from-reading";

const GLAZING_WORD = { low: "low", moderate: "moderate", high: "high" } as const;

export function RoomsFromPlan({
  doc,
  floor,
  sheets,
  planImages,
  onDone,
  onClose,
}: {
  doc: DesignDocument;
  floor: Floor;
  sheets: SheetReading[];
  planImages: PlanImages;
  /** the rooms to add to the floor */
  onDone: (rooms: DesignObject[]) => void;
  onClose: () => void;
}) {
  const [rooms, setRooms] = useState<Suggestion[]>(() => suggestionsFor(floor, sheets));
  const [picked, setPicked] = useState<string | null>(() => rooms.find((r) => r.keep)?.key ?? rooms[0]?.key ?? null);
  const [joining, setJoining] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; corner: number } | null>(null);
  const mm = floor.scaleMmPerUnit ?? 0;
  const roomAbove = doc.floors.some((f) => f.level > floor.level);

  /* the floor's plans, signed when the page opens */
  useEffect(() => {
    let live = true;
    for (const p of floor.plans) {
      void planImages
        .url(p.imageRef)
        .then((u) => {
          if (live) setUrls((m) => ({ ...m, [p.imageRef]: u }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [floor.plans, planImages]);

  /* the view: every plan's visible part, with a margin */
  const boxes = floor.plans.map((p) => {
    const c = p.crop ?? { x: 0, y: 0, w: p.width, h: p.height };
    return { x: p.x + c.x, y: p.y + c.y, w: c.w, h: c.h };
  });
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = Math.max(x1 - x0, y1 - y0) * 0.02;
  const view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const unit = view.w / 1000; // a thousandth of the view: strokes and handles read the same at any scale

  const sel = rooms.find((r) => r.key === picked) ?? null;
  const kept = rooms.filter((r) => r.keep);
  const m2 = (pts: Point[]) => (polygonArea(pts) * mm * mm) / 1e6;
  const asRoom = (r: Suggestion) => roomFrom(r, floor.id, mm, roomAbove);
  const loadOf = (r: Suggestion) => roomLoadKw(doc, asRoom(r) as RoomObj);

  const at = (e: { clientX: number; clientY: number }): Point => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };

  const pick = (key: string) => {
    if (joining && sel && key !== sel.key) {
      const other = rooms.find((r) => r.key === key)!;
      const wall = mm ? 300 / mm : unit * 15; // a wall's width, 300 mm
      const joined: Suggestion = {
        ...sel,
        points: joinOutlines(sel.points, other.points, wall),
        keep: true,
        windows: [...sel.windows, ...other.windows],
        notes: [...sel.notes, ...other.notes],
      };
      setRooms(rooms.filter((r) => r.key !== key).map((r) => (r.key === sel.key ? joined : r)));
      setJoining(false);
      return;
    }
    setJoining(false);
    setPicked(key);
    setRooms(rooms.map((r) => (r.key === key && !r.keep ? { ...r, keep: true } : r)));
  };
  const toggle = (key: string) => setRooms(rooms.map((r) => (r.key === key ? { ...r, keep: !r.keep } : r)));
  const rename = (key: string, name: string) => setRooms(rooms.map((r) => (r.key === key ? { ...r, name } : r)));

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    setRooms((rs) => rs.map((r) => (r.key === d.key ? { ...r, points: r.points.map((q, i) => (i === d.corner ? p : q)) } : r)));
  };

  const glass = sel ? glassM2(sel) : 0;
  const level = sel && mm ? glazingFor(m2(sel.points), glass) : undefined;
  const faces = sel ? orientationFor(sel) : undefined;
  const kw = sel && mm ? loadOf(sel) : null;

  return (
    <Dialog
      heading={`Rooms Tiff found, ${floor.name}`}
      onClose={onClose}
      width="wide"
      dismissable={false}
      foot={
        <>
          <span className="ds2-nd-foot-fact">
            {joining && sel ? `Click the room to join to ${sel.name || "this room"}` : `${kept.length} of ${rooms.length} kept`}
          </span>
          <Button kind="quiet" onClick={onClose}>
            Skip, draw them myself
          </Button>
          <Button kind="main" icon="check" disabled={kept.length === 0} onClick={() => onDone(kept.map(asRoom))}>
            {kept.length === 1 ? "Done, 1 room" : `Done, ${kept.length} rooms`}
          </Button>
        </>
      }
    >
      <div className="ds2-rm">
        <div className="ds2-rm-plan">
          <svg
            ref={svg}
            className="ds2-rm-svg"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${floor.name}: the rooms Tiff found`}
            onPointerMove={onMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerLeave={() => {
              drag.current = null;
            }}
          >
            <defs>
              {floor.plans.map((p, i) => (
                <clipPath key={p.id} id={`rm-clip-${i}`}>
                  <rect x={boxes[i].x} y={boxes[i].y} width={boxes[i].w} height={boxes[i].h} />
                </clipPath>
              ))}
            </defs>
            {floor.plans.map((p, i) =>
              urls[p.imageRef] ? (
                <image key={p.id} href={urls[p.imageRef]} x={p.x} y={p.y} width={p.width} height={p.height} clipPath={`url(#rm-clip-${i})`} className="ds2-rm-img" />
              ) : null,
            )}
            {rooms.map((r) => (
              <polygon
                key={r.key}
                points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                className={`ds2-rm-room${r.keep ? " ds2-rm-room--kept" : ""}${r.key === picked ? " ds2-rm-room--sel" : ""}`}
                strokeWidth={unit * (r.key === picked ? 3 : 2)}
                onClick={() => pick(r.key)}
              />
            ))}
            {rooms.map((r) => {
              const c = polygonCentroid(r.points);
              return (
                <text key={`${r.key}-t`} x={c.x} y={c.y} className={`ds2-rm-label${r.keep ? " ds2-rm-label--kept" : ""}`} fontSize={unit * 14} textAnchor="middle" dominantBaseline="middle">
                  {r.name}
                </text>
              );
            })}
            {sel &&
              sel.points.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - unit * 6}
                  y={p.y - unit * 6}
                  width={unit * 12}
                  height={unit * 12}
                  className="ds2-rm-corner"
                  strokeWidth={unit * 2}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { key: sel.key, corner: i };
                  }}
                />
              ))}
          </svg>
        </div>

        <aside className="ds2-rm-side" aria-label="Rooms">
          {sel && (
            <div className="ds2-rm-card">
              <div className="ds2-rm-row">
                <b>{sel.keep ? "Kept" : "Left out"}</b>
                <Button kind="quiet" size={32} onClick={() => toggle(sel.key)}>
                  {sel.keep ? "Leave it out" : "Keep it"}
                </Button>
              </div>
              <Field label="Name">
                <TextInput value={sel.name} onChange={(e) => rename(sel.key, e.target.value)} />
              </Field>
              <dl className="ds2-rm-facts">
                <dt>Area</dt>
                <dd>{mm ? `${formatArea(m2(sel.points))}, ${sel.points.length} corners` : "Set the scale first"}</dd>
                <dt>Glass</dt>
                <dd>{sel.windows.length ? `${glass.toFixed(1)} m²${level ? `, ${GLAZING_WORD[level]}` : ""}` : "No windows read"}</dd>
                <dt>Faces</dt>
                <dd>{faces ?? "Not read"}</dd>
                <dt>Load</dt>
                <dd>{kw != null ? `${kw.toFixed(1)} kW` : "Set the scale first"}</dd>
              </dl>
              {sel.notes.map((n) => (
                <p key={n} className="ds2-rm-note">
                  <Dot hue="orange" />
                  {n}
                </p>
              ))}
              <Button size={32} onClick={() => setJoining(!joining)}>
                {joining ? "Cancel the join" : "Join with another room"}
              </Button>
            </div>
          )}
          <ul className="ds2-rm-list">
            {rooms.map((r) => (
              <li key={r.key} className={`ds2-rm-item${r.key === picked ? " ds2-rm-item--sel" : ""}`}>
                <button type="button" role="checkbox" aria-checked={r.keep} aria-label={`Keep ${r.name}`} className="ds2-rm-tick" onClick={() => toggle(r.key)}>
                  {r.keep && <Icon name="check" size={12} />}
                </button>
                <button type="button" className="ds2-rm-name" onClick={() => pick(r.key)}>
                  {r.name || "Unnamed"}
                </button>
                <span className="ds2-rm-m2">{mm ? formatArea(m2(r.points)) : ""}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Dialog>
  );
}
