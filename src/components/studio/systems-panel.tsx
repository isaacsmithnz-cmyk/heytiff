/* The Design step's right panel in the zones flow (docs/studio-zones-and-
   systems.md): one card per system, Add a system, and the zones no system
   has claimed.

   One card is open at a time — the active system's. A card at rest is its
   name, type and brand, and one line saying where it is up to. The open card
   shows its zones (each a control: dragged to another card, or cleared with
   its cross), Add zones, the outdoor and the figures, and its last slot is
   always the next step: Build system, then the units to place, then Next:
   Install questions — the same words the toolbar's next-step chip says, so
   the two agree. Edit system sits under it, quiet, as the way back in.

   Units go on the plan by dragging, nothing else: the rack under the card
   works like a Scrabble rack. A unit dragged onto the plan leaves it, the
   rest close up, and when the last is down the rack is gone. The canvas
   commits whatever is armed, so a drag arms the unit on its way out, the way
   the bench tray did; the card stays mounted through the drag (Chrome ends a
   drag whose source unmounts).

   A zone dragged from one card onto another moves with its units (moveZone);
   dragged from Zones without a system onto a card it joins the system; a chip
   dropped on that list, like its cross, takes the zone off. Drop targets
   light on dragenter/dragleave counters, never :hover, which does not fire
   during a native drag. */

import { useCallback, useRef, useState, type DragEvent } from "react";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import { allocationsOf, hasAllocations, trayItems, type TrayItem } from "@/lib/studio/builder";
import { KIND_WORD, systemKind, systemZones, unclaimedZones } from "@/lib/studio/zones";
import { brandName, combinationWord, connectionRatio } from "@/lib/studio/verdict";
import { systemCover } from "@/lib/studio/coverage";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { cardStatus } from "@/lib/studio/status";
import { installState } from "@/lib/studio/install";
import { RACK_DRAG, type PlacingUnit } from "./canvas";

/** a zone on the move between cards: the drag's own type and payload */
export const ZONE_DRAG = "application/x-heytiff-zone";
interface ZonePayload {
  zoneId: string;
  /** the system it is leaving, or null from Zones without a system */
  from: string | null;
}

const zoneName = (z: RoomObj): string => String(z.props.name ?? "Zone");
const kwText = (kw: number | null): string => (kw == null ? "" : `${kw.toFixed(1)} kW`);

function GripGlyph() {
  return (
    <svg className="ds-zp-grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <circle cx="3" cy="4" r="1.4" />
      <circle cx="7" cy="4" r="1.4" />
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="7" cy="8" r="1.4" />
      <circle cx="3" cy="12" r="1.4" />
      <circle cx="7" cy="12" r="1.4" />
    </svg>
  );
}
function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function CrossGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const hasZoneDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes(ZONE_DRAG);
const readZoneDrag = (e: DragEvent): ZonePayload | null => {
  try {
    const raw = e.dataTransfer?.getData(ZONE_DRAG);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ZonePayload>;
    return typeof v.zoneId === "string" ? { zoneId: v.zoneId, from: typeof v.from === "string" ? v.from : null } : null;
  } catch {
    return null;
  }
};

export function SystemsPanel({
  doc,
  pack,
  basis,
  activeSystemId,
  onActivate,
  onAddSystem,
  onAddZones,
  onBuild,
  onInstall,
  onDeleteSystem,
  onArmPlace,
  onMoveZone,
  onClaimZone,
  onRemoveZone,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  activeSystemId: string | null;
  onActivate: (id: string | null) => void;
  onAddSystem: () => void;
  /** Add zones: the plan goes into claim mode for this system */
  onAddZones: (systemId: string) => void;
  /** Build system, and Edit system once a unit is in */
  onBuild: (systemId: string) => void;
  onInstall: (systemId: string) => void;
  /** the card's own Delete system — the builder's, without opening it */
  onDeleteSystem: (systemId: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onMoveZone: (zoneId: string, from: string, to: string) => void;
  onClaimZone: (zoneId: string, to: string) => void;
  onRemoveZone: (zoneId: string, from: string) => void;
}) {
  /* the open card the user rested by clicking its name */
  const [rested, setRested] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /* enter counters per target (a dragenter bubbles from every child) — read
     only inside the handlers, which take their target off the element */
  const counters = useRef(new Map<string, number>());
  const keyOf = (e: DragEvent): string => (e.currentTarget as HTMLElement).dataset.drop ?? "";
  const enter = useCallback((e: DragEvent) => {
    if (!hasZoneDrag(e)) return;
    const key = keyOf(e);
    const n = (counters.current.get(key) ?? 0) + 1;
    counters.current.set(key, n);
    setOver(key);
  }, []);
  const leave = useCallback((e: DragEvent) => {
    if (!hasZoneDrag(e)) return;
    const key = keyOf(e);
    const n = Math.max(0, (counters.current.get(key) ?? 0) - 1);
    counters.current.set(key, n);
    if (n === 0) setOver((o) => (o === key ? null : o));
  }, []);
  const allow = useCallback((e: DragEvent) => {
    if (!hasZoneDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const drop = useCallback(
    (e: DragEvent) => {
      const key = keyOf(e);
      counters.current.set(key, 0);
      setOver(null);
      const p = readZoneDrag(e);
      if (!p) return;
      e.preventDefault();
      if (key === "free") {
        if (p.from) onRemoveZone(p.zoneId, p.from);
        return;
      }
      const to = key.startsWith("sys:") ? key.slice(4) : "";
      if (!to || p.from === to) return;
      if (p.from) onMoveZone(p.zoneId, p.from, to);
      else onClaimZone(p.zoneId, to);
    },
    [onRemoveZone, onMoveZone, onClaimZone]
  );

  const free = unclaimedZones(doc);
  const openId = activeSystemId && rested !== activeSystemId ? activeSystemId : null;

  return (
    <div className="ds-zp">
      <div className="ds-zp-h">
        <span className="ds-zp-title">Systems</span>
        {doc.systems.length > 0 && (
          <button className="ds-zp-btn" onClick={onAddSystem}>
            <PlusGlyph />
            Add a system
          </button>
        )}
      </div>
      <div className="ds-zp-b">
        {doc.systems.length === 0 && (
          <button className="ds-zp-addsys" onClick={onAddSystem}>
            <PlusGlyph />
            Add a system
          </button>
        )}
        {doc.systems.map((sys) => (
          <SystemCard
            key={sys.id}
            doc={doc}
            pack={pack}
            basis={basis}
            sys={sys}
            open={openId === sys.id}
            over={over === `sys:${sys.id}`}
            onOpen={() => {
              setRested(null);
              onActivate(sys.id);
            }}
            onRest={() => setRested(sys.id)}
            onAddZones={() => onAddZones(sys.id)}
            onBuild={() => onBuild(sys.id)}
            onInstall={() => onInstall(sys.id)}
            onDelete={() => onDeleteSystem(sys.id)}
            onArmPlace={onArmPlace}
            onRemoveZone={(zoneId) => onRemoveZone(zoneId, sys.id)}
            onDragEnter={enter}
            onDragLeave={leave}
            onDragOver={allow}
            onDrop={drop}
          />
        ))}
        <div className="ds-zp-freewrap">
        <div className="ds-zp-lbl">Zones without a system</div>
        <div
          className={`ds-zp-free${over === "free" ? " drop" : ""}`}
          data-drop="free"
          onDragEnter={enter}
          onDragLeave={leave}
          onDragOver={allow}
          onDrop={drop}
        >
          {free.length === 0 && <div className="ds-zp-none">None</div>}
          {free.map((z) => (
            <div
              key={z.id}
              className="ds-zp-row"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ZONE_DRAG, JSON.stringify({ zoneId: z.id, from: null }));
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <GripGlyph />
              <span className="ds-zp-row-name">{zoneName(z)}</span>
              <span className="ds-zp-row-kw">{kwText(roomLoadKw(doc, z))}</span>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

function SystemCard({
  doc,
  pack,
  basis,
  sys,
  open,
  over,
  onOpen,
  onRest,
  onAddZones,
  onBuild,
  onInstall,
  onDelete,
  onArmPlace,
  onRemoveZone,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  sys: DesignSystem;
  open: boolean;
  over: boolean;
  onOpen: () => void;
  onRest: () => void;
  onAddZones: () => void;
  onBuild: () => void;
  onInstall: () => void;
  onDelete: () => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onRemoveZone: (zoneId: string) => void;
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const kind = systemKind(doc, sys);
  const zones = systemZones(doc, sys.id);
  const status = cardStatus(doc, pack, basis, sys);
  const units = hasAllocations(sys) ? allocationsOf(sys).filter((a) => a.model) : [];
  const rack = pack ? trayItems(doc, pack).filter((t) => t.systemId === sys.id) : [];
  const cover = pack && kind !== "empty" ? systemCover(doc, pack, sys, basis) : null;
  const ratio = pack ? connectionRatio(pack, sys) : null;
  const word = pack ? combinationWord(doc, pack, sys) : null;
  const odu = units.find((a) => a.role === "odu")?.model ?? null;
  const install = pack ? installState(doc, pack, sys) : "not-asked";

  return (
    <section
      className={`ds-zp-card${open ? " open" : ""}${over ? " drop" : ""}`}
      style={{ "--sc": sys.colour } as React.CSSProperties}
      aria-label={sys.name}
      data-drop={`sys:${sys.id}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="ds-zp-top">
        <span className="ds-zp-dot" aria-hidden="true" />
        <button className="ds-zp-name" aria-expanded={open} onClick={open ? onRest : onOpen}>
          {sys.name}
        </button>
        <span className="ds-zp-is">
          {kind !== "empty" && <span className="ds-zp-kind">{KIND_WORD[kind]}</span>}
          {pack && <span className="ds-zp-brand">{brandName(pack, sys.brand)}</span>}
        </span>
      </div>
      {!open && <div className={`ds-zp-status ${status.tone}`}>{status.text}</div>}
      {open && (
        <>
          <div className="ds-zp-zones">
            {zones.map((z) => (
              <span
                key={z.id}
                className="ds-zn"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ZONE_DRAG, JSON.stringify({ zoneId: z.id, from: sys.id }));
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                {zoneName(z)}
                <button
                  className="ds-zn-x"
                  aria-label={`Clear ${zoneName(z)} from ${sys.name}`}
                  onClick={() => onRemoveZone(z.id)}
                >
                  <CrossGlyph />
                </button>
              </span>
            ))}
            <button className="ds-zp-addzones" onClick={onAddZones}>
              <PlusGlyph />
              Add zones
            </button>
          </div>
          {kind !== "empty" && (
            <dl className="ds-zp-facts">
              {odu && (
                <>
                  <dt>Outdoor</dt>
                  <dd>{odu}</dd>
                </>
              )}
              {cover && (
                <>
                  <dt>Cover</dt>
                  <dd className="num">
                    {cover.coverKw.toFixed(1)} of {cover.loadKw == null ? "—" : cover.loadKw.toFixed(1)} kW
                    {cover.pct != null && cover.pct > 150 && <span className="warn">, oversized</span>}
                  </dd>
                </>
              )}
              {ratio && (
                <>
                  <dt>Connection ratio</dt>
                  <dd className="num">{ratio.pct}%</dd>
                </>
              )}
              {word && (
                <>
                  <dt>Combination</dt>
                  <dd className={word === "Valid" ? "ok" : "bad"}>{word}</dd>
                </>
              )}
            </dl>
          )}
          {status.tone === "bad" && <div className="ds-zp-status bad">{status.text}</div>}
          <div className="ds-zp-next">
            {kind === "empty" ? (
              <button className="ds-zp-primary" onClick={onBuild}>
                Build system
              </button>
            ) : (
              <>
                {rack.length ? (
                  <Rack pack={pack} items={rack} onArmPlace={onArmPlace} />
                ) : install !== "complete" ? (
                  <button className="ds-zp-primary" onClick={onInstall}>
                    Next: Install questions
                  </button>
                ) : null}
                <div className="ds-zp-acts">
                  <button className="ds-zp-wide" onClick={onBuild}>
                    Edit system
                  </button>
                  <button
                    className="ds-zp-del"
                    onClick={onDelete}
                    aria-label={`Delete ${sys.name}`}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** the units waiting for the plan: dragged out one at a time */
function Rack({
  pack,
  items,
  onArmPlace,
}: {
  pack: DataPack | null;
  items: TrayItem[];
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const kwOf = (item: TrayItem): number | null => {
    if (!pack) return null;
    const row =
      item.role === "idu"
        ? pack.indoor_units.find((u) => u.model === item.model)
        : pack.outdoor_units.find((u) => u.model === item.model);
    return row?.capacity_cool_kw ?? null;
  };
  return (
    <div className="ds-zp-rack">
      <div className="ds-zp-lbl">Units to place</div>
      {items.map((item) => {
        const kw = kwText(kwOf(item));
        const sub = item.role === "odu" ? ["Outdoor", kw].filter(Boolean).join(", ") : [item.label, kw].filter(Boolean).join(", ");
        return (
          <div
            key={item.key}
            className={`ds-zp-unit ${item.role}`}
            draggable
            onDragStart={(e) => {
              if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", item.model);
                e.dataTransfer.setData(RACK_DRAG, JSON.stringify(item.placing));
                e.dataTransfer.effectAllowed = "copy";
              }
              /* the canvas drops whatever is armed: arming on dragstart IS the drag */
              onArmPlace(item.placing);
            }}
            onDragEnd={() => onArmPlace(null)}
          >
            <GripGlyph />
            <span className="ds-zp-unit-dot" aria-hidden="true" />
            <span className="ds-zp-unit-body">
              <b>{item.model}</b>
              <span>{sub}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
