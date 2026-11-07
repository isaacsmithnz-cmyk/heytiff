"use client";

/* ROOMS IN THE RIGHT COLUMN (the next flow, boards 3 and 4 of the Studio
   rework mocks, https://claude.ai/artifact/Dohqw25XUuCwkHYcxLeWTU). They sit
   beside the plan, never over it, and replace the "Rooms Tiff found" dialog
   and the room dialog.

   RoomsPanel: the floor's rooms. What's on the plan, with each one's load,
   and what Tiff found that isn't yet, one press from a room. Two rooms
   picked with Shift join here. With Tiff off it is the rooms on the plan
   and the tools to draw one.

   RoomPanel: the picked room, every input of its load changed in place,
   each change its own undo, the load beside them the Studio's own
   (loads-room.ts), the same number the plan wears. */

import { Fade } from "@/components/parts/fade";
import { Tray } from "@/components/parts/tabs";
import type { DesignDocument } from "@/lib/studio/document";
import { boundsOfPoints, formatArea, isAxisAlignedRect, polygonArea, unitsToMeters } from "@/lib/studio/geometry";
import { ORIENT_LABELS, ORIENT_MULT, orientationFromWalls, type GlazingLevel, type Orientation, type RoomCondition } from "@/lib/studio/loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { canJoin, readHeightOf } from "@/lib/studio/room-edit";
import type { Suggestion } from "@/lib/studio/rooms-from-reading";
import { zoneIdsOf } from "@/lib/studio/zones";
import { Icon } from "@/components/shell/icon";

/** the column's way back: it names the screen behind */
function Back({ to, onBack }: { to?: string; onBack?: () => void }) {
  if (!to || !onBack) return null;
  return (
    <button type="button" className="ds-stack-back" onClick={onBack}>
      <Icon name="chevL" size={16} />
      {to}
    </button>
  );
}

const KIND_WORD: Partial<Record<Suggestion["kind"], string>> = {
  wet: "wet",
  circulation: "a hall",
  cupboard: "a cupboard",
  garage: "a garage",
};

const kw = (v: number | null) => (v == null ? "" : `${v.toFixed(1)} kW`);

export function RoomsPanel({
  doc,
  floorId,
  found,
  showAll,
  onShowAll,
  picked,
  onKeep,
  onOpen,
  onJoin,
  onApart,
  onDraw,
  onDone,
  back,
}: {
  /** the screen behind, by name */
  back?: string;
  doc: DesignDocument;
  floorId: string;
  found: Suggestion[];
  /** every room she found, or the living spaces only (the plan shows the same) */
  showAll: boolean;
  onShowAll: (all: boolean) => void;
  /** rooms picked together with Shift */
  picked: readonly string[];
  onKeep: (keys: string[]) => void;
  onOpen: (roomId: string) => void;
  onJoin: () => void;
  onApart: () => void;
  /** arm the room tool, to draw one */
  onDraw: () => void;
  onDone: () => void;
}) {
  const floor = doc.floors.find((f) => f.id === floorId);
  if (!floor) return null;
  const mm = floor.scaleMmPerUnit;
  const rooms = doc.objects.filter((o): o is RoomObj => o.type === "room" && o.floorId === floorId && o.geometry.kind === "polygon");
  const pickedRooms = picked.map((id) => rooms.find((r) => r.id === id)).filter((r): r is RoomObj => !!r);
  const lived = found.filter((s) => s.keep);
  const listed = showAll ? found : lived;
  const joinable = pickedRooms.length >= 2 && canJoin(doc, pickedRooms.map((r) => r.id));
  const m2 = (s: Suggestion) => (mm ? formatArea((polygonArea(s.points) * mm * mm) / 1e6) : "");

  return (
    <section className="ds-su ds-rp" aria-label="Rooms">
      <Back to={back} onBack={onDone} />
      <div className="ds-su-head">
        <h2>Rooms</h2>
      </div>
      <p className="ds-su-sub">{floor.name}</p>

      {pickedRooms.length >= 2 && (
        <div className="ds-su-grp">
          <div className="ds-su-row">
            <span className="v">
              <b>{pickedRooms.map((r) => String(r.props.name ?? "Room")).join(" and ")}</b>
            </span>
          </div>
          <div className="ds-su-row">
            <span className="v">
              {joinable
                ? `${mm ? `${formatArea(pickedRooms.reduce((t, r) => t + (roomAreaM2(doc, r) ?? 0), 0))} as one, ` : ""}named ${String(pickedRooms[0].props.name ?? "Room")}`
                : pickedRooms.length === 2
                  ? "These two don't touch"
                  : "These don't all touch"}
            </span>
          </div>
          <div className="ds-su-acts">
            {joinable && (
              <button type="button" className="ds-su-main" onClick={onJoin}>
                Join as one room
              </button>
            )}
            <button type="button" className="ds-su-second" onClick={onApart}>
              Keep them apart
            </button>
          </div>
        </div>
      )}

      <div className="ds-su-grp">
        <h3 className="ds-rp-h">On the plan</h3>
        {rooms.length ? (
          <ul className="ds-rp-list">
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" className="ds-rp-row" onClick={() => onOpen(r.id)}>
                  <span className="n">
                    <Fade>{String(r.props.name ?? "Room")}</Fade>
                  </span>
                  <span className="f">
                    {[roomAreaM2(doc, r) != null ? formatArea(roomAreaM2(doc, r)!) : "", kw(roomLoadKw(doc, r))].filter(Boolean).join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-rp-none">No rooms yet</p>
        )}
        <div className="ds-su-acts">
          <button type="button" className="ds-su-second" onClick={onDraw}>
            Draw a room
          </button>
        </div>
      </div>

      {found.length > 0 && (
        <div className="ds-su-grp">
          <h3 className="ds-rp-h">Tiff found</h3>
          {lived.length > 0 && (
            <div className="ds-su-acts">
              <button type="button" className="ds-su-main" disabled={!mm} onClick={() => onKeep(lived.map((s) => s.key))}>
                {lived.length === 1 ? `Keep ${lived[0].name}` : `Keep the ${lived.length} living spaces`}
              </button>
            </div>
          )}
          <ul className="ds-rp-list">
            {listed.map((s) => (
              <li key={s.key} className="ds-rp-found">
                <span className="n">
                  <Fade>{s.name}</Fade>
                </span>
                <span className="f">{[m2(s), KIND_WORD[s.kind]].filter(Boolean).join(", ")}</span>
                <button type="button" className="ds-rp-keep" disabled={!mm} onClick={() => onKeep([s.key])}>
                  Keep
                </button>
              </li>
            ))}
          </ul>
          {found.length > lived.length && (
            <div className="ds-su-acts">
              <button type="button" className="ds-su-second" onClick={() => onShowAll(!showAll)}>
                {showAll ? "Living spaces only" : `Show all ${found.length} Tiff found`}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="ds-su-fill" />
      <button type="button" className="ds-su-main" onClick={onDone}>
        Done
      </button>
    </section>
  );
}

const GLAZING: { value: GlazingLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
];
const CONDITION: { value: RoomCondition; label: string }[] = [
  { value: "poor", label: "Poor" },
  { value: "standard", label: "Standard" },
  { value: "well_insulated", label: "Good" },
];
const ABOVE = [
  { value: "roof", label: "Roof" },
  { value: "floor", label: "Another floor" },
] as const;

export function RoomPanel({
  doc,
  roomId,
  onMutate,
  onMarkWalls,
  onEditSystem,
  onDelete,
  back,
  onBack,
  onMove,
  onTakeOff,
  onAddTo,
}: {
  /** the screen behind, by name */
  back?: string;
  onBack?: () => void;
  /** this room to another system, or off the one it's on, or onto one */
  onMove?: (from: string, to: string) => void;
  onTakeOff?: (from: string) => void;
  onAddTo?: (to: string) => void;
  doc: DesignDocument;
  roomId: string;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** mark which walls are outside, on the plan */
  onMarkWalls: () => void;
  onEditSystem: (systemId: string) => void;
  onDelete: () => void;
}) {
  const room = doc.objects.find((o): o is RoomObj => o.id === roomId && o.type === "room" && o.geometry.kind === "polygon");
  if (!room) return null;
  const floor = doc.floors.find((f) => f.id === room.floorId);
  const mm = floor?.scaleMmPerUnit ?? null;
  const pts = room.geometry.points;
  const p = room.props;
  const set = (props: Record<string, unknown>) =>
    onMutate((d) => ({ ...d, objects: d.objects.map((o) => (o.id === roomId ? { ...o, props: { ...o.props, ...props } } : o)) }));

  const area = roomAreaM2(doc, room);
  const load = roomLoadKw(doc, room);
  const b = boundsOfPoints(pts);
  const size =
    mm && b && area != null
      ? isAxisAlignedRect(pts, 1)
        ? `${unitsToMeters(b.maxX - b.minX, mm).toFixed(1)} × ${unitsToMeters(b.maxY - b.minY, mm).toFixed(1)} m, ${formatArea(area)}`
        : `${formatArea(area)}, ${pts.length} corners`
      : "Set the scale first";
  const walls = Array.isArray(p.externalWalls) ? (p.externalWalls as number[]) : [];
  const height = typeof p.ceilingHeightM === "number" ? p.ceilingHeightM : null;
  const read = floor ? readHeightOf(doc, floor.id, String(p.name ?? "")) : null;
  const facing = (p.orientation as Orientation | undefined) ?? (walls.length ? orientationFromWalls(pts, walls, floor?.northDeg ?? 0) : null);
  const owner = doc.systems.find((s) => zoneIdsOf(s).includes(roomId));
  const heads = doc.objects.filter((o) => o.type === "unit" && o.props.roomId === roomId).map((o) => String(o.props.model ?? ""));

  return (
    <section className="ds-su ds-rp" aria-label={String(p.name ?? "Room")}>
      <Back to={back} onBack={onBack} />
      <div className="ds-rp-name">
        <input
          className="ds-rp-name-in"
          aria-label="Name"
          value={String(p.name ?? "")}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <p className="ds-su-sub">{[floor?.name, owner?.name].filter(Boolean).join(", ")}</p>
      <div className="ds-rp-load">
        <b>{load != null ? kw(load) : "No load yet"}</b>
        {load != null && area ? <span>{`${Math.round((load * 1000) / area)} W/m² on ${formatArea(area)}`}</span> : null}
      </div>

      <div className="ds-su-grp">
        <div className="ds-su-row">
          <span className="k">Size</span>
          <span className="v">{size}</span>
        </div>
        <div className="ds-su-row">
          <span className="k">Height</span>
          <span className="v ds-rp-height">
            <input
              className="ds-rp-num"
              aria-label="Ceiling height in metres"
              inputMode="decimal"
              defaultValue={height != null ? String(height) : ""}
              placeholder="2.4"
              key={`${roomId}-${height}`}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (v > 1.8 && v < 12 && v !== height) set({ ceilingHeightM: v, heightFrom: null });
              }}
            />
            m
          </span>
        </div>
        {height != null && p.heightFrom ? <p className="ds-rp-from">From {String(p.heightFrom)}</p> : null}
        {read && read.m !== height && (
          <div className="ds-su-acts">
            <button type="button" className="ds-su-second" onClick={() => set({ ceilingHeightM: read.m, heightFrom: read.from })}>
              Use {read.m} m, from {read.from}
            </button>
          </div>
        )}
        <div className="ds-su-row ds-rp-tray">
          <span className="k">Above</span>
          <span className="v">
            <Tray
              ariaLabel="Above the room"
              options={ABOVE}
              value={p.roomAbove === true ? "floor" : "roof"}
              onChange={(v) => set({ roomAbove: v === "floor" })}
            />
          </span>
        </div>
        <div className="ds-su-row ds-rp-tray">
          <span className="k">Glazing</span>
          <span className="v">
            <Tray ariaLabel="Glazing" options={GLAZING} value={(p.glazing as GlazingLevel) ?? "moderate"} onChange={(v) => set({ glazing: v })} />
          </span>
        </div>
        <div className="ds-su-row ds-rp-tray">
          <span className="k">Insulation</span>
          <span className="v">
            <Tray ariaLabel="Insulation" options={CONDITION} value={(p.condition as RoomCondition) ?? "standard"} onChange={(v) => set({ condition: v })} />
          </span>
        </div>
      </div>

      <div className="ds-su-grp">
        <div className="ds-su-row">
          <span className="k">Outside</span>
          <span className="v">{walls.length ? (walls.length === 1 ? "1 wall" : `${walls.length} walls`) : "None, an inside room"}</span>
        </div>
        <div className="ds-su-row">
          <span className="k">Facing</span>
          <span className="v">{facing ? `${ORIENT_LABELS[facing]}, ×${ORIENT_MULT[facing].toFixed(2)}` : "Not set"}</span>
        </div>
        <div className="ds-su-acts">
          <button type="button" className="ds-su-second" onClick={onMarkWalls}>
            Mark walls on the plan
          </button>
        </div>
      </div>

      <div className="ds-su-grp">
        <div className="ds-su-row">
          <span className="k">Served by</span>
          <span className="v">{heads.length ? heads.join(", ") : owner ? owner.name : "Nothing yet"}</span>
        </div>
        {owner && (
          <div className="ds-su-acts">
            <button type="button" className="ds-su-second" onClick={() => onEditSystem(owner.id)}>
              Edit {owner.name}
            </button>
            {onTakeOff && (
              <button type="button" className="ds-su-second" onClick={() => onTakeOff(owner.id)}>
                Take off {owner.name}
              </button>
            )}
            {onMove &&
              doc.systems
                .filter((s) => s.id !== owner.id)
                .map((s) => (
                  <button key={s.id} type="button" className="ds-su-second" onClick={() => onMove(owner.id, s.id)}>
                    Move to {s.name}
                  </button>
                ))}
          </div>
        )}
        {!owner && onAddTo && doc.systems.length > 0 && (
          <div className="ds-su-acts">
            {doc.systems.map((s) => (
              <button key={s.id} type="button" className="ds-su-second" onClick={() => onAddTo(s.id)}>
                Add to {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ds-su-fill" />
      <button type="button" className="ds-su-second ds-rp-del" onClick={onDelete}>
        Delete room
      </button>
    </section>
  );
}

