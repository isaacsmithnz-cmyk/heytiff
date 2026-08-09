"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import {
  areaUnitsToM2,
  boundsOfPoints,
  isAxisAlignedRect,
  polygonArea,
  unitsToMeters,
} from "@/lib/studio/geometry";
import {
  roomHeatLoadKw,
  baseWm2,
  detectOrientation,
  orientationFromWalls,
  ORIENT_LABELS,
  ORIENT_MULT,
  ORIENTATIONS,
  type BuildingType,
  type GlazingLevel,
  type Orientation,
  type RoomCondition,
} from "@/lib/studio/loads";

/* Room configuration modal (flow rework, Slice 2) — pops on room draw / edit.
   Layout mirrors the original DUCTR "New room" dialog: name + quick-pick chips,
   a dimensions row, glazing / condition / orientation with info tips, the marked
   external-walls control, and a live "Estimated heat load" panel. Portalled to
   body (the shell's .page transform breaks position:fixed inside it). Area comes
   from the drawn polygon; the load recomputes live from the Stage-3 engine.
   Orientation is auto-derived from the marked walls and overridable. */

const GLAZING: { value: GlazingLevel; label: string }[] = [
  { value: "low", label: "Low — double glazed" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High — large / single" },
];
const CONDITION: { value: RoomCondition; label: string }[] = [
  { value: "well_insulated", label: "Well insulated" },
  { value: "standard", label: "Standard" },
  { value: "poor", label: "Poor insulation" },
];
const NAME_CHIPS = [
  "Living / Dining",
  "Kitchen",
  "Bedroom",
  "Master Bedroom",
  "Study",
  "Open Plan",
  "Bathroom",
  "Office",
];
const TIP_GLAZING =
  "Amount of glass in the room. Low (double glazed) reduces load by 20%. High (large or single glazed) increases it by 24%.";
const TIP_CONDITION =
  "Building envelope quality. Well insulated reduces load by 15%. Poor insulation increases it by 20%. Standard = no adjustment.";
const TIP_ORIENT =
  "Direction the primary exposed wall faces. West is worst (×1.30). South is mildest (×0.85). Derived from your marked external walls.";

const trimM = (m: number) => String(Math.round(m * 10) / 10);

interface Draft {
  name: string;
  glazing: GlazingLevel;
  condition: RoomCondition;
  ceilingHeightM: number;
  orientation: Orientation;
}

export function RoomModal({
  doc,
  roomId,
  onMutate,
  onClose,
  onRemarkWalls,
  onEditShape,
  onOpenReference,
}: {
  doc: DesignDocument;
  roomId: string;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onClose: () => void;
  /** re-enter canvas wall-marking for this room (saves first, then re-marks) */
  onRemarkWalls?: (roomId: string) => void;
  /** unpin the room on the canvas to resize / move it (saves first) */
  onEditShape?: (roomId: string) => void;
  onOpenReference?: () => void;
}) {
  const room = useMemo(() => doc.objects.find((o) => o.id === roomId), [doc.objects, roomId]);
  const floor = useMemo(
    () => (room ? doc.floors.find((f) => f.id === room.floorId) : null),
    [doc.floors, room],
  );
  /* A copy, not the document's own array. Everything below memoises on `poly`,
     and handing those memos a live reference into the document means their
     dependency can be mutated underneath them by whoever edits the room next —
     the memo would then hold a value derived from points it can no longer see.
     A room polygon is a handful of points; copying it is free. */
  const poly = useMemo(
    () => (room && room.geometry.kind === "polygon" ? [...room.geometry.points] : null),
    [room],
  );

  /* Pulled out so the memos below depend on the NUMBER rather than on an
     optional chain into `floor`. `floor?.scaleMmPerUnit` as a dependency reads
     as a different value to the compiler than the `floor.scaleMmPerUnit` the
     bodies actually use, which is enough to make it give up on the component. */
  const scaleMmPerUnit = floor?.scaleMmPerUnit;

  const areaM2 = useMemo(
    () => (poly && scaleMmPerUnit ? areaUnitsToM2(polygonArea(poly), scaleMmPerUnit) : null),
    [poly, scaleMmPerUnit],
  );

  /* width × length from the drawn shape's bounding box (exact for a rectangle;
     the load still uses the true polygon area, shown in the heat-load panel). */
  const dims = useMemo(() => {
    if (!poly || !scaleMmPerUnit) return null;
    const b = boundsOfPoints(poly);
    if (!b) return null;
    return {
      w: unitsToMeters(b.maxX - b.minX, scaleMmPerUnit),
      l: unitsToMeters(b.maxY - b.minY, scaleMmPerUnit),
    };
  }, [poly, scaleMmPerUnit]);

  /* width × length only equals the area for a rectangle; for an L-shape the
     bbox overstates it, so we drop the multiplication and just state the area. */
  const isRect = poly ? isAxisAlignedRect(poly) : false;

  /* external-wall state is PHYSICAL — it comes from the walls marked on the
     canvas, not checkboxes. No marked walls ⇒ an internal / party room (no
     solar gain), which subsumes the old "party wall" toggle. */
  const markedWalls = Array.isArray(room?.props.externalWalls)
    ? (room!.props.externalWalls as number[])
    : [];
  const hasExternalWalls = markedWalls.length > 0;

  /* auto orientation: the marked-walls compass, falling back to the polygon's
     longest exposed edge. Shown unless the user overrides the dropdown.

     Plain, not a `useMemo`, and that is the whole point: `markedWalls` is
     rebuilt every render, so memoising this by hand needed a joined-string
     stand-in as its dependency and a suppression to admit the mismatch — and
     a `react-hooks` suppression makes React Compiler skip the entire
     component. The compiler memoises this correctly on its own, deriving what
     it actually depends on. The result is a string union, so nothing downstream
     cares about its identity either way. */
  const autoOri: Orientation =
    (poly ? orientationFromWalls(poly, markedWalls, floor?.northDeg ?? 0) : null) ??
    (poly ? detectOrientation(poly, floor?.northDeg ?? 0) : null) ??
    "N";

  const [overridden, setOverridden] = useState<boolean>(
    Boolean(room?.props.orientationLocked)
  );
  const [draft, setDraft] = useState<Draft>(() => {
    const p = (room?.props ?? {}) as Record<string, unknown>;
    return {
      name: String(p.name ?? "Room"),
      glazing: (p.glazing as GlazingLevel) ?? "moderate",
      condition: (p.condition as RoomCondition) ?? "standard",
      ceilingHeightM: typeof p.ceilingHeightM === "number" ? p.ceilingHeightM : 2.4,
      orientation: (p.orientation as Orientation) ?? "N",
    };
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  /* The height field keeps its OWN text state. Binding the input straight to
     the number (`value={String(draft.ceilingHeightM)}` + parseFloat on every
     keystroke) ate the decimal point: typing "2." reparsed to 2 and the dot
     vanished, so you could never reach "2.4" — and the volume/load calc ran
     on whole metres. The text survives intermediate states ("", "2."); the
     draft only takes a valid positive number; blur normalises. */
  const [heightText, setHeightText] = useState(() => String(draft.ceilingHeightM));

  /* the effective orientation: user's pick when overridden, else auto */
  const orientation: Orientation = overridden ? draft.orientation : autoOri;

  const zone = parseInt(doc.settings.climateZone ?? "", 10);
  const activeZone = Number.isFinite(zone) ? zone : 5;
  const buildingType =
    (doc.settings.buildingType as BuildingType) ?? "residential";
  const wm2 = baseWm2({ climateZone: activeZone, buildingType });

  const loadKw = useMemo(() => {
    if (areaM2 == null) return null;
    return roomHeatLoadKw({
      areaM2,
      climateZone: activeZone,
      buildingType,
      glazing: draft.glazing,
      condition: draft.condition,
      ceilingHeightM: draft.ceilingHeightM,
      orientation,
      hasExternalWalls,
    });
  }, [areaM2, activeZone, buildingType, draft, orientation, hasExternalWalls]);

  const noSolar = !hasExternalWalls;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* drag the modal by its header so it can be moved off a plan detail you want
     to read underneath it */
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const dragStart = useRef<{ px: number; py: number; dx: number; dy: number } | null>(null);
  const onHeadPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return; // not on controls
    dragStart.current = { px: e.clientX, py: e.clientY, dx: drag.dx, dy: drag.dy };
    const onMove = (ev: PointerEvent) => {
      const s = dragStart.current;
      if (s) setDrag({ dx: s.dx + (ev.clientX - s.px), dy: s.dy + (ev.clientY - s.py) });
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const save = () => {
    onMutate((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        o.id === roomId
          ? {
              ...o,
              props: {
                ...o.props,
                name: draft.name.trim() || "Room",
                glazing: draft.glazing,
                condition: draft.condition,
                ceilingHeightM: draft.ceilingHeightM,
                orientation,
                orientationLocked: overridden,
                // external-wall state stays tied to the marked walls (canvas)
                // inputs are stored; the load is derived (recomputes on zone change)
                configured: true,
              },
            }
          : o
      ),
    }));
    onClose();
  };

  /* jump back to the canvas to re-mark which walls are external — persist the
     current inputs first so nothing typed here is lost */
  const remark = () => {
    save();
    onRemarkWalls?.(roomId);
  };

  /* back to the canvas to resize or move the room — it's pinned once saved, so
     this is the only way to move it (field feedback 2026-07-25) */
  const reshape = () => {
    save();
    onEditShape?.(roomId);
  };

  if (!room || room.geometry.kind !== "polygon") return null;

  const isEdit = Boolean(room.props.configured);

  const body = (
    <div
      className="ds-rm-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="ds-rm"
        role="dialog"
        aria-modal="true"
        aria-label="Configure room"
        style={{ transform: `translate(${drag.dx}px, ${drag.dy}px)` }}
      >
        <header className="ds-rm-head ds-rm-drag" onPointerDown={onHeadPointerDown}>
          <div className="ds-rm-title">
            <span className={`ds-rm-mode${isEdit ? " edit" : ""}`}>
              {isEdit ? "Edit" : "New"}
            </span>
            <b>{draft.name || "Room"}</b>
          </div>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-rm-body">
          {/* name + quick-pick chips */}
          <div className="ds-rm-field">
            <span>Room name</span>
            <input
              autoFocus
              className="ds-rm-name"
              autoComplete="off"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Living / Dining"
            />
            <div className="ds-rm-chips">
              {NAME_CHIPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ds-rm-chip"
                  onClick={() => set("name", s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* dimensions as formulas — floor space then volume. Width & length
              are measured from the drawn shape; height is typed inline. */}
          <div className="ds-rm-dims">
            <div className="ds-rm-dimrow">
              <span className="ds-rm-dimcap">Floor space</span>
              <div className="ds-rm-dimexpr">
                {areaM2 == null ? (
                  <span className="ds-rm-dimna">calibrate the floor to measure</span>
                ) : dims && isRect ? (
                  <>
                    <span>{trimM(dims.w)} m</span>
                    <b className="op">×</b>
                    <span>{trimM(dims.l)} m</span>
                    <b className="op">=</b>
                    <b>{trimM(areaM2)} m²</b>
                  </>
                ) : (
                  <b>{trimM(areaM2)} m²</b>
                )}
              </div>
            </div>
            <div className="ds-rm-dimrow">
              <span className="ds-rm-dimcap">Volume</span>
              <div className="ds-rm-dimexpr">
                <span className="ds-rm-hin-wrap">
                  <input
                    className="ds-rm-hin"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Ceiling height (m)"
                    value={heightText}
                    onChange={(e) => {
                      const t = e.target.value;
                      // digits with at most one dot — lets "" and "2." stand
                      // while typing toward "2.4"
                      if (!/^\d*\.?\d*$/.test(t)) return;
                      setHeightText(t);
                      const v = parseFloat(t);
                      if (Number.isFinite(v) && v > 0) set("ceilingHeightM", v);
                    }}
                    onBlur={() => {
                      const v = parseFloat(heightText);
                      const h = Number.isFinite(v) && v > 0 ? v : 2.4;
                      set("ceilingHeightM", h);
                      setHeightText(String(h));
                    }}
                  />
                  m
                </span>
                {areaM2 != null && draft.ceilingHeightM ? (
                  <>
                    <b className="op">×</b>
                    <span>{trimM(areaM2)} m²</span>
                    <b className="op">=</b>
                    <b>{trimM(areaM2 * draft.ceilingHeightM)} m³</b>
                  </>
                ) : (
                  <span className="ds-rm-dimna">enter height</span>
                )}
              </div>
            </div>
            {onOpenReference && (
              <button type="button" className="ds-rm-reflink" onClick={onOpenReference}>
                <Icon name="library" size={12} />
                Height not on the plan? Check the reference sheets
              </button>
            )}
          </div>

          {/* glazing / condition / orientation */}
          <div className="ds-rm-grid3 ds-rm-grid3-top">
            <label className="ds-rm-field">
              <span>
                Glazing
                <i className="ds-tip tip-l" data-tip={TIP_GLAZING}>
                  i
                </i>
              </span>
              <select
                value={draft.glazing}
                onChange={(e) => set("glazing", e.target.value as GlazingLevel)}
              >
                {GLAZING.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ds-rm-field">
              <span>
                Condition
                <i className="ds-tip" data-tip={TIP_CONDITION}>
                  i
                </i>
              </span>
              <select
                value={draft.condition}
                onChange={(e) => set("condition", e.target.value as RoomCondition)}
              >
                {CONDITION.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <div className={`ds-rm-field${noSolar ? " off" : ""}`}>
              <span>
                Orientation
                <i className="ds-tip tip-r" data-tip={TIP_ORIENT}>
                  i
                </i>
              </span>
              <select
                aria-label="Orientation"
                value={orientation}
                disabled={noSolar}
                onChange={(e) => {
                  set("orientation", e.target.value as Orientation);
                  setOverridden(true);
                }}
              >
                {ORIENTATIONS.map((o) => (
                  <option key={o} value={o}>
                    {ORIENT_LABELS[o]} ×{ORIENT_MULT[o].toFixed(2)}
                  </option>
                ))}
              </select>
              <div className="ds-rm-orient-foot">
                {noSolar ? (
                  <span className="ds-rm-badge muted">Internal</span>
                ) : overridden ? (
                  <>
                    <span className="ds-rm-badge override">Override</span>
                    <button
                      type="button"
                      className="ds-rm-badge-reset"
                      onClick={() => setOverridden(false)}
                      title="Reset to auto"
                    >
                      ↺ Auto
                    </button>
                  </>
                ) : (
                  <span className="ds-rm-badge auto">Auto – walls</span>
                )}
              </div>
            </div>
          </div>

          {/* marked external walls */}
          {onRemarkWalls && (
            <button type="button" className="ds-rm-remark" onClick={remark}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <rect x="1" y="1" width="12" height="12" rx="1.5" />
                <path d="M4 7h6M7 4v6" />
              </svg>
              {hasExternalWalls
                ? `${markedWalls.length} external wall${
                    markedWalls.length > 1 ? "s" : ""
                  } marked — click to edit`
                : "Mark external walls on canvas"}
            </button>
          )}

          {/* the room is PINNED to the plan once saved, so resizing / moving it
              is a deliberate trip back to the canvas — a stray pan can't drag a
              whole space any more (field feedback 2026-07-25) */}
          {onEditShape && (
            <button type="button" className="ds-rm-remark" onClick={reshape}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 4.5V2.5h2M9.5 2.5h2v2M11.5 9.5v2h-2M4.5 11.5h-2v-2" />
              </svg>
              Edit room shape — resize or move it on the plan
            </button>
          )}

          {noSolar && (
            <div className="ds-rm-note">
              No external walls marked — treated as an internal / party room (no
              solar gain, ×1.00).
            </div>
          )}

          {/* live heat load */}
          <div className="ds-rm-load">
            <div>
              <div className="ds-rm-load-t">Estimated heat load</div>
              <div className="ds-rm-load-sub">
                {areaM2 != null
                  ? `${trimM(areaM2)} m² · Zone ${activeZone} · ${wm2} W/m²`
                  : "Calibrate the floor to compute the load"}
              </div>
            </div>
            <div className="ds-rm-load-kw">
              {loadKw != null ? `${loadKw.toFixed(2)} kW` : "—"}
            </div>
          </div>
        </div>

        <footer className="ds-rm-foot">
          <button className="ds-rm-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ds-rm-btn primary" onClick={save}>
            Save room
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
