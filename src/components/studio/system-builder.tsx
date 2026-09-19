"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import { sizingCapacityKw, type SizingBasis } from "@/lib/studio/loads";
import type { RoomObj } from "@/lib/studio/loads-room";
import { polygonCentroid } from "@/lib/studio/geometry";
import { multiCapableIdus } from "@/lib/studio/multi";
import { UnitBrowser, type UnitChoice } from "./unit-browser";
import {
  addMultiHead,
  addSplit,
  adoptLegacySystem,
  allocationsOf,
  chooseOutdoor,
  hasAllocations,
  moveAllocation,
  outdoorsListing,
  removeAllocation,
  roomVerdict,
  swapAllocation,
  systemCheck,
  type Allocation,
  type RoomWord,
} from "@/lib/studio/builder";

/* The system builder (spec: Studio System Builder, stage 2). It replaces the
   units window on the builder flag: the unit browser on top — the same
   selector the units window was, tabs, search, filters, sections and spec
   sheet (unit-browser.tsx, embedded) — the job's rooms underneath as a
   schematic, and nothing touches the plan until Continue.

   It edits a DRAFT of the design. Continue hands the draft back as one change
   (one undo step); Discard drops it. Every rule it shows comes from builder.ts
   — this file lays out and wires, it does not decide. */

type Kind = "split" | "multi";

type Selection =
  | { type: "unit"; systemId: string; allocationId: string }
  | { type: "outdoor"; systemId: string }
  | null;

/** what a unit carries through a drag onto a room square */
type CardPayload =
  | { kind: "split"; iduModel: string; oduModel: string }
  | { kind: "multi"; iduModel: string };

const DRAG_TYPE = "application/x-heytiff-builder-unit";

const WORD_CLASS: Record<RoomWord, string> = {
  Fits: "ok",
  Undersized: "bad",
  Oversized: "warn",
  Calibrate: "quiet",
  "No units": "quiet",
};

/** a row of the browser, as the thing it drops into a room */
const payloadFor = (choice: UnitChoice): CardPayload =>
  choice.kind === "pair"
    ? { kind: "split", iduModel: choice.pair.idu.model, oduModel: choice.pair.odu.model }
    : { kind: "multi", iduModel: choice.idu.model };

/* How much of the window the unit list takes, the schematic the rest —
   dragged on the edge between them and kept for next time on this device. */
const SPLIT_KEY = "heytiff.studio.builderSplit";
const SPLIT_DEFAULT = 58;
const clampSplit = (pct: number) => Math.min(80, Math.max(25, Math.round(pct)));
function readSplit(): number {
  try {
    const v = Number(window.localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(v) && v > 0 ? clampSplit(v) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

const kwText = (kw: number | null | undefined): string =>
  kw == null ? "" : `${kw.toFixed(1)} kW`;

/* ─────────────────────────── schematic layout ─────────────────────────── */

const PAD = 24;
const ROOM_W = 184;
const ROOM_GAP = 16;
const FLOOR_GAP = 32;
const OUT_W = 176;
const OUT_H = 64;
const OUT_TOP = 16;
const UNIT_H = 56;
const UNIT_GAP = 8;
const ROOM_HEAD = 52;
const ROOM_FOOT = 36;

interface RoomBox {
  room: RoomObj;
  x: number;
  y: number;
  w: number;
  h: number;
  /** where the room's words start: past the lines running down its left edge */
  textX: number;
  floorName: string | null;
}
interface UnitBox {
  sys: DesignSystem;
  alloc: Allocation;
  x: number;
  y: number;
  w: number;
  gutterX: number;
}
interface OutBox {
  sys: DesignSystem;
  alloc: Allocation | null;
  x: number;
  y: number;
}

function layout(doc: DesignDocument, rooms: RoomObj[]) {
  const systems = doc.systems.filter(hasAllocations);
  const unitsIn = (roomId: string) =>
    systems.flatMap((sys) =>
      allocationsOf(sys)
        .filter((a) => a.role === "idu" && a.roomId === roomId && a.model)
        .map((alloc) => ({ sys, alloc }))
    );
  /* a head whose room is gone — the room deleted on the plan after the unit
     was built into it — still belongs to its system; it waits in a square of
     its own for a room to be chosen */
  const roomIds = new Set(rooms.map((r) => r.id));
  const homeless = systems.flatMap((sys) =>
    allocationsOf(sys)
      .filter((a) => a.role === "idu" && a.model && (!a.roomId || !roomIds.has(a.roomId)))
      .map((alloc) => ({ sys, alloc }))
  );

  const maxUnits = Math.max(1, homeless.length, ...rooms.map((r) => unitsIn(r.id).length));
  const lanes = systems.reduce(
    (n, s) => n + allocationsOf(s).filter((a) => a.role === "idu").length,
    0
  );
  const roomsTop = OUT_TOP + OUT_H + 16 + Math.max(2, lanes) * 8 + 16;
  const roomH = ROOM_HEAD + maxUnits * (UNIT_H + UNIT_GAP) + ROOM_FOOT;

  const multiFloor = doc.floors.length > 1;
  const roomBoxes: RoomBox[] = [];
  const unitBoxes: UnitBox[] = [];
  let x = PAD;
  let lastFloor: string | null = null;
  const placeUnits = (here: { sys: DesignSystem; alloc: Allocation }[], boxX: number) => {
    const gutter = 8 + here.length * 8;
    here.forEach(({ sys, alloc }, j) => {
      unitBoxes.push({
        sys,
        alloc,
        x: boxX + gutter + 4,
        y: roomsTop + ROOM_HEAD + j * (UNIT_H + UNIT_GAP),
        w: ROOM_W - gutter - 16,
        gutterX: boxX + 8 + j * 8,
      });
    });
    return gutter;
  };
  for (const room of rooms) {
    if (lastFloor != null && room.floorId !== lastFloor) x += FLOOR_GAP - ROOM_GAP;
    const firstOnFloor = room.floorId !== lastFloor;
    lastFloor = room.floorId;
    const floor = doc.floors.find((f) => f.id === room.floorId);
    const here = unitsIn(room.id);
    const gutter = placeUnits(here, x);
    roomBoxes.push({
      room,
      x,
      y: roomsTop,
      w: ROOM_W,
      h: roomH,
      textX: x + Math.max(12, gutter + 4),
      floorName: multiFloor && firstOnFloor ? (floor?.name ?? null) : null,
    });
    x += ROOM_W + ROOM_GAP;
  }
  let homelessBox: Omit<RoomBox, "room" | "floorName"> | null = null;
  if (homeless.length) {
    const gutter = placeUnits(homeless, x);
    homelessBox = { x, y: roomsTop, w: ROOM_W, h: roomH, textX: x + gutter + 4 };
    x += ROOM_W + ROOM_GAP;
  }

  /* outdoors: centred over their heads, pushed right so none overlap */
  const wanted = systems.map((sys) => {
    const mine = unitBoxes.filter((u) => u.sys.id === sys.id);
    const cx = mine.length
      ? mine.reduce((a, u) => a + u.gutterX, 0) / mine.length
      : PAD + OUT_W / 2;
    return { sys, cx };
  });
  wanted.sort((a, b) => a.cx - b.cx);
  const outBoxes: OutBox[] = [];
  let right = PAD - 12;
  for (const w of wanted) {
    const ox = Math.max(w.cx - OUT_W / 2, right + 12);
    outBoxes.push({
      sys: w.sys,
      alloc: allocationsOf(w.sys).find((a) => a.role === "odu") ?? null,
      x: ox,
      y: OUT_TOP,
    });
    right = ox + OUT_W;
  }

  const width = Math.max(x - ROOM_GAP + PAD, right + PAD, 480);
  const height = roomsTop + roomH + PAD;
  return { roomBoxes, homelessBox, unitBoxes, outBoxes, width, height, roomsTop };
}

/* ─────────────────────────── the window ─────────────────────────── */

export function SystemBuilder({
  doc,
  pack,
  focus,
  systemId = null,
  start: startFrom,
  onCommit,
  onClose,
}: {
  doc: DesignDocument;
  pack: DataPack;
  /** open on this unit — Swap from the plan (an outdoor opens its detail) */
  focus?: { systemId: string; allocationId: string } | null;
  /** the zones flow: the one system being built (its zones are given) */
  systemId?: string | null;
  /** the zones flow: a draft to start from instead of the design — a zone
      moved onto this system whose units it cannot take, so Done is off until
      it can and Discard changes undoes the move */
  start?: DesignDocument;
  /** Done: the built design, as one change */
  onCommit: (next: DesignDocument) => void;
  onClose: () => void;
}) {
  const basis: SizingBasis = doc.settings.sizingBasis;

  /* the draft starts with any split or multi made before the builder turned
     into allocations — placed units keep their ids (adoptLegacySystem) */
  const [start] = useState<DesignDocument>(() =>
    (startFrom ?? doc).systems.reduce((d, s) => adoptLegacySystem(d, pack, s.id), startFrom ?? doc)
  );
  void systemId;
  const [draft, setDraft] = useState<DesignDocument>(start);
  const [error, setError] = useState<string | null>(null);

  const rooms = useMemo(() => {
    const floorOrder = new Map(draft.floors.map((f, i) => [f.id, i]));
    return draft.objects
      .filter((o): o is RoomObj => o.type === "room" && o.geometry.kind === "polygon")
      .map((r) => ({ r, c: polygonCentroid(r.geometry.points) }))
      .sort(
        (a, b) =>
          (floorOrder.get(a.r.floorId) ?? 0) - (floorOrder.get(b.r.floorId) ?? 0) ||
          a.c.y - b.c.y ||
          a.c.x - b.c.x
      )
      .map((x) => x.r);
  }, [draft]);

  const focusedSystem = focus ? draft.systems.find((s) => s.id === focus.systemId) : undefined;
  const focusedAlloc = focusedSystem
    ? allocationsOf(focusedSystem).find((a) => a.id === focus!.allocationId)
    : undefined;
  /* an outdoor goes by its first head's room */
  const focusedRoom = focusedSystem
    ? (focusedAlloc?.roomId ??
      allocationsOf(focusedSystem).find((a) => a.role === "idu" && a.roomId)?.roomId ??
      null)
    : null;

  const [kind, setKind] = useState<Kind>(focusedSystem?.type === "multi-split" ? "multi" : "split");
  const [targetRoomId, setTargetRoomId] = useState<string | null>(
    focusedRoom ?? rooms[0]?.id ?? null
  );
  const [selected, setSelected] = useState<Selection>(() =>
    !focus || !focusedAlloc
      ? null
      : focusedAlloc.role === "odu"
        ? { type: "outdoor", systemId: focus.systemId }
        : { type: "unit", systemId: focus.systemId, allocationId: focus.allocationId }
  );
  /** which multi a head joins: an id, "new" for another multi, or null (auto) */
  const [multiTarget, setMultiTarget] = useState<string | "new" | null>(null);

  const dirty = draft !== start;

  const [split, setSplit] = useState<number>(readSplit);
  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      /* private window: the split just isn't remembered */
    }
  }, [split]);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const panes = panesRef.current;
    if (!panes) return;
    e.preventDefault();
    const edge = e.currentTarget;
    edge.setPointerCapture(e.pointerId);
    const box = panes.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(clampSplit(((ev.clientY - box.top) / box.height) * 100));
    const up = () => {
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", up);
      edge.removeEventListener("pointercancel", up);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up);
    edge.addEventListener("pointercancel", up);
  };

  /* Esc closes only when there is nothing to lose — and never while the
     browser's comparison is open over it, which Esc closes first */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dirty && !document.querySelector(".ds-cmp-overlay")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onClose]);

  const verdicts = useMemo(() => {
    const m = new Map<string, ReturnType<typeof roomVerdict>>();
    for (const r of rooms) m.set(r.id, roomVerdict(draft, pack, basis, r));
    return m;
  }, [draft, pack, basis, rooms]);

  const target = rooms.find((r) => r.id === targetRoomId) ?? null;
  const targetVerdict = target ? verdicts.get(target.id) : undefined;
  /* what the target room still needs; a covered room ranks nothing */
  const shortKw =
    targetVerdict?.loadKw != null ? targetVerdict.loadKw - targetVerdict.coverKw : null;
  const remainingKw = shortKw != null && shortKw > 0.05 ? shortKw : null;

  const multis = draft.systems.filter((s) => s.type === "multi-split" && hasAllocations(s));

  /* ── writes ── */
  const add = (roomId: string, payload: CardPayload) => {
    setError(null);
    if (payload.kind === "split") {
      const r = addSplit(draft, pack, {
        roomId,
        iduModel: payload.iduModel,
        oduModel: payload.oduModel,
      });
      setDraft(r.doc);
      return;
    }
    const joins =
      multiTarget === "new"
        ? null
        : multiTarget && multis.some((m) => m.id === multiTarget)
          ? multiTarget
          : (multis.find((m) => allocationsOf(m).some((a) => a.roomId === roomId))?.id ??
            multis[multis.length - 1]?.id ??
            null);
    const r = addMultiHead(draft, pack, basis, {
      systemId: joins,
      roomId,
      iduModel: payload.iduModel,
    });
    setDraft(r.doc);
    setMultiTarget(r.systemId);
  };

  const onDropRoom = (roomId: string, e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try {
      add(roomId, JSON.parse(raw) as CardPayload);
      setTargetRoomId(roomId);
    } catch {
      /* a payload from somewhere else — not a unit card */
    }
  };

  const layoutBoxes = useMemo(() => layout(draft, rooms), [draft, rooms]);

  const selectedSystem =
    selected ? draft.systems.find((s) => s.id === selected.systemId) ?? null : null;
  const selectedAlloc =
    selected?.type === "unit" && selectedSystem
      ? allocationsOf(selectedSystem).find((a) => a.id === selected.allocationId) ?? null
      : null;

  const unitCount = draft.systems
    .filter(hasAllocations)
    .reduce((n, s) => n + allocationsOf(s).filter((a) => a.model).length, 0);

  const body = (
    <div className="ds-sb-scrim" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose()}>
      <div className="ds-sb" role="dialog" aria-modal="true" aria-labelledby="ds-sb-title">
        <header className="ds-sb-head">
          <div className="ds-sb-titles">
            <h2 id="ds-sb-title" className="ds-sb-title">
              Build systems
            </h2>
            <p className="ds-sb-facts">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"}, {unitCount}{" "}
              {unitCount === 1 ? "unit" : "units"}
            </p>
          </div>
          <div className="ds-sb-kind" role="radiogroup" aria-label="System type">
            {(["split", "multi"] as const).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={kind === k}
                className={`ds-sb-kind-opt${kind === k ? " on" : ""}`}
                onClick={() => setKind(k)}
              >
                {k === "split" ? "Split" : "Multi"}
              </button>
            ))}
          </div>
          {target && (
            <p className="ds-sb-target">
              {String(target.props.name ?? "Room")}
              {targetVerdict?.loadKw == null
                ? ": no heat load yet"
                : remainingKw != null
                  ? `: ${remainingKw.toFixed(1)} kW still needed of ${targetVerdict.loadKw.toFixed(1)} kW`
                  : `: covered, ${targetVerdict.coverKw.toFixed(1)} kW for ${targetVerdict.loadKw.toFixed(1)} kW`}
            </p>
          )}
          <button className="ds-sb-x" onClick={onClose} aria-label="Close builder without saving">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-sb-panes" ref={panesRef}>
          <section className="ds-sb-browser" aria-label="Units" style={{ flexBasis: `${split}%` }}>
            <UnitBrowser
              embedded
              pack={pack}
              loadKw={remainingKw}
              basis={basis}
              mode={kind === "split" ? "pair" : "per-room"}
              addLabel={target ? `Add to ${String(target.props.name ?? "room")}` : "Add"}
              onChoose={(choice) => {
                if (target) add(target.id, payloadFor(choice));
              }}
              onDragRow={(choice, transfer) => {
                transfer.setData(DRAG_TYPE, JSON.stringify(payloadFor(choice)));
                transfer.effectAllowed = "copy";
              }}
            />
          </section>

          <div
            className="ds-sb-divider"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Unit list and schematic"
            aria-valuenow={split}
            aria-valuemin={25}
            aria-valuemax={80}
            tabIndex={0}
            onPointerDown={dragSplit}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                setSplit((v) => clampSplit(v + (e.key === "ArrowDown" ? 5 : -5)));
              }
            }}
          />

          <div className="ds-sb-work">
            <section className="ds-sb-schematic" aria-label="Schematic">
              {rooms.length === 0 ? (
                <div className="ds-sb-none">
                  <p>Draw a room on the plan first — each room becomes a square here.</p>
                </div>
              ) : (
                <Schematic
                  draft={draft}
                  pack={pack}
                  boxes={layoutBoxes}
                  verdicts={verdicts}
                  basis={basis}
                  targetRoomId={targetRoomId}
                  selected={selected}
                  onTarget={(id) => {
                    setTargetRoomId(id);
                    setSelected(null);
                  }}
                  onSelect={setSelected}
                  onDropRoom={onDropRoom}
                />
              )}
            </section>
            {selected && selectedSystem && (
              <aside className="ds-sb-detail" aria-label="Selected">
                {selected.type === "unit" && selectedAlloc ? (
                  <UnitDetail
                    draft={draft}
                    pack={pack}
                    basis={basis}
                    rooms={rooms}
                    sys={selectedSystem}
                    alloc={selectedAlloc}
                    onChange={(d, err) => {
                      setError(err ?? null);
                      if (d) setDraft(d);
                    }}
                    onRemoved={() => setSelected(null)}
                  />
                ) : selected.type === "outdoor" ? (
                  <OutdoorDetail
                    draft={draft}
                    pack={pack}
                    basis={basis}
                    sys={selectedSystem}
                    onChoose={(model) => setDraft(chooseOutdoor(draft, pack, basis, selectedSystem.id, model))}
                  />
                ) : null}
              </aside>
            )}
          </div>
        </div>

        <footer className="ds-sb-foot">
          {kind === "multi" && multis.length > 0 && (
            <button
              className={`ds-sb-btn${multiTarget === "new" ? " on" : ""}`}
              aria-pressed={multiTarget === "new"}
              onClick={() => setMultiTarget(multiTarget === "new" ? null : "new")}
            >
              Start another multi
            </button>
          )}
          {error && (
            <p className="ds-sb-error" role="alert">
              {error}
            </p>
          )}
          <span className="ds-sb-spring" />
          {dirty && (
            <button className="ds-sb-btn" onClick={onClose}>
              Discard changes
            </button>
          )}
          <button
            className="ds-sb-btn primary"
            onClick={() => (dirty ? onCommit(draft) : onClose())}
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/* ─────────────────────────── the schematic ─────────────────────────── */

function Schematic({
  draft,
  pack,
  boxes,
  verdicts,
  basis,
  targetRoomId,
  selected,
  onTarget,
  onSelect,
  onDropRoom,
}: {
  draft: DesignDocument;
  pack: DataPack;
  boxes: ReturnType<typeof layout>;
  verdicts: Map<string, ReturnType<typeof roomVerdict>>;
  basis: SizingBasis;
  targetRoomId: string | null;
  selected: Selection;
  onTarget: (roomId: string) => void;
  onSelect: (s: Selection) => void;
  onDropRoom: (roomId: string, e: React.DragEvent) => void;
}) {
  const { roomBoxes, homelessBox, unitBoxes, outBoxes, width, height } = boxes;
  const [over, setOver] = useState<string | null>(null);
  const iduRow = (m: string) => pack.indoor_units.find((u) => u.model === m);
  const oduRow = (m: string) => pack.outdoor_units.find((u) => u.model === m);

  /* one lane per head, so no two lines share a horizontal run */
  let lane = 0;
  const lanesTop = OUT_TOP + OUT_H + 24;

  return (
    <svg
      className="ds-sb-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Schematic of the rooms and the systems serving them"
    >
      {/* lines first, under everything */}
      {outBoxes.map((ob) => {
        const heads = unitBoxes.filter((u) => u.sys.id === ob.sys.id);
        return heads.map((u, i) => {
          const exitX = ob.x + ((i + 1) * OUT_W) / (heads.length + 1);
          const laneY = lanesTop + lane++ * 8;
          const midY = u.y + UNIT_H / 2;
          return (
            <path
              key={`${ob.sys.id}:${u.alloc.id}`}
              className="ds-sb-line"
              style={{ stroke: ob.sys.colour }}
              d={`M${exitX} ${ob.y + OUT_H} V${laneY} H${u.gutterX} V${midY} H${u.x}`}
            />
          );
        });
      })}

      {roomBoxes.map((rb) => {
        const v = verdicts.get(rb.room.id);
        const isTarget = rb.room.id === targetRoomId;
        return (
          <g
            key={rb.room.id}
            className={`ds-sb-room${isTarget ? " target" : ""}${over === rb.room.id ? " over" : ""}`}
            onClick={() => onTarget(rb.room.id)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (over !== rb.room.id) setOver(rb.room.id);
            }}
            onDragLeave={() => setOver((o) => (o === rb.room.id ? null : o))}
            onDrop={(e) => {
              setOver(null);
              onDropRoom(rb.room.id, e);
            }}
          >
            {rb.floorName && (
              <text className="ds-sb-floor" x={rb.x} y={rb.y - 12}>
                {rb.floorName}
              </text>
            )}
            <rect className="ds-sb-room-box" x={rb.x} y={rb.y} width={rb.w} height={rb.h} rx={10} />
            <text className="ds-sb-room-name" x={rb.textX} y={rb.y + 22}>
              {String(rb.room.props.name ?? "Room")}
            </text>
            <text className="ds-sb-room-load" x={rb.textX} y={rb.y + 40}>
              {v?.loadKw != null ? `Needs ${v.loadKw.toFixed(1)} kW` : "No heat load yet"}
            </text>
            {v && (
              <>
                <text className={`ds-sb-room-word ${WORD_CLASS[v.word]}`} x={rb.textX} y={rb.y + rb.h - 14}>
                  {v.word}
                </text>
                {v.coverKw > 0 && (
                  <text className="ds-sb-room-load" x={rb.x + rb.w - 12} y={rb.y + rb.h - 14} textAnchor="end">
                    {v.coverKw.toFixed(1)} kW
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}

      {homelessBox && (
        <g className="ds-sb-room homeless">
          <rect
            className="ds-sb-room-box"
            x={homelessBox.x}
            y={homelessBox.y}
            width={homelessBox.w}
            height={homelessBox.h}
            rx={10}
          />
          <text className="ds-sb-room-name" x={homelessBox.textX} y={homelessBox.y + 22}>
            No room
          </text>
        </g>
      )}

      {unitBoxes.map((u) => {
        const row = iduRow(u.alloc.model);
        const isSel = selected?.type === "unit" && selected.allocationId === u.alloc.id;
        return (
          <g
            key={u.alloc.id}
            className={`ds-sb-unit${isSel ? " sel" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ type: "unit", systemId: u.sys.id, allocationId: u.alloc.id });
            }}
          >
            <rect x={u.x} y={u.y} width={u.w} height={UNIT_H} rx={6} style={{ stroke: u.sys.colour }} />
            <text className="ds-sb-unit-model" x={u.x + 8} y={u.y + 18}>
              {u.alloc.model}
            </text>
            <text className="ds-sb-unit-fact" x={u.x + 8} y={u.y + 34}>
              {row ? kwText(sizingCapacityKw(row, basis)) : ""}
            </text>
            <text className="ds-sb-unit-fact" x={u.x + 8} y={u.y + 49}>
              {pipeText(pack, u.sys, u.alloc)}
            </text>
          </g>
        );
      })}

      {outBoxes.map((ob) => {
        const check = systemCheck(draft, pack, basis, ob.sys);
        const row = ob.alloc?.model ? oduRow(ob.alloc.model) : undefined;
        const isSel = selected?.type === "outdoor" && selected.systemId === ob.sys.id;
        const rooms = new Set(
          allocationsOf(ob.sys)
            .filter((a) => a.role === "idu" && a.roomId)
            .map((a) => a.roomId)
        ).size;
        const second =
          ob.sys.type === "split"
            ? "Split"
            : `${row ? kwText(sizingCapacityKw(row, basis)) + ", " : ""}${rooms >= 2 ? "shared" : "multi"}`;
        return (
          <g
            key={ob.sys.id}
            className={`ds-sb-out${isSel ? " sel" : ""}${check.listed ? "" : " refused"}`}
            onClick={() => onSelect({ type: "outdoor", systemId: ob.sys.id })}
          >
            <rect x={ob.x} y={ob.y} width={OUT_W} height={OUT_H} rx={10} style={{ stroke: ob.sys.colour }} />
            <text className="ds-sb-out-model" x={ob.x + OUT_W / 2} y={ob.y + 20} textAnchor="middle">
              {ob.alloc?.model || "No outdoor lists this set"}
            </text>
            <text className="ds-sb-unit-fact" x={ob.x + OUT_W / 2} y={ob.y + 37} textAnchor="middle">
              {second}
            </text>
            {check.kind === "multi" && (
              <text
                className={`ds-sb-room-word ${check.listed ? "ok" : "bad"}`}
                x={ob.x + OUT_W / 2}
                y={ob.y + 55}
                textAnchor="middle"
              >
                {check.listed ? "In the table" : "Not in the table"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** the pipe a unit's line is labelled with: a split's pairing, a multi head's
    own connection (the port takes an adapter) */
function pipeText(pack: DataPack, sys: DesignSystem, alloc: Allocation): string {
  if (sys.type === "split") {
    const odu = allocationsOf(sys).find((a) => a.role === "odu")?.model;
    const pair = pack.pair_tables.find((p) => p.idu_model === alloc.model && p.odu_model === odu);
    return pair ? `${pair.pipe_liquid_mm} / ${pair.pipe_gas_mm} mm` : "";
  }
  const u = pack.indoor_units.find((x) => x.model === alloc.model);
  return u ? `${u.conn_liquid_mm} / ${u.conn_gas_mm} mm` : "";
}

/* ─────────────────────────── detail panes ─────────────────────────── */

function UnitDetail({
  draft,
  pack,
  basis,
  rooms,
  sys,
  alloc,
  onChange,
  onRemoved,
}: {
  draft: DesignDocument;
  pack: DataPack;
  basis: SizingBasis;
  rooms: RoomObj[];
  sys: DesignSystem;
  alloc: Allocation;
  onChange: (next: DesignDocument | null, error?: string) => void;
  onRemoved: () => void;
}) {
  const room = rooms.find((r) => r.id === alloc.roomId) ?? null;
  const current = pack.indoor_units.find((u) => u.model === alloc.model) ?? null;

  /* the sizes it could be: the same series, units this system type can take */
  const candidates = useMemo((): IndoorUnit[] => {
    if (!current) return [];
    const pool =
      sys.type === "split"
        ? pack.indoor_units.filter((u) => pack.pair_tables.some((p) => p.idu_model === u.model))
        : multiCapableIdus(pack);
    return pool
      .filter((u) => u.series === current.series)
      .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model));
  }, [pack, sys.type, current]);

  const rows = useMemo(
    () =>
      candidates.map((u) => {
        if (u.model === alloc.model) {
          return { u, doc: draft, ok: true as boolean, reason: undefined as string | undefined };
        }
        const r = swapAllocation(draft, pack, basis, sys.id, alloc.id, u.model);
        return { u, doc: r.doc, ok: r.ok, reason: r.reason };
      }),
    [candidates, draft, pack, basis, sys.id, alloc.id, alloc.model]
  );

  return (
    <div className="ds-sb-pane">
      <h3 className="ds-sb-pane-title">{alloc.model}</h3>
      <p className="ds-sb-facts">
        {room ? String(room.props.name ?? "Room") : "No room"}, {sys.name}
      </p>
      <label className="ds-sb-field">
        <span>Room</span>
        <select
          value={room ? room.id : ""}
          onChange={(e) => onChange(moveAllocation(draft, sys.id, alloc.id, e.target.value))}
        >
          {!room && (
            <option value="" disabled>
              No room
            </option>
          )}
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {String(r.props.name ?? "Room")}
            </option>
          ))}
        </select>
      </label>
      <button
        className="ds-sb-btn"
        onClick={() => {
          onChange(removeAllocation(draft, sys.id, alloc.id, pack));
          onRemoved();
        }}
      >
        Remove unit
      </button>
      {rows.length > 1 && (
        <div className="ds-sb-sizes">
          <span className="ds-sb-label">Sizes</span>
          <ul>
            {rows.map(({ u, doc: after, ok, reason }) => {
              const isCurrent = u.model === alloc.model;
              const verdict = room && ok ? roomVerdict(after, pack, basis, room) : null;
              const afterSys = after.systems.find((s) => s.id === sys.id);
              const check = afterSys && ok ? systemCheck(after, pack, basis, afterSys) : null;
              const beforeOdu = allocationsOf(sys).find((a) => a.role === "odu")?.model ?? "";
              const afterOdu = afterSys ? (allocationsOf(afterSys).find((a) => a.role === "odu")?.model ?? "") : "";
              return (
                <li key={u.model}>
                  <button
                    className={`ds-sb-size${isCurrent ? " current" : ""}`}
                    disabled={isCurrent || !ok}
                    onClick={() => onChange(after)}
                  >
                    <span className="ds-sb-size-model">{u.model}</span>
                    <span className="ds-sb-size-kw">{kwText(sizingCapacityKw(u, basis))}</span>
                    {isCurrent ? (
                      <span className="ds-sb-word quiet">Current</span>
                    ) : !ok ? (
                      <span className="ds-sb-word bad">{reason}</span>
                    ) : (
                      <>
                        {verdict && <span className={`ds-sb-word ${WORD_CLASS[verdict.word]}`}>{verdict.word}</span>}
                        {check?.kind === "multi" && !check.listed && (
                          <span className="ds-sb-word bad">Not in any table</span>
                        )}
                        {check?.kind === "multi" && check.listed && afterOdu !== beforeOdu && (
                          <span className="ds-sb-word warn">Outdoor becomes {afterOdu}</span>
                        )}
                        {sys.type === "split" && afterOdu !== beforeOdu && (
                          <span className="ds-sb-word quiet">With {afterOdu}</span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function OutdoorDetail({
  draft,
  pack,
  basis,
  sys,
  onChoose,
}: {
  draft: DesignDocument;
  pack: DataPack;
  basis: SizingBasis;
  sys: DesignSystem;
  onChoose: (model: string) => void;
}) {
  const check = systemCheck(draft, pack, basis, sys);
  const allocs = allocationsOf(sys);
  const odu = allocs.find((a) => a.role === "odu")?.model ?? "";
  if (check.kind === "split") {
    const idu = allocs.find((a) => a.role === "idu")?.model ?? "";
    return (
      <div className="ds-sb-pane">
        <h3 className="ds-sb-pane-title">{odu}</h3>
        <p className="ds-sb-facts">Paired with {idu}, {sys.name}</p>
      </div>
    );
  }
  const heads = allocs
    .filter((a) => a.role === "idu" && a.model)
    .map((a) => pack.indoor_units.find((u) => u.model === a.model))
    .filter((u): u is IndoorUnit => u != null);
  const listing = outdoorsListing(pack, heads);
  /* a refused set: the heads it would be listed without */
  const without =
    listing.length === 0 && heads.length > 1
      ? [
          ...new Set(
            heads
              .filter((_, i) => outdoorsListing(pack, heads.filter((__, j) => j !== i)).length > 0)
              .map((h) => h.model)
          ),
        ]
      : [];
  return (
    <div className="ds-sb-pane">
      <h3 className="ds-sb-pane-title">{odu || "No outdoor lists this set"}</h3>
      <p className="ds-sb-facts">
        {check.headCount} {check.headCount === 1 ? "head" : "heads"}, {sys.name}
      </p>
      <p className={`ds-sb-word ${check.listed ? "ok" : "bad"}`}>
        {check.listed ? "In the table" : "Not in the table"}
      </p>
      {listing.length > 0 ? (
        <div className="ds-sb-sizes">
          <span className="ds-sb-label">Outdoors that list this set</span>
          <ul>
            {listing.map((o) => (
              <li key={o.model}>
                <button
                  className={`ds-sb-size${o.model === odu ? " current" : ""}`}
                  disabled={o.model === odu}
                  onClick={() => onChoose(o.model)}
                >
                  <span className="ds-sb-size-model">{o.model}</span>
                  <span className="ds-sb-size-kw">{kwText(sizingCapacityKw(o, basis))}</span>
                  {o.model === odu && <span className="ds-sb-word quiet">Current</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        without.map((m) => (
          <p key={m} className="ds-sb-facts">
            Listed without {m}
          </p>
        ))
      )}
    </div>
  );
}
