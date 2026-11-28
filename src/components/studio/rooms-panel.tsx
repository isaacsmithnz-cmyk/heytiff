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

import { Tray } from "@/components/parts/tabs";
import type { DesignDocument } from "@/lib/studio/document";
import { boundsOfPoints, formatArea, isAxisAlignedRect, polygonArea, unitsToMeters } from "@/lib/studio/geometry";
import { ORIENT_LABELS, ORIENT_MULT, orientationFromWalls, type GlazingLevel, type Orientation, type RoomCondition } from "@/lib/studio/loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { canJoin, readHeightOf } from "@/lib/studio/room-edit";
import type { Suggestion } from "@/lib/studio/rooms-from-reading";
import { zoneIdsOf } from "@/lib/studio/zones";
import { kwWords } from "@/lib/studio/system-rows";
import { useRef } from "react";
import { Tick } from "@/components/parts/tick";
import { leftOutRooms } from "@/lib/studio/left-out";
import { markHand, type KeptField } from "@/lib/studio/building-kept";
import { StackDot, StackGroup, StackHead, StackRow, StackScreen } from "./stack";

const KIND_WORD: Partial<Record<Suggestion["kind"], string>> = {
  wet: "wet",
  circulation: "a hall",
  cupboard: "a cupboard",
  garage: "a garage",
};

const kw = kwWords;

export function RoomsPanel({
  doc,
  floorId,
  found,
  showAll,
  onShowAll,
  picked,
  onPick,
  onKeep,
  onOpen,
  onJoin,
  onApart,
  onPutBack,
  combining,
  onCombining,
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
  /** zones picked to combine, here or on the plan */
  picked: readonly string[];
  onPick: (ids: string[]) => void;
  onKeep: (keys: string[]) => void;
  onOpen: (roomId: string) => void;
  onJoin: () => void;
  onApart: () => void;
  /** these left-out zones back on the design (left-out.ts) */
  onPutBack: (ids: string[]) => void;
  /** Combine is on: a tick on each zone */
  combining: boolean;
  onCombining: (on: boolean) => void;
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
  const out = leftOutRooms(doc).filter((o) => o.floorId === floorId);
  const m2 = (s: Suggestion) => (mm ? formatArea((polygonArea(s.points) * mm * mm) / 1e6) : "");
  const colourOf = (id: string) => doc.systems.find((x) => zoneIdsOf(x).includes(id))?.colour ?? null;
  const name = (r: { props: Record<string, unknown> }) => String(r.props.name ?? "Zone");

  /* COMBINE (Isaac, 20 November 2026: "combine rooms/areas button", "zones
     sorry", then "combine could be ticks"): a tick on each zone, here or on
     the plan, and Combine makes them one zone with one load */
  if (combining) {
    const toggle = (id: string, on: boolean) => onPick(on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id));
    return (
      <StackScreen
        label="Combine zones"
        foot={
          <button type="button" className="ds-stack-main" disabled={!joinable} onClick={onJoin}>
            {pickedRooms.length >= 2 ? `Combine ${pickedRooms.length} zones` : "Combine"}
          </button>
        }
      >
        <StackHead
          name="Zones"
          nav={{
            label: "Cancel",
            onPress: () => {
              onApart();
              onCombining(false);
            },
          }}
        />
        {pickedRooms.length >= 2 && !joinable ? (
          <StackGroup>
            <StackRow danger name={pickedRooms.length === 2 ? "These two don't touch" : "These don't all touch"} />
          </StackGroup>
        ) : null}
        <StackGroup>
          {rooms.map((r) => (
            <StackRow
              key={r.id}
              lead={<Tick checked={picked.includes(r.id)} onChange={(on) => toggle(r.id, on)} label={<span className="sr-only">{name(r)}</span>} />}
              name={name(r)}
              value={kw(roomLoadKw(doc, r))}
            />
          ))}
        </StackGroup>
      </StackScreen>
    );
  }

  return (
    <StackScreen label="Zones">
      <StackHead back={back} onBack={onDone} name="Zones" nav={rooms.length >= 2 ? { label: "Combine", onPress: () => onCombining(true) } : undefined} />
      {rooms.length > 0 && (
        <StackGroup>
          {rooms.map((r) => {
            const c = colourOf(r.id);
            return (
              <StackRow
                key={r.id}
                lead={c ? <StackDot colour={c} /> : <span className="ds-stack-dot" aria-hidden="true" />}
                name={name(r)}
                value={kw(roomLoadKw(doc, r))}
                chevron
                onPress={() => onOpen(r.id)}
              />
            );
          })}
        </StackGroup>
      )}
      {found.length > 0 && (
        <StackGroup>
          {lived.length > 1 && <StackRow blue name={`Add the ${lived.length} living spaces Tiff read`} onPress={() => onKeep(lived.map((x) => x.key))} />}
          {listed.map((x) => (
            <StackRow key={x.key} name={x.name} sub={["Read by Tiff, not drawn", m2(x), KIND_WORD[x.kind]].filter(Boolean).join(", ")}>
              <button type="button" className="ds-stack-navact" disabled={!mm} onClick={() => onKeep([x.key])}>
                Add
              </button>
            </StackRow>
          ))}
          {found.length > lived.length && (
            <StackRow blue name={showAll ? "Living spaces only" : `All ${found.length} Tiff read`} onPress={() => onShowAll(!showAll)} />
          )}
        </StackGroup>
      )}
      {out.length > 0 && (
        <StackGroup>
          {out.map((o) => (
            <StackRow key={o.id} name={name(o)} sub="Left out">
              <button type="button" className="ds-stack-navact" onClick={() => onPutBack([o.id])}>
                Put back
              </button>
            </StackRow>
          ))}
        </StackGroup>
      )}
    </StackScreen>
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
  onLeaveOut,
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
  /** off the design, kept to put back (left-out.ts); absent on a room a system has */
  onLeaveOut?: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const room = doc.objects.find((o): o is RoomObj => o.id === roomId && o.type === "room" && o.geometry.kind === "polygon");
  if (!room) return null;
  const floor = doc.floors.find((f) => f.id === room.floorId);
  const mm = floor?.scaleMmPerUnit ?? null;
  const pts = room.geometry.points;
  const p = room.props;
  /* a value set here is the person's, and the building's (building-kept.ts):
     `fields` marked set by hand, `back` no longer (gone back to the plans') */
  const setByHand = (props: Record<string, unknown>, fields: KeptField[], back: KeptField[] = []) =>
    onMutate((d) => ({ ...d, objects: d.objects.map((o) => (o.id === roomId ? { ...o, props: markHand({ ...o.props, ...props }, fields, back) } : o)) }));

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

  const others = owner ? doc.systems.filter((x) => x.id !== owner.id) : [];

  /* A ZONE, AS A PHONE'S SCREEN (the bar and panel mock, "Yes, build it",
     21 November 2026): its heat load first, the number every sizing is
     checked against; its unit with Swap; what the load is made of; its
     system, with Move or Take off; then Leave out and Delete zone. */
  return (
    <div className="ds-zone">
      <StackScreen label={String(p.name ?? "Zone")}>
        <StackHead
          back={back}
          onBack={onBack}
          name={<input ref={nameRef} className="ds-stack-titlein" aria-label="Name" value={String(p.name ?? "")} onChange={(e) => setByHand({ name: e.target.value }, ["name"])} />}
          nav={{ label: "Rename", onPress: () => nameRef.current?.select() }}
        />
        <StackGroup>
          <StackRow
            name="Heat load"
            sub={load != null && area ? `${Math.round((load * 1000) / area)} W/m² on ${formatArea(area)}` : size}
            value={load != null ? kw(load) : "Not measured"}
            strong
          />
        </StackGroup>
        {heads.length > 0 || owner ? (
          <StackGroup>
            {heads.map((m, i) => (
              <StackRow key={i} name={m || "Unit"}>
                {owner ? (
                  <button type="button" className="ds-stack-navact" onClick={() => onEditSystem(owner.id)}>
                    Swap
                  </button>
                ) : null}
              </StackRow>
            ))}
            {heads.length === 0 && owner ? <StackRow name="No unit" tone="look" value="" /> : null}
          </StackGroup>
        ) : null}
        <StackGroup>
          <StackRow name="Size" value={size} />
          <StackRow name="Height">
            <span className="ds-rp-height">
              <input
                className="ds-rp-num"
                aria-label="Ceiling height in metres"
                inputMode="decimal"
                defaultValue={height != null ? String(height) : ""}
                placeholder="2.4"
                key={`${roomId}-${height}`}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (v > 1.8 && v < 12 && v !== height) setByHand({ ceilingHeightM: v, heightFrom: null }, ["ceilingMm"]);
                }}
              />
              m
            </span>
          </StackRow>
          {read && read.m !== height ? (
            <StackRow blue name={`Use ${read.m} m, from ${read.from}`} onPress={() => setByHand({ ceilingHeightM: read.m, heightFrom: read.from }, [], ["ceilingMm"])} />
          ) : null}
          <StackRow name="Above">
            <Tray ariaLabel="Above the zone" options={ABOVE} value={p.roomAbove === true ? "floor" : "roof"} onChange={(v) => setByHand({ roomAbove: v === "floor" }, ["roomAbove"])} />
          </StackRow>
          <StackRow name="Glazing">
            <Tray ariaLabel="Glazing" options={GLAZING} value={(p.glazing as GlazingLevel) ?? "moderate"} onChange={(v) => setByHand({ glazing: v }, ["glazing"])} />
          </StackRow>
          <StackRow name="Insulation">
            <Tray ariaLabel="Insulation" options={CONDITION} value={(p.condition as RoomCondition) ?? "standard"} onChange={(v) => setByHand({ condition: v }, ["condition"])} />
          </StackRow>
          <StackRow
            name="Outside walls"
            value={walls.length ? `${walls.length}${facing ? `, facing ${ORIENT_LABELS[facing].toLowerCase()}, ×${ORIENT_MULT[facing].toFixed(2)}` : ""}` : "None"}
            chevron
            onPress={onMarkWalls}
          />
        </StackGroup>
        <StackGroup>
          <StackRow name="System" value={owner ? owner.name : "None"} />
          {owner && onTakeOff ? <StackRow blue name={`Take off ${owner.name}`} onPress={() => onTakeOff(owner.id)} /> : null}
          {owner && onMove ? others.map((x) => <StackRow key={x.id} blue name={`Move to ${x.name}`} onPress={() => onMove(owner.id, x.id)} />) : null}
          {!owner && onAddTo ? doc.systems.map((x) => <StackRow key={x.id} blue name={`Add to ${x.name}`} onPress={() => onAddTo(x.id)} />) : null}
        </StackGroup>
        <StackGroup>
          {onLeaveOut ? <StackRow blue name="Leave out" onPress={onLeaveOut} /> : null}
          <StackRow danger name="Delete zone" onPress={onDelete} />
        </StackGroup>
      </StackScreen>
    </div>
  );
}

