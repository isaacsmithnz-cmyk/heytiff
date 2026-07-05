"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DesignDocument, DesignObject, Floor, Point } from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import type { PlanImages } from "@/lib/studio/plans";
import {
  areaUnitsToM2,
  boundsOfPoints,
  dist,
  distToSegment,
  fitBounds,
  formatArea,
  formatMeters,
  isAxisAlignedRect,
  mmPerUnitFromCalibration,
  pointInPolygon,
  rectDragVertex,
  polygonArea,
  polygonCentroid,
  screenToWorld,
  snapToGrid,
  unitsToMeters,
  worldToScreen,
  zoomAt,
  type Viewport,
} from "@/lib/studio/geometry";

/* StudioCanvas — the SVG scene per ADR-001. Renders the document, emits
   intents via onMutate; it never mutates the document itself. World space is
   floor pixels; one <g> carries pan/zoom; strokes keep constant screen weight
   via vector-effect. */

export type CanvasTool =
  | "select"
  | "room-rect"
  | "room-poly"
  | "calibrate"
  | "erase"
  | "arrange";

const CLOSE_SNAP_PX = 12; // screen px to close a polygon on its first vertex
const HIT_EDGE_PX = 6;

function defaultViewport(
  points: Point[],
  w: number,
  h: number,
  grid: number
): Viewport {
  const b = boundsOfPoints(points);
  if (b) return fitBounds(b, w, h, 60);
  // empty floor: centre the origin, one grid cell ≈ 56 screen px
  const zoom = 56 / grid;
  return { zoom, x: -w / (2 * zoom), y: -h / (2 * zoom) };
}

type Drag =
  | { kind: "pan"; startScreen: Point; origVp: Viewport }
  | { kind: "move"; id: string; startWorld: Point; orig: Point[] }
  | { kind: "vertex"; id: string; index: number; orig: Point[] }
  | { kind: "rect"; start: Point }
  | { kind: "sheet"; id: string; startWorld: Point; orig: Point };

export function StudioCanvas({
  doc,
  floor,
  tool,
  selectedId,
  onSelect,
  onMutate,
  onToolDone,
  planImages,
}: {
  doc: DesignDocument;
  floor: Floor;
  tool: CanvasTool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onToolDone: () => void;
  planImages?: PlanImages;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /* live geometry override while dragging, committed on pointer-up so the
     autosave/history pipeline sees one mutation per gesture */
  const [liveGeom, setLiveGeom] = useState<{ id: string; points: Point[] } | null>(null);
  const [draftPoly, setDraftPoly] = useState<Point[]>([]);
  const [draftRect, setDraftRect] = useState<{ a: Point; b: Point } | null>(null);
  const [calib, setCalib] = useState<{ a?: Point; b?: Point }>({});
  const [calibMeters, setCalibMeters] = useState("");
  const spaceDown = useRef(false);

  const rooms = useMemo(
    () =>
      doc.objects.filter(
        (o): o is DesignObject & { geometry: { kind: "polygon"; points: Point[] } } =>
          o.floorId === floor.id &&
          o.type === "room" &&
          o.geometry.kind === "polygon"
      ),
    [doc.objects, floor.id]
  );

  const roomPoints = useCallback(
    (r: { id: string; geometry: { points: Point[] } }): Point[] =>
      liveGeom && liveGeom.id === r.id ? liveGeom.points : r.geometry.points,
    [liveGeom]
  );

  /* grid: 1 m when calibrated, 50 units otherwise; snap = quarter cells.
     Plan-backed floors get finer defaults (image px are small units). */
  const hasPlans = floor.plans.length > 0;
  const grid = floor.scaleMmPerUnit ? 1000 / floor.scaleMmPerUnit : hasPlans ? 100 : 50;
  const snapStep = floor.scaleMmPerUnit || !hasPlans ? grid / 4 : 1;

  /* stored plan sheets, resolved to short-lived signed URLs (per ref), plus
     measured sizes for migrated sheets that predate stored dimensions. */
  const [sheetUrls, setSheetUrls] = useState<Record<string, string>>({});
  const [sheetDims, setSheetDims] = useState<Record<string, { w: number; h: number }>>({});
  /* sheet position override while dragging with the arrange tool */
  const [liveSheet, setLiveSheet] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let on = true;
    for (const sheet of floor.plans) {
      if (sheetUrls[sheet.imageRef] || !planImages) continue;
      void planImages
        .url(sheet.imageRef)
        .then(async (url) => {
          if (!on) return;
          setSheetUrls((m) => ({ ...m, [sheet.imageRef]: url }));
          if (!sheet.width || !sheet.height) {
            const img = new Image();
            img.src = url;
            await img.decode();
            if (on)
              setSheetDims((m) => ({
                ...m,
                [sheet.id]: { w: img.naturalWidth, h: img.naturalHeight },
              }));
          }
        })
        .catch(() => {
          /* offline or expired ref — the grid still works */
        });
    }
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.plans, planImages]);

  const sheetSize = useCallback(
    (s: { id: string; width: number; height: number }) =>
      s.width && s.height
        ? { w: s.width, h: s.height }
        : (sheetDims[s.id] ?? null),
    [sheetDims]
  );
  const sheetPos = useCallback(
    (s: { id: string; x: number; y: number }) =>
      liveSheet && liveSheet.id === s.id ? liveSheet : { x: s.x, y: s.y },
    [liveSheet]
  );

  /* viewport starts from an assumed size and re-fits once on first real
     measure (mount-time content captured in a ref — no setState in effects).
     Plan-sheet corners count as content so plan-backed floors open fitted. */
  const contentPoints = useCallback((): Point[] => {
    const pts = rooms.flatMap((r) => roomPoints(r));
    for (const s of floor.plans) {
      const dims = sheetSize(s);
      if (dims) {
        const pos = sheetPos(s);
        pts.push({ x: pos.x, y: pos.y }, { x: pos.x + dims.w, y: pos.y + dims.h });
      }
    }
    return pts;
  }, [rooms, roomPoints, floor.plans, sheetSize, sheetPos]);

  const [vp, setVp] = useState<Viewport>(() =>
    defaultViewport(contentPoints(), size.w, size.h, grid)
  );
  const mountContent = useRef({ points: contentPoints(), grid });
  const measured = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize({ w: r.width, h: r.height });
      if (!measured.current) {
        measured.current = true;
        setVp(
          defaultViewport(
            mountContent.current.points,
            r.width,
            r.height,
            mountContent.current.grid
          )
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── coordinate helpers ── */
  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = svgRef.current?.getBoundingClientRect();
      const screen = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
      return screenToWorld(screen, vp);
    },
    [vp]
  );

  const snapped = useCallback(
    (p: Point): Point => snapToGrid(p, snapStep),
    [snapStep]
  );

  /* ── zoom (native non-passive wheel so preventDefault works) ── */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      setVp((v) => zoomAt(v, screen, e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ── keyboard: space-pan, Esc cancel, Delete selection ── */
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) spaceDown.current = true;
      if (e.key === "Escape") {
        setDraftPoly([]);
        setDraftRect(null);
        setCalib({});
        setCalibMeters("");
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping(e) && selectedId) {
        e.preventDefault();
        onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== selectedId) }));
        onSelect(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selectedId, onMutate, onSelect]);

  /* ── document intents ── */
  const addRoom = useCallback(
    (points: Point[]) => {
      onMutate((d) => {
        const n = d.objects.filter((o) => o.type === "room").length + 1;
        const room: DesignObject = {
          id: newId("obj"),
          type: "room",
          systemId: null,
          floorId: floor.id,
          geometry: { kind: "polygon", points },
          plane: "room",
          props: { name: `Room ${n}` },
        };
        return { ...d, objects: [...d.objects, room] };
      });
    },
    [onMutate, floor.id]
  );

  const commitGeometry = useCallback(
    (id: string, points: Point[]) => {
      onMutate((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === id ? { ...o, geometry: { kind: "polygon", points } } : o
        ),
      }));
    },
    [onMutate]
  );

  const hitRoom = useCallback(
    (w: Point): string | null => {
      const tol = HIT_EDGE_PX / vp.zoom;
      for (let i = rooms.length - 1; i >= 0; i--) {
        const pts = roomPoints(rooms[i]);
        if (pointInPolygon(w, pts)) return rooms[i].id;
        for (let j = 0; j < pts.length; j++) {
          if (distToSegment(w, pts[j], pts[(j + 1) % pts.length]) <= tol)
            return rooms[i].id;
        }
      }
      return null;
    },
    [rooms, roomPoints, vp]
  );

  /* ── pointer handlers ── */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    const pan = () =>
      setDrag({ kind: "pan", startScreen: { x: e.clientX, y: e.clientY }, origVp: vp });

    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }

    if (e.button === 1 || spaceDown.current) return pan();
    if (e.button !== 0) return;

    switch (tool) {
      case "select": {
        const hit = hitRoom(w);
        if (hit) {
          onSelect(hit);
          const room = rooms.find((r) => r.id === hit)!;
          setDrag({ kind: "move", id: hit, startWorld: w, orig: roomPoints(room) });
        } else {
          onSelect(null);
          pan();
        }
        break;
      }
      case "room-poly": {
        const p = snapped(w);
        if (draftPoly.length >= 3) {
          const firstScreen = worldToScreen(draftPoly[0], vp);
          const hereScreen = worldToScreen(w, vp);
          if (dist(firstScreen, hereScreen) <= CLOSE_SNAP_PX) {
            addRoom(draftPoly);
            setDraftPoly([]);
            return;
          }
        }
        setDraftPoly((pts) => [...pts, p]);
        break;
      }
      case "room-rect":
        setDrag({ kind: "rect", start: snapped(w) });
        setDraftRect({ a: snapped(w), b: snapped(w) });
        break;
      case "calibrate": {
        if (!calib.a) setCalib({ a: w });
        else if (!calib.b) setCalib({ a: calib.a, b: w });
        break;
      }
      case "erase": {
        const hit = hitRoom(w);
        if (hit) {
          onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== hit) }));
          if (selectedId === hit) onSelect(null);
        }
        break;
      }
      case "arrange": {
        // topmost sheet under the cursor starts a placement drag
        for (let i = floor.plans.length - 1; i >= 0; i--) {
          const s = floor.plans[i];
          const dims = sheetSize(s);
          if (!dims) continue;
          const pos = sheetPos(s);
          if (
            w.x >= pos.x &&
            w.x <= pos.x + dims.w &&
            w.y >= pos.y &&
            w.y <= pos.y + dims.h
          ) {
            setDrag({ kind: "sheet", id: s.id, startWorld: w, orig: { x: s.x, y: s.y } });
            return;
          }
        }
        pan();
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    setCursor(w);
    if (!drag) return;
    switch (drag.kind) {
      case "pan": {
        const dx = (e.clientX - drag.startScreen.x) / vp.zoom;
        const dy = (e.clientY - drag.startScreen.y) / vp.zoom;
        setVp({ ...vp, x: drag.origVp.x - dx, y: drag.origVp.y - dy });
        break;
      }
      case "move": {
        const dx = w.x - drag.startWorld.x;
        const dy = w.y - drag.startWorld.y;
        setLiveGeom({
          id: drag.id,
          points: drag.orig.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        });
        break;
      }
      case "vertex": {
        // rectangles stay rectangular unless the room opts into free editing
        const room = rooms.find((r) => r.id === drag.id);
        const rectLocked =
          room && !room.props.freeEdit && isAxisAlignedRect(drag.orig);
        const pts = rectLocked
          ? rectDragVertex(drag.orig, drag.index, snapped(w))
          : (() => {
              const copy = [...drag.orig];
              copy[drag.index] = snapped(w);
              return copy;
            })();
        setLiveGeom({ id: drag.id, points: pts });
        break;
      }
      case "rect":
        setDraftRect({ a: drag.start, b: snapped(w) });
        break;
      case "sheet":
        setLiveSheet({
          id: drag.id,
          x: drag.orig.x + (w.x - drag.startWorld.x),
          y: drag.orig.y + (w.y - drag.startWorld.y),
        });
        break;
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "sheet" && liveSheet) {
      const { id, x, y } = liveSheet;
      if (x !== drag.orig.x || y !== drag.orig.y) {
        onMutate((d) => ({
          ...d,
          floors: d.floors.map((f) =>
            f.id === floor.id
              ? {
                  ...f,
                  plans: f.plans.map((s) => (s.id === id ? { ...s, x, y } : s)),
                }
              : f
          ),
        }));
      }
      setLiveSheet(null);
    }
    if ((drag.kind === "move" || drag.kind === "vertex") && liveGeom) {
      // only commit if the gesture actually moved something
      const room = rooms.find((r) => r.id === liveGeom.id);
      if (
        room &&
        JSON.stringify(room.geometry.points) !== JSON.stringify(liveGeom.points)
      ) {
        commitGeometry(liveGeom.id, liveGeom.points);
      }
      setLiveGeom(null);
    }
    if (drag.kind === "rect" && draftRect) {
      const { a, b } = draftRect;
      if (Math.abs(b.x - a.x) >= snapStep && Math.abs(b.y - a.y) >= snapStep) {
        addRoom([
          { x: a.x, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: b.y },
          { x: a.x, y: b.y },
        ]);
      }
      setDraftRect(null);
    }
    setDrag(null);
  };

  const onDoubleClick = () => {
    if (tool === "room-poly" && draftPoly.length >= 3) {
      addRoom(draftPoly);
      setDraftPoly([]);
    }
  };

  const startVertexDrag = (id: string, index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }
    const room = rooms.find((r) => r.id === id);
    if (room) setDrag({ kind: "vertex", id, index, orig: roomPoints(room) });
  };

  const confirmCalibration = () => {
    const meters = parseFloat(calibMeters);
    if (!calib.a || !calib.b || !Number.isFinite(meters)) return;
    const mm = mmPerUnitFromCalibration(calib.a, calib.b, meters);
    if (!mm) return;
    onMutate((d) => ({
      ...d,
      floors: d.floors.map((f) =>
        f.id === floor.id ? { ...f, scaleMmPerUnit: mm } : f
      ),
    }));
    setCalib({});
    setCalibMeters("");
    onToolDone();
  };

  /* ── render ── */
  const zoom = vp.zoom;
  const viewMinX = vp.x;
  const viewMinY = vp.y;
  const viewW = size.w / zoom;
  const viewH = size.h / zoom;
  const gridX0 = Math.floor(viewMinX / grid) * grid;
  const gridY0 = Math.floor(viewMinY / grid) * grid;
  const mm = floor.scaleMmPerUnit;
  const calibScreenB = calib.b ? worldToScreen(calib.b, vp) : null;

  const cursorClass =
    drag?.kind === "pan"
      ? "ds-cur-grabbing"
      : tool === "select"
        ? ""
        : tool === "erase"
          ? "ds-cur-erase"
          : "ds-cur-cross";

  return (
    <div ref={wrapRef} className={`ds-canvas ${cursorClass}`} data-testid="studio-canvas">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label="Design canvas"
      >
        <g transform={`scale(${zoom}) translate(${-vp.x} ${-vp.y})`}>
          {/* plan sheets (under everything); arrange tool shows outlines */}
          {floor.plans.map((s) => {
            const url = sheetUrls[s.imageRef];
            const dims = sheetSize(s);
            if (!url || !dims) return null;
            const pos = sheetPos(s);
            return (
              <g key={s.id} className="ds-sheet">
                <image
                  className="ds-plan"
                  href={url}
                  x={pos.x}
                  y={pos.y}
                  width={dims.w}
                  height={dims.h}
                  preserveAspectRatio="none"
                />
                {tool === "arrange" && (
                  <>
                    <rect
                      className="ds-sheet-outline"
                      x={pos.x}
                      y={pos.y}
                      width={dims.w}
                      height={dims.h}
                    />
                    <text
                      className="ds-sheet-name"
                      x={pos.x + 14 / zoom}
                      y={pos.y + 26 / zoom}
                      fontSize={13 / zoom}
                    >
                      {s.name}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* grid */}
          <g className="ds-grid">
            {Array.from(
              { length: Math.ceil(viewW / grid) + 2 },
              (_, i) => gridX0 + i * grid
            ).map((x) => (
              <line key={`v${x}`} x1={x} y1={viewMinY} x2={x} y2={viewMinY + viewH} />
            ))}
            {Array.from(
              { length: Math.ceil(viewH / grid) + 2 },
              (_, i) => gridY0 + i * grid
            ).map((y) => (
              <line key={`h${y}`} x1={viewMinX} y1={y} x2={viewMinX + viewW} y2={y} />
            ))}
          </g>

          {/* rooms */}
          {rooms.map((r) => {
            const pts = roomPoints(r);
            const c = polygonCentroid(pts);
            const areaU = polygonArea(pts);
            const selected = r.id === selectedId;
            return (
              <g key={r.id} className={`ds-room${selected ? " sel" : ""}`}>
                <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
                <text x={c.x} y={c.y} fontSize={13 / zoom} className="ds-room-name">
                  {String(r.props.name ?? "Room")}
                </text>
                <text
                  x={c.x}
                  y={c.y + 16 / zoom}
                  fontSize={11 / zoom}
                  className="ds-room-area"
                >
                  {mm ? formatArea(areaUnitsToM2(areaU, mm)) : "not calibrated"}
                </text>
                {selected &&
                  tool === "select" &&
                  pts.map((p, i) => (
                    <circle
                      key={i}
                      className="ds-vertex"
                      cx={p.x}
                      cy={p.y}
                      r={5 / zoom}
                      onPointerDown={startVertexDrag(r.id, i)}
                    />
                  ))}
              </g>
            );
          })}

          {/* polygon draft */}
          {draftPoly.length > 0 &&
            (() => {
              // near the first vertex? snap the preview shut and light it up
              const closing =
                cursor != null &&
                draftPoly.length >= 3 &&
                dist(worldToScreen(draftPoly[0], vp), worldToScreen(cursor, vp)) <=
                  CLOSE_SNAP_PX;
              const tail = closing ? draftPoly[0] : cursor;
              return (
                <g className="ds-draft">
                  <polyline
                    points={[...draftPoly, ...(tail ? [tail] : [])]
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                  />
                  <circle
                    className={closing ? "close-ready" : undefined}
                    cx={draftPoly[0].x}
                    cy={draftPoly[0].y}
                    r={(CLOSE_SNAP_PX / zoom) * (closing ? 1.1 : 0.6)}
                  />
                </g>
              );
            })()}

          {/* rect draft */}
          {draftRect && (
            <g className="ds-draft">
              <rect
                x={Math.min(draftRect.a.x, draftRect.b.x)}
                y={Math.min(draftRect.a.y, draftRect.b.y)}
                width={Math.abs(draftRect.b.x - draftRect.a.x)}
                height={Math.abs(draftRect.b.y - draftRect.a.y)}
              />
              {mm && (
                <text
                  x={(draftRect.a.x + draftRect.b.x) / 2}
                  y={Math.min(draftRect.a.y, draftRect.b.y) - 8 / zoom}
                  fontSize={11 / zoom}
                  className="ds-draft-dims"
                >
                  {formatMeters(unitsToMeters(Math.abs(draftRect.b.x - draftRect.a.x), mm))} ×{" "}
                  {formatMeters(unitsToMeters(Math.abs(draftRect.b.y - draftRect.a.y), mm))}
                </text>
              )}
            </g>
          )}

          {/* calibration overlay */}
          {calib.a && (
            <g className="ds-calib">
              <circle cx={calib.a.x} cy={calib.a.y} r={5 / zoom} />
              {(calib.b || cursor) && (
                <line
                  x1={calib.a.x}
                  y1={calib.a.y}
                  x2={(calib.b ?? cursor)!.x}
                  y2={(calib.b ?? cursor)!.y}
                />
              )}
              {calib.b && <circle cx={calib.b.x} cy={calib.b.y} r={5 / zoom} />}
            </g>
          )}
        </g>
      </svg>

      {/* calibration prompt (absolute within the canvas, never position:fixed) */}
      {calib.a && calib.b && calibScreenB && (
        <div
          className="ds-calib-card"
          style={{
            left: Math.min(calibScreenB.x + 14, size.w - 240),
            top: Math.min(calibScreenB.y + 14, size.h - 130),
          }}
        >
          <div className="ds-calib-t">Real distance between the two points</div>
          <div className="ds-calib-row">
            <input
              autoFocus
              inputMode="decimal"
              placeholder="e.g. 3.6"
              value={calibMeters}
              onChange={(e) => setCalibMeters(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmCalibration()}
            />
            <span>m</span>
          </div>
          <div className="ds-calib-actions">
            <button
              className="ds-calib-cancel"
              onClick={() => {
                setCalib({});
                setCalibMeters("");
              }}
            >
              Cancel
            </button>
            <button className="ds-calib-ok" onClick={confirmCalibration}>
              Set scale
            </button>
          </div>
        </div>
      )}

      {/* readouts + zoom controls */}
      <div className="ds-canvas-hud">
        <span>
          {mm
            ? `1 grid = 1 m · ${mm.toFixed(2)} mm/px`
            : "uncalibrated — grid is arbitrary"}
        </span>
        {cursor && mm && (
          <span>
            {formatMeters(unitsToMeters(cursor.x, mm))},{" "}
            {formatMeters(unitsToMeters(cursor.y, mm))}
          </span>
        )}
      </div>
      <div className="ds-zoomctl">
        <button aria-label="Zoom out" onClick={() => setVp(zoomAt(vp, { x: size.w / 2, y: size.h / 2 }, 1 / 1.3))}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => setVp(zoomAt(vp, { x: size.w / 2, y: size.h / 2 }, 1.3))}>
          +
        </button>
        <button
          aria-label="Fit to content"
          onClick={() => {
            const b = boundsOfPoints(contentPoints());
            if (b) setVp(fitBounds(b, size.w, size.h, 60));
          }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
