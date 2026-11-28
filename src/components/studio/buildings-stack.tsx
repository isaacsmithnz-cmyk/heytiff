"use client";

/* THE JOB'S BUILDINGS IN THE COLUMN (join 2, "the building": Isaac, 27
   November 2026, "Go head" to https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46,
   boards 3 and 4). Buildings lists the house and each building, its floors
   and zones, and where it sits against the house. A building's screen holds
   its name, its floor level against the house's ground floor, what's under
   it, where it joins the house, its floors and its zones, then Move zones
   here and Delete building. Placing it on the site comes with the pipe
   routes between buildings, next. */

import { useRef, useState } from "react";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { Menu } from "@/components/parts/menu";
import type { DesignDocument } from "@/lib/studio/document";
import { buildingsOf, floorRowName, HOUSE, levelWords, setBuilding, type BuildingView } from "@/lib/studio/buildings";
import { formatLevel } from "@/lib/studio/plans";
import { StackGroup, StackHead, StackRow, StackScreen } from "./stack";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameOf = (o: { props: Record<string, unknown> }) => String(o.props.name ?? "Zone");

/** what a building's row says under its name */
const subOf = (b: BuildingView) =>
  [b.building?.under ? `Over the ${b.building.under.toLowerCase()}` : plural(b.floors.length, "floor"), plural(b.zones.length, "zone")].join(", ");

export function BuildingsScreen({ doc, onBack, onOpen, onAdd }: { doc: DesignDocument; onBack: () => void; onOpen: (id: string) => void; onAdd: () => void }) {
  const list = buildingsOf(doc);
  return (
    <StackScreen label="Buildings">
      <StackHead back="Systems" onBack={onBack} name="Buildings" nav={{ label: "Add", onPress: onAdd }} />
      <StackGroup>
        {list.map((b) => (
          <StackRow
            key={b.id}
            wrap
            name={b.name}
            sub={subOf(b)}
            value={b.building ? levelWords(b.building.floorMm) : undefined}
            chevron
            onPress={() => onOpen(b.id)}
          />
        ))}
      </StackGroup>
    </StackScreen>
  );
}

export function BuildingScreen({
  doc,
  id,
  onBack,
  onMutate,
  onFloor,
  onOpenZone,
  onMoveHere,
  onDelete,
}: {
  doc: DesignDocument;
  /** a building's id, or HOUSE */
  id: string;
  onBack: () => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** that floor on the plan */
  onFloor: (floorId: string) => void;
  onOpenZone: (zoneId: string) => void;
  /** zones of another building's floor onto this one's */
  onMoveHere: () => void;
  onDelete: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const underRef = useRef<HTMLButtonElement>(null);
  const joinRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"under" | "join" | null>(null);
  /* Delete building asks once more: its floors go, and every zone on them */
  const [armed, setArmed] = useState(false);
  const list = buildingsOf(doc);
  const view = list.find((b) => b.id === id);
  if (!view) return null;
  const b = view.building;
  const house = list[0];

  const floorsGroup = (
    <StackGroup>
      {view.floors.map((f) => (
        <StackRow key={f.id} name={floorRowName(doc, f)} sub={plural(view.zones.filter((z) => z.floorId === f.id).length, "zone")} value={formatLevel(f.level)} chevron onPress={() => onFloor(f.id)} />
      ))}
    </StackGroup>
  );

  if (!b) {
    return (
      <StackScreen label="House">
        <StackHead back="Buildings" onBack={onBack} name="House" />
        {floorsGroup}
      </StackScreen>
    );
  }

  const set = (patch: Parameters<typeof setBuilding>[2]) => onMutate((d) => setBuilding(d, b.id, patch));
  const rename = (name: string) =>
    onMutate((d) => {
      const was = d.buildings?.find((x) => x.id === b.id)?.name;
      /* its first floor wears its name */
      const floors = d.floors.map((f) => (f.buildingId === b.id && f.name === was ? { ...f, name } : f));
      return setBuilding({ ...d, floors }, b.id, { name });
    });
  const up = (b.floorMm ?? 0) >= 0;
  const metres = b.floorMm ? Math.abs(b.floorMm) / 1000 : null;
  /* what could be under it, or where it joins: the house's zones, then the rooms she read on its floors */
  const words = [
    ...new Set(
      [
        ...house.zones.map(nameOf),
        ...house.floors.flatMap((f) => (doc.reading?.floors[f.id] ?? []).flatMap((r) => r.spaces.filter((s) => s.named).map((s) => s.name))),
      ].map((s) => s.trim()).filter(Boolean),
    ),
  ];
  const joinsAt = b.joinsAt ? house.zones.find((z) => z.id === b.joinsAt) : null;

  return (
    <StackScreen label={b.name}>
      <StackHead
        back="Buildings"
        onBack={onBack}
        name={<input ref={nameRef} className="ds-stack-titlein" aria-label="Name" value={b.name} onChange={(e) => rename(e.target.value)} />}
        nav={{ label: "Rename", onPress: () => nameRef.current?.select() }}
      />
      <StackGroup>
        <StackRow name="Floor level">
          <span className="ds-rp-height">
            <input
              className="ds-rp-num"
              aria-label="Floor level, metres from the house's ground floor"
              inputMode="decimal"
              defaultValue={metres != null ? String(metres) : ""}
              placeholder="0"
              key={`${b.id}-${b.floorMm}`}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                const mm = Number.isFinite(v) && v >= 0 && v < 30 ? Math.round(v * 1000) * (up ? 1 : -1) : null;
                if (mm !== (b.floorMm ?? null)) set({ floorMm: mm || null });
              }}
            />
            m
          </span>
        </StackRow>
        <StackRow name="From the house">
          <Tray
            ariaLabel="Up or down from the house's ground floor"
            options={[
              { value: "up", label: "Up" },
              { value: "down", label: "Down" },
            ]}
            value={up ? "up" : "down"}
            onChange={(v) => set({ floorMm: b.floorMm ? Math.abs(b.floorMm) * (v === "up" ? 1 : -1) : null })}
          />
        </StackRow>
        <StackRow name="Under it">
          <button ref={underRef} type="button" className="ds-stack-navact" aria-haspopup="listbox" onClick={() => setMenu("under")}>
            {b.under || "The ground"}
          </button>
        </StackRow>
        <StackRow name="Joins the house">
          <button ref={joinRef} type="button" className="ds-stack-navact" aria-haspopup="listbox" onClick={() => setMenu("join")}>
            {joinsAt ? `At ${nameOf(joinsAt)}` : "Stands apart"}
          </button>
        </StackRow>
        <StackRow name="On the site" value="Not placed yet" />
      </StackGroup>
      {floorsGroup}
      <StackGroup>
        {view.zones.map((z) => (
          <StackRow key={z.id} name={nameOf(z)} value={typeof z.props.readFloor === "string" ? `From ${floorRowName(doc, doc.floors.find((f) => f.id === z.props.readFloor) ?? view.floors[0])}` : undefined} chevron onPress={() => onOpenZone(z.id)} />
        ))}
        <StackRow blue name="Move zones here" onPress={onMoveHere} />
      </StackGroup>
      <StackGroup>
        {armed ? (
          <>
            <StackRow danger name={view.zones.length ? `Delete it and its ${plural(view.zones.length, "zone")}` : "Delete it"} onPress={onDelete} />
            <StackRow blue name="Keep it" onPress={() => setArmed(false)} />
          </>
        ) : (
          <StackRow danger name="Delete building" onPress={() => setArmed(true)} />
        )}
      </StackGroup>
      <Menu
        open={menu === "under"}
        anchor={underRef}
        onClose={() => setMenu(null)}
        kind="listbox"
        label="Under it"
        filter={words.length > 8}
        chosen={b.under ?? ""}
        items={[{ key: "", label: "The ground" }, ...words.map((w) => ({ key: w, label: w }))]}
        onSelect={(k) => {
          set({ under: k || null });
          setMenu(null);
        }}
      />
      <Menu
        open={menu === "join"}
        anchor={joinRef}
        onClose={() => setMenu(null)}
        kind="listbox"
        label="Joins the house"
        filter={house.zones.length > 8}
        chosen={b.joinsAt ?? ""}
        items={[{ key: "", label: "Stands apart" }, ...house.zones.map((z) => ({ key: z.id, label: nameOf(z) }))]}
        onSelect={(k) => {
          set({ joinsAt: k || null });
          setMenu(null);
        }}
      />
    </StackScreen>
  );
}

/** Zones of the other buildings' floors, a tick each, onto this building's
    floor: Move takes the ones ticked, with what's in them. */
export function MoveZonesScreen({
  doc,
  id,
  floorId,
  onMove,
  onCancel,
}: {
  doc: DesignDocument;
  id: string;
  /** the floor they go to */
  floorId: string;
  onMove: (zoneIds: string[]) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const list = buildingsOf(doc).filter((b) => b.id !== id);
  const tickedFloor = ticked.length ? doc.objects.find((o) => o.id === ticked[0])?.floorId : null;
  const toggle = (zid: string, on: boolean) => setTicked((t) => (on ? [...t.filter((x) => x !== zid), zid] : t.filter((x) => x !== zid)));
  const to = buildingsOf(doc).find((b) => b.id === id);
  return (
    <StackScreen
      label="Move zones"
      foot={
        <button type="button" className="ds-stack-main" disabled={ticked.length === 0} onClick={() => onMove([...ticked])}>
          {ticked.length ? `Move ${plural(ticked.length, "zone")}` : "Move"}
        </button>
      }
    >
      <StackHead name={`Into ${to?.name ?? "the building"}`} nav={{ label: "Cancel", onPress: onCancel }} />
      {list.flatMap((b) =>
        b.floors
          .filter((f) => f.id !== floorId)
          .map((f) => {
            const zs = b.zones.filter((z) => z.floorId === f.id);
            if (!zs.length) return null;
            /* one floor's at a time: they move with its sheet */
            const shut = tickedFloor != null && tickedFloor !== f.id;
            return (
              <StackGroup key={f.id}>
                <StackRow name={b.id === HOUSE ? `House, ${floorRowName(doc, f)}` : floorRowName(doc, f)} strong />
                {zs.map((z) => (
                  <StackRow key={z.id} name={nameOf(z)}>
                    <Tick checked={ticked.includes(z.id)} disabled={shut} onChange={(v) => toggle(z.id, v)} label={<span className="sr-only">{nameOf(z)}</span>} />
                  </StackRow>
                ))}
              </StackGroup>
            );
          }),
      )}
    </StackScreen>
  );
}
