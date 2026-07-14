"use client";

/* Design Studio — System Cockpit (right-rail panel, v3).
   One uniform skeleton for every system type, imported pixel-faithfully from
   the dev handoff: Chrome-style system TABS above a white page, a dark ink
   HERO (type + load coverage), a Rooms/Components segmented SWITCH that slides,
   numbered room PILLS that load the INSPECT card (Configure · Units · Pipework),
   and a COMPONENTS list of the system-level parts.

   Split (1:1) is the live module. The skeleton is factored so multi-split /
   ducted / VRF drop into the same shape at their stages (the hero branches on
   moduleFor(type).summary; only "split" is wired here). All numbers come from
   the engines (coverage / split / components) — this file renders + arms
   intents, mutating through onMutate exactly as the old panel did. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type {
  DesignDocument,
  DesignObject,
  DesignSystem,
  Floor,
  SystemType,
} from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { polylineLength, unitsToMeters } from "@/lib/studio/geometry";
import type { SizingBasis } from "@/lib/studio/loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { roomsServedBy, roomCoverage, systemPairKw } from "@/lib/studio/coverage";
import type { PairProposal } from "@/lib/studio/split";
import { moduleFor } from "@/lib/studio/modules";
import {
  systemComponents,
  type ComponentIcon,
  type ComponentRow,
} from "@/lib/studio/components";
import { SystemTypeChooser } from "./system-type-chooser";
import { UnitBrowser } from "./unit-browser";
import type { PlacingUnit } from "./canvas";

/* one colour per system, cycled on creation (kept from the old SystemsPanel) */
const SYSTEM_COLOURS = ["#2E68FF", "#E4572E", "#17A398", "#9B5DE5", "#F5A623", "#D63384"];

/* ─────────────────────────── inline glyphs ───────────────────────────
   Exact 24×24 stroke paths from the handoff, so the cockpit reads identically.
   Container CSS sizes each svg; the width/height here are fallbacks. */
const GLYPHS: Record<string, { d: string; sw?: number; fill?: boolean }> = {
  idu: { d: '<rect x="3" y="7" width="18" height="7" rx="3"/><path d="M6 17.5c1.2-1.4 2.8-1.4 4 0M14 17.5c1.2-1.4 2.8-1.4 4 0"/>', sw: 1.8 },
  odu: { d: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 8.6v-.01M12 15.4v.01M8.6 12h-.01M15.4 12h.01"/>', sw: 1.8 },
  check: { d: '<path d="M20 6 9 17l-5-5"/>', sw: 3 },
  droplet: { d: '<path d="M12 3c3 4 6 7 6 10a6 6 0 0 1-12 0c0-3.2 3-6 6-10Z"/>', sw: 1.8 },
  bolt: { d: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', sw: 1.8 },
  mount: { d: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.9 2.9-2.5-2.5 2.4-3.4Z"/>', sw: 1.8 },
  branch: { d: '<rect x="3" y="9" width="18" height="6" rx="1.5"/><path d="M7 9V6M12 9V6M17 9V6M7 15v3M12 15v3M17 15v3"/>', sw: 1.8 },
  controller: { d: '<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="9" r="2.3"/><path d="M9.5 15h5"/>', sw: 1.8 },
  configure: { d: '<path d="M4 7h16M4 17h16"/><circle cx="10" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>', sw: 2 },
  unitsq: { d: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M4 12h16"/>', sw: 2 },
  pipes: { d: '<path d="M6 18V9a3 3 0 0 1 3-3h9"/>', sw: 2 },
  run: { d: '<path d="M5 19V9a2 2 0 0 1 2-2h12"/>', sw: 2 },
  riser: { d: '<path d="M12 19V5M5 12l7-7 7 7"/>', sw: 2 },
  edit: { d: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', sw: 2 },
  chev: { d: '<path d="m9 18 6-6-6-6"/>', sw: 2 },
  house: { d: '<path d="M3 21V8l9-5 9 5v13"/><path d="M3 13h18M9 21v-8"/>', sw: 1.7 },
  cube: { d: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 16l9 5 9-5M3 12l9 5 9-5"/>', sw: 1.7 },
  plus: { d: '<path d="M12 5v14M5 12h14"/>', sw: 2 },
  x: { d: '<path d="M18 6 6 18M6 6l12 12"/>', sw: 2.6 },
  alert: { d: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', sw: 2 },
  rotate: { d: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', sw: 2 },
};

function Glyph({ name, size = 16 }: { name: keyof typeof GLYPHS | ComponentIcon; size?: number }) {
  const g = GLYPHS[name] ?? GLYPHS.cube;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={g.sw ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: g.d }}
    />
  );
}

/* ─────────────────────────── root ─────────────────────────── */

export function SystemCockpit({
  doc,
  pack,
  packVersion,
  activeSystemId,
  onActivate,
  onMutate,
  selectedId,
  onSelect,
  onEditRoom,
  onArmPlace,
  onDrawRoom,
  floor,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  packVersion: string;
  activeSystemId: string | null;
  onActivate: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditRoom: (id: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onDrawRoom: () => void;
  floor: Floor;
}) {
  const [adding, setAdding] = useState(false);
  const [changingType, setChangingType] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const systems = doc.systems;
  const active = systems.find((s) => s.id === activeSystemId) ?? systems[0] ?? null;
  const basis: SizingBasis = doc.settings.sizingBasis;

  /* Type-first: create the system as the chosen module, then activate it. */
  const createSystem = (type: SystemType) => {
    const n = systems.length;
    const id = newId("sys");
    onMutate((d) => ({
      ...d,
      systems: [
        ...d.systems,
        {
          id,
          type,
          brand: "mitsubishi-electric",
          colour: SYSTEM_COLOURS[n % SYSTEM_COLOURS.length],
          name: `System ${n + 1}`,
          settings: {},
        },
      ],
      packPins: {
        ...d.packPins,
        "mitsubishi-electric": d.packPins["mitsubishi-electric"] ?? packVersion,
      },
    }));
    onActivate(id);
    setAdding(false);
  };

  /* change an existing system's type — units/pipework are type-specific so
     they're dropped and the pair cleared; the rooms it serves stay. */
  const changeType = (type: SystemType) => {
    setChangingType(false);
    if (!active || type === active.type) return;
    const sysId = active.id;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === sysId
          ? { ...s, type, settings: { ...s.settings, pairIdu: undefined, pairOdu: undefined } }
          : s
      ),
      objects: d.objects.filter(
        (o) =>
          !(
            o.systemId === sysId &&
            (o.type === "unit" || o.type === "pipe-run" || o.type === "riser")
          )
      ),
    }));
  };

  const deleteSystem = () => {
    if (!active) return;
    const sysId = active.id;
    onMutate((d) => ({
      ...d,
      systems: d.systems.filter((s) => s.id !== sysId),
      objects: d.objects.filter((o) => o.systemId !== sysId),
    }));
    onActivate(null);
    setConfirmDelete(false);
  };

  // no systems yet → the chooser is the whole panel (type-first entry)
  if (systems.length === 0) {
    return (
      <div className="ds-ck">
        <SystemTypeChooser onChoose={createSystem} />
      </div>
    );
  }

  const mod = active ? moduleFor(active.type) : null;
  const showChooser = adding || changingType;

  return (
    <div className="ds-ck">
      <CockpitTabs
        systems={systems}
        activeId={active?.id ?? null}
        onActivate={onActivate}
        onAdd={() => {
          setChangingType(false);
          setConfirmDelete(false);
          setAdding(true);
        }}
        onRequestClose={() => setConfirmDelete(true)}
      />

      {confirmDelete && (
        <div className="ds-ck-delwarn" role="alertdialog" aria-label="Delete system">
          <div className="ds-ck-delwarn-msg">
            <Icon name="alert" size={14} />
            This deletes the system and its objects.
          </div>
          <div className="ds-ck-delwarn-actions">
            <button onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="ds-ck-delwarn-go" onClick={deleteSystem}>
              Delete
            </button>
          </div>
        </div>
      )}

      {showChooser ? (
        <div className="ds-ck-scroll">
          <SystemTypeChooser
            heading={changingType ? "Change system type" : undefined}
            sub={changingType ? "Pick a different type — this clears the system's units" : undefined}
            onChoose={adding ? createSystem : changeType}
            onCancel={() => {
              setAdding(false);
              setChangingType(false);
            }}
          />
        </div>
      ) : active && mod && mod.available ? (
        <ActiveCockpit
          key={active.id}
          doc={doc}
          pack={pack}
          system={active}
          basis={basis}
          floor={floor}
          selectedId={selectedId}
          onSelect={onSelect}
          onMutate={onMutate}
          onEditRoom={onEditRoom}
          onArmPlace={onArmPlace}
          onDrawRoom={onDrawRoom}
          onChangeType={() => {
            setConfirmDelete(false);
            setAdding(false);
            setChangingType(true);
          }}
        />
      ) : active && mod && !mod.available ? (
        <>
          <SimpleHero label={mod.label} />
          <div className="ds-ck-scroll">
            <div className="ds-ck-coming">
              <div className="ct">{mod.label}</div>
              <div className="cs">
                This system type arrives at {mod.comingStage}. The room process works
                today; unit selection and materials come with the module.
              </div>
            </div>
          </div>
        </>
      ) : active && mod ? (
        <SimpleHero label={mod.label} />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── tabs ─────────────────────────── */

function CockpitTabs({
  systems,
  activeId,
  onActivate,
  onAdd,
  onRequestClose,
}: {
  systems: DesignSystem[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onAdd: () => void;
  onRequestClose: () => void;
}) {
  return (
    <div className="ds-ck-tabs" role="tablist" aria-label="Systems">
      {systems.map((s) => {
        const on = s.id === activeId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={on}
            className={`ds-ck-tab${on ? " on" : ""}`}
            onClick={() => onActivate(s.id)}
            title={`${s.name} · ${moduleFor(s.type).label}`}
          >
            <span className="ds-ck-tabdot" style={{ background: s.colour }} />
            <span className="ds-ck-tabname">{s.name}</span>
            {on && (
              <span
                className="ds-ck-tabx"
                role="button"
                aria-label={`Close ${s.name}`}
                title="Delete system"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestClose();
                }}
              >
                <Glyph name="x" size={11} />
              </span>
            )}
          </button>
        );
      })}
      <button className="ds-ck-tabadd" onClick={onAdd} aria-label="Add system" title="Add system">
        <Glyph name="plus" size={16} />
      </button>
    </div>
  );
}

/* ─────────────────── the active system's cockpit body ─────────────────── */

function ActiveCockpit({
  doc,
  pack,
  system,
  basis,
  floor,
  selectedId,
  onSelect,
  onMutate,
  onEditRoom,
  onArmPlace,
  onDrawRoom,
  onChangeType,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  floor: Floor;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onDrawRoom: () => void;
  onChangeType: () => void;
}) {
  const [view, setView] = useState<"rooms" | "components">("rooms");

  const rooms = useMemo(() => roomsServedBy(doc, system.id), [doc, system.id]);
  const componentRows = useMemo(
    () => systemComponents(doc, pack, system, basis),
    [doc, pack, system, basis]
  );
  const hero = useMemo(
    () => computeHero(doc, pack, system, rooms, basis),
    [doc, pack, system, rooms, basis]
  );

  /* the selected canvas object, if it belongs to this system → object card */
  const selObj = doc.objects.find(
    (o) =>
      o.id === selectedId &&
      o.systemId === system.id &&
      (o.type === "unit" || o.type === "riser" || o.type === "pipe-run")
  );

  /* which room the Inspect card shows: a selected served room, else the room
     of a selected IDU, else the first served room */
  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const iduRoomId =
    selObj?.type === "unit" && String(selObj.props.role) === "idu"
      ? String(selObj.props.roomId ?? "")
      : "";
  const inspectRoom =
    selectedRoom ?? rooms.find((r) => r.id === iduRoomId) ?? rooms[0] ?? null;

  /* pill highlight: an IDU's room when a unit is selected, else the inspect room */
  const highlightRoomId = iduRoomId || (selObj ? "" : inspectRoom?.id ?? "");

  return (
    <>
      <CockpitHero hero={hero} onChangeType={onChangeType} />

      <div className="ds-ck-seg" role="tablist" aria-label="Panel view">
        <button
          role="tab"
          aria-selected={view === "rooms"}
          className={`ds-ck-segbtn${view === "rooms" ? " on" : ""}`}
          onClick={() => setView("rooms")}
        >
          Rooms<span className="ds-ck-segn">{rooms.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={view === "components"}
          className={`ds-ck-segbtn${view === "components" ? " on" : ""}`}
          onClick={() => setView("components")}
        >
          Components<span className="ds-ck-segn">{componentRows.length}</span>
        </button>
      </div>

      {/* tabs + hero + the seg switch are pinned above; only the views scroll */}
      <div className="ds-ck-scroll">
        <SegWindow view={view}>
          <RoomsView
            doc={doc}
            pack={pack}
            system={system}
            basis={basis}
            floor={floor}
            rooms={rooms}
            selObj={selObj ?? null}
            inspectRoom={inspectRoom}
            highlightRoomId={highlightRoomId}
            onSelect={onSelect}
            onMutate={onMutate}
            onEditRoom={onEditRoom}
            onArmPlace={onArmPlace}
            onDrawRoom={onDrawRoom}
          />
          <ComponentsView rows={componentRows} hasRooms={rooms.length > 0} system={system} onMutate={onMutate} />
        </SegWindow>
      </div>
    </>
  );
}

/* ─────────────────────────── hero ─────────────────────────── */

/** the ring circumference (2π·45), the basis for the arc offset. */
const DONUT_CIRC = 282.7;

type HeroState = "ok" | "warn" | "bad" | "empty";

interface HeroModel {
  label: string; // module label, e.g. "Split (1:1)"
  state: HeroState;
  pct: number | null; // centre %, null when not sized
  requiredKw: number | null; // ledger "Required" (room load)
  selectedKw: number | null; // ledger "Selected" (chosen pair capacity)
  sumLabel: string; // "Spare" / "Short" / "Not sized" / "Select units" / "Calibrate"
  sumValue: string; // signed delta "+0.7 kW" / "−0.5 kW" / "—"
  dash: number; // stroke-dashoffset the arc animates to
  over: boolean; // show the >100% overshoot segment
}

const fmtKw = (n: number | null): string => (n != null ? `${n.toFixed(1)} kW` : "— kW");

/** capacity-coverage hero: Required (room load) vs Selected (chosen pair kW).
    coverage = selected ÷ required → ≥100% ok · 90–99% warn · <90% bad. Before a
    room+pair resolves it's "empty" (muted donut). */
function computeHero(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem,
  rooms: RoomObj[],
  basis: SizingBasis
): HeroModel {
  const label = moduleFor(system.type).label;
  const room = rooms[0] ?? null;
  const cov = room && pack ? roomCoverage(doc, pack, room, basis) : null;
  const requiredKw = cov?.loadKw ?? null;
  const selectedKw = pack ? systemPairKw(doc, pack, system.id, basis) : null;

  const sized =
    requiredKw != null && requiredKw > 0 && selectedKw != null && selectedKw > 0;

  if (!sized) {
    const sumLabel =
      rooms.length === 0
        ? "Not sized"
        : requiredKw == null
          ? "Calibrate"
          : "Select units";
    return {
      label,
      state: "empty",
      pct: null,
      requiredKw,
      selectedKw,
      sumLabel,
      sumValue: "—",
      dash: DONUT_CIRC,
      over: false,
    };
  }

  const coverage = selectedKw / requiredKw;
  const pct = Math.round(coverage * 100);
  const delta = selectedKw - requiredKw;
  const state: HeroState = coverage >= 1 ? "ok" : coverage >= 0.9 ? "warn" : "bad";
  return {
    label,
    state,
    pct,
    requiredKw,
    selectedKw,
    sumLabel: state === "ok" ? "Spare" : "Short",
    sumValue: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} kW`,
    dash: DONUT_CIRC * (1 - Math.min(coverage, 1)),
    over: coverage > 1,
  };
}

/** the coverage ring: draws in from empty on mount, then transitions on change. */
function Donut({ state, pct, dash, over }: Pick<HeroModel, "state" | "pct" | "dash" | "over">) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const offset = drawn ? dash : DONUT_CIRC;
  const verdict =
    state === "empty" ? "not sized" : state === "ok" ? "covered" : state === "warn" ? "tight" : "undersized";
  return (
    <div
      className="ds-ck-donut"
      role="img"
      aria-label={pct != null ? `Coverage ${pct}% of required, ${verdict}` : "Not sized"}
    >
      <svg viewBox="0 0 110 110" aria-hidden="true">
        <defs>
          <linearGradient id="capGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00E5C0" />
            <stop offset="1" stopColor="#00A389" />
          </linearGradient>
        </defs>
        <circle className="track" cx="55" cy="55" r="45" fill="none" strokeWidth="9" />
        {state !== "empty" && (
          <circle
            className="val"
            cx="55"
            cy="55"
            r="45"
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            style={{ strokeDashoffset: offset }}
          />
        )}
        {over && (
          <circle
            className={`over${drawn ? " on" : ""}`}
            cx="55"
            cy="55"
            r="45"
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="ctr">
        <div className="n">{pct != null ? `${pct}%` : "—"}</div>
        <div className="s">{pct != null ? "of required" : "not sized"}</div>
      </div>
      {state !== "empty" && (
        <span className="badge-tip">
          <Glyph name={state === "ok" ? "check" : "alert"} size={13} />
        </span>
      )}
    </div>
  );
}

function HeroShell({
  label,
  state,
  requiredKw,
  selectedKw,
  sumLabel,
  sumValue,
  donut,
  onChangeType,
}: {
  label: string;
  state: HeroState;
  requiredKw: number | null;
  selectedKw: number | null;
  sumLabel: string;
  sumValue: string;
  donut: React.ReactNode;
  onChangeType?: () => void;
}) {
  const [name, ratio] = splitLabel(label);
  return (
    <div className="ds-ck-caphero" data-state={state}>
      <div className="ds-ck-caphero-top">
        <span className="ds-ck-caphero-eyebrow">System type</span>
        {onChangeType && (
          <button
            className="ds-ck-caphero-change"
            onClick={onChangeType}
            title="Change system type — a different type clears the system's units"
          >
            <Glyph name="edit" size={12} />
            Change
          </button>
        )}
      </div>
      <div className="ds-ck-caphero-cols">
        <div className="ds-ck-caphero-left">
          <div className="ds-ck-caphero-type">
            {name}
            {ratio && <span> {ratio}</span>}
          </div>
          <div className="ds-ck-ledger">
            <div className="ds-ck-ledger-row req">
              <span className="k">Required</span>
              <span className="v">{fmtKw(requiredKw)}</span>
            </div>
            <div className="ds-ck-ledger-row sel">
              <span className="k">Selected</span>
              <span className="v">{fmtKw(selectedKw)}</span>
            </div>
            <div className="ds-ck-ledger-row sum">
              <span className="k">{sumLabel}</span>
              <span className="v">{sumValue}</span>
            </div>
          </div>
        </div>
        <div className="ds-ck-caphero-right">{donut}</div>
      </div>
    </div>
  );
}

function CockpitHero({ hero, onChangeType }: { hero: HeroModel; onChangeType: () => void }) {
  return (
    <HeroShell
      label={hero.label}
      state={hero.state}
      requiredKw={hero.requiredKw}
      selectedKw={hero.selectedKw}
      sumLabel={hero.sumLabel}
      sumValue={hero.sumValue}
      onChangeType={onChangeType}
      donut={<Donut state={hero.state} pct={hero.pct} dash={hero.dash} over={hero.over} />}
    />
  );
}

/** a minimal hero for unavailable modules (no pack-driven coverage) */
function SimpleHero({ label }: { label: string }) {
  return (
    <HeroShell
      label={label}
      state="empty"
      requiredKw={null}
      selectedKw={null}
      sumLabel="Coming soon"
      sumValue="—"
      donut={<Donut state="empty" pct={null} dash={DONUT_CIRC} over={false} />}
    />
  );
}

function splitLabel(label: string): [string, string] {
  const i = label.indexOf(" (");
  if (i === -1) return [label, ""];
  return [label.slice(0, i), label.slice(i + 1)];
}

/* ─────────────── sliding seg-window (translate + animated height) ─────────────── */

function SegWindow({ view, children }: { view: "rooms" | "components"; children: [React.ReactNode, React.ReactNode] }) {
  const idx = view === "rooms" ? 0 : 1;
  const winRef = useRef<HTMLDivElement | null>(null);
  const roomsRef = useRef<HTMLDivElement | null>(null);
  const compsRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const win = winRef.current;
    const pane = idx === 0 ? roomsRef.current : compsRef.current;
    if (!win || !pane) return;
    const measure = () => {
      win.style.height = `${pane.offsetHeight}px`;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [idx]);

  return (
    <div className="ds-ck-segwin" ref={winRef}>
      <div className="ds-ck-segtrack" style={{ transform: `translateX(${idx * -100}%)` }}>
        <div
          className="ds-ck-segview"
          data-view="rooms"
          ref={roomsRef}
          aria-hidden={idx !== 0}
          inert={idx !== 0 ? true : undefined}
        >
          {children[0]}
        </div>
        <div
          className="ds-ck-segview"
          data-view="components"
          ref={compsRef}
          aria-hidden={idx !== 1}
          inert={idx !== 1 ? true : undefined}
        >
          {children[1]}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── rooms view ─────────────────────────── */

function RoomsView({
  doc,
  pack,
  system,
  basis,
  floor,
  rooms,
  selObj,
  inspectRoom,
  highlightRoomId,
  onSelect,
  onMutate,
  onEditRoom,
  onArmPlace,
  onDrawRoom,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  floor: Floor;
  rooms: RoomObj[];
  selObj: DesignObject | null;
  inspectRoom: RoomObj | null;
  highlightRoomId: string;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onDrawRoom: () => void;
}) {
  const [adopting, setAdopting] = useState(false);

  const servedIds = new Set(rooms.map((r) => r.id));
  const adoptable = doc.objects.filter(
    (o): o is RoomObj =>
      o.type === "room" && o.geometry.kind === "polygon" && !servedIds.has(o.id)
  );

  const adoptRoom = (roomId: string) => {
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) => {
        if (s.id !== system.id) return s;
        const cur = Array.isArray(s.settings.roomIds) ? (s.settings.roomIds as string[]) : [];
        return cur.includes(roomId)
          ? s
          : { ...s, settings: { ...s.settings, roomIds: [...cur, roomId] } };
      }),
    }));
    setAdopting(false);
  };

  const releaseRoom = (roomId: string) =>
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                roomIds: (Array.isArray(s.settings.roomIds)
                  ? (s.settings.roomIds as string[])
                  : []
                ).filter((id) => id !== roomId),
              },
            }
          : s
      ),
    }));

  const floorName = (id: string) => doc.floors.find((f) => f.id === id)?.name ?? "";

  if (rooms.length === 0) {
    return (
      <div className="ds-ck-emptycard">
        <div className="ds-ck-emptyic">
          <Glyph name="house" size={24} />
        </div>
        <div className="ds-ck-emptyt">No rooms yet</div>
        <div className="ds-ck-emptys">
          Draw a room on the plan, or serve an existing one, to start sizing this split.
        </div>
        <div className="ds-ck-emptyactions">
          <button className="ds-ck-inkbtn" onClick={onDrawRoom}>
            <Glyph name="edit" size={16} />
            Draw a room
          </button>
          {adoptable.length > 0 &&
            (adopting ? (
              <div className="ds-ck-adopt">
                {adoptable.map((r) => (
                  <button key={r.id} className="ds-ck-adoptrow" onClick={() => adoptRoom(r.id)}>
                    <span className="an">
                      {String(r.props.name ?? "Room")}
                      <em> · {floorName(r.floorId)}</em>
                    </span>
                    <Glyph name="plus" size={13} />
                  </button>
                ))}
              </div>
            ) : (
              <button className="ds-ck-servebtn" onClick={() => setAdopting(true)}>
                <Glyph name="plus" size={15} />
                Serve an existing room
              </button>
            ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ds-ck-roster">
        {rooms.map((r, i) => {
          const cov = roomCoverage(doc, pack, r, basis);
          // done = covered · none = nothing placed/pending · pending = in progress
          const dot =
            cov.status === "covered"
              ? "done"
              : cov.coveredKw === 0 && cov.pendingKw === 0
                ? "none"
                : "pending";
          const on = r.id === highlightRoomId;
          return (
            <button
              key={r.id}
              className={`ds-ck-rrow${on ? " on" : ""}`}
              onClick={() => onSelect(r.id)}
              title={
                cov.status === "covered"
                  ? "Load covered"
                  : cov.loadKw != null
                    ? `${(cov.loadKw - cov.coveredKw).toFixed(1)} kW short`
                    : "Calibrate the floor to compute the load"
              }
            >
              <span className="ds-ck-rnum">{i + 1}</span>
              <span className={`ds-ck-rdot ${dot}`} />
              <span className="ds-ck-rnm">{String(r.props.name ?? "Room")}</span>
            </button>
          );
        })}
        {adoptable.length > 0 && !adopting && (
          <button className="ds-ck-rowadd" onClick={() => setAdopting(true)}>
            <Glyph name="plus" size={14} />
            Serve an existing room
          </button>
        )}
      </div>

      {adopting && adoptable.length > 0 && (
        <div className="ds-ck-adopt">
          {adoptable.map((r) => (
            <button key={r.id} className="ds-ck-adoptrow" onClick={() => adoptRoom(r.id)}>
              <span className="an">
                {String(r.props.name ?? "Room")}
                <em> · {floorName(r.floorId)}</em>
              </span>
              <Glyph name="plus" size={13} />
            </button>
          ))}
        </div>
      )}

      <div className="ds-ck-lbl">
        <span className="rl">Inspect</span>
      </div>

      {selObj ? (
        <ObjectInspectCard doc={doc} obj={selObj} floor={floor} onMutate={onMutate} onSelect={onSelect} />
      ) : inspectRoom ? (
        <RoomInspectCard
          doc={doc}
          pack={pack}
          system={system}
          room={inspectRoom}
          basis={basis}
          onSelect={onSelect}
          onMutate={onMutate}
          onEditRoom={onEditRoom}
          onArmPlace={onArmPlace}
          onRelease={releaseRoom}
        />
      ) : null}
    </>
  );
}

/* ─────────────────── inspect card (a served room) ─────────────────── */

function RoomInspectCard({
  doc,
  pack,
  system,
  room,
  basis,
  onSelect,
  onMutate,
  onEditRoom,
  onArmPlace,
  onRelease,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  room: RoomObj;
  basis: SizingBasis;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onRelease: (roomId: string) => void;
}) {
  const [tab, setTab] = useState<"configure" | "units" | "pipework">("units");
  const cov = roomCoverage(doc, pack, room, basis);
  const covered = cov.status === "covered";
  const shared = room.systemId !== system.id;
  const dot = covered ? "ok" : cov.status === "under" ? "under" : "none";

  return (
    <div className="ds-ck-inspect">
      <div className="ds-ck-ihead">
        <span className={`ds-ck-cdot ${dot}`} />
        <div className="ds-ck-itxt">
          <div className="ds-ck-iname">{String(room.props.name ?? "Room")}</div>
        </div>
        {shared && (
          <span className="ds-ck-ishared">
            shared
            <button
              aria-label="Stop serving this room"
              title="Stop serving this room"
              onClick={() => onRelease(room.id)}
            >
              ✕
            </button>
          </span>
        )}
        <span className={`ds-ck-ibadge${covered ? "" : " warn"}`}>
          {covered && <Glyph name="check" size={12} />}
          {covered ? "Covered" : "Not complete"}
        </span>
      </div>
      <div className="ds-ck-subtabs" role="tablist" aria-label="Inspect section">
        <button
          role="tab"
          aria-selected={tab === "configure"}
          className={`ds-ck-stb${tab === "configure" ? " on" : ""}`}
          onClick={() => setTab("configure")}
        >
          <Glyph name="configure" size={13} />
          Configure
        </button>
        <button
          role="tab"
          aria-selected={tab === "units"}
          className={`ds-ck-stb${tab === "units" ? " on" : ""}`}
          onClick={() => setTab("units")}
        >
          <Glyph name="unitsq" size={13} />
          Units
        </button>
        <button
          role="tab"
          aria-selected={tab === "pipework"}
          className={`ds-ck-stb${tab === "pipework" ? " on" : ""}`}
          onClick={() => setTab("pipework")}
        >
          <Glyph name="pipes" size={13} />
          Pipework
        </button>
      </div>
      <div className="ds-ck-ibody">
        {tab === "configure" && <ConfigureSub doc={doc} room={room} onEditRoom={onEditRoom} />}
        {tab === "units" && (
          <UnitsSub
            doc={doc}
            pack={pack}
            system={system}
            room={room}
            basis={basis}
            onMutate={onMutate}
            onArmPlace={onArmPlace}
          />
        )}
        {tab === "pipework" && <PipeworkSub doc={doc} system={system} onSelect={onSelect} />}
      </div>
    </div>
  );
}

function ConfigureSub({
  doc,
  room,
  onEditRoom,
}: {
  doc: DesignDocument;
  room: RoomObj;
  onEditRoom: (id: string) => void;
}) {
  const area = roomAreaM2(doc, room);
  const kw = roomLoadKw(doc, room);
  const floorName = doc.floors.find((f) => f.id === room.floorId)?.name ?? "—";
  return (
    <div className="ds-ck-sub cfg">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="configure" size={14} />
          Configure
        </span>
        <button className="ds-ck-act" onClick={() => onEditRoom(room.id)}>
          Edit
          <Glyph name="edit" size={12} />
        </button>
      </div>
      <div className="ds-ck-facts">
        <div className="ds-ck-fact">
          <div className="k">Area</div>
          <div className="v">
            {area != null ? Math.round(area) : "—"}
            <small> m²</small>
          </div>
        </div>
        <div className="ds-ck-fact">
          <div className="k">Heat load</div>
          <div className="v">
            {kw != null ? kw.toFixed(1) : "—"}
            <small> kW</small>
          </div>
        </div>
        <div className="ds-ck-fact">
          <div className="k">Floor</div>
          <div className="v">{floorName}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Units sub-card: pick a pair, drag the cards, recall. Exported so the unit
   tests can drive it in isolation. Behaviour is verbatim from the old
   RoomUnitsSection (choose writes the pair + drops on swap; recall drops the
   unit and this system's pipework). ── */

export function UnitsSub({
  doc,
  pack,
  system,
  room,
  basis,
  onMutate,
  onArmPlace,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  room: RoomObj;
  basis: SizingBasis;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const loadKw = roomLoadKw(doc, room);

  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
  const placedIdu = mine.find((o) => o.props.role === "idu") ?? null;
  const placedOdu = mine.find((o) => o.props.role === "odu") ?? null;
  const iduModel = String(placedIdu?.props.model ?? system.settings.pairIdu ?? "");
  const oduModel = String(placedOdu?.props.model ?? system.settings.pairOdu ?? "");
  const iduSpec = pack?.indoor_units.find((u) => u.model === iduModel) ?? null;
  const oduSpec = pack?.outdoor_units.find((u) => u.model === oduModel) ?? null;
  const pairRow =
    pack?.pair_tables.find((p) => p.idu_model === iduModel && p.odu_model === oduModel) ?? null;
  const hasPair = Boolean(iduModel && oduModel);
  const placedCount = (placedIdu ? 1 : 0) + (placedOdu ? 1 : 0);
  const allPlaced = Boolean(placedIdu && placedOdu);

  const recall = (unitId: string) =>
    onMutate((d) => ({
      ...d,
      objects: d.objects.filter(
        (o) =>
          o.id !== unitId &&
          !(o.systemId === system.id && (o.type === "pipe-run" || o.type === "riser"))
      ),
    }));

  const choose = (pair: PairProposal) => {
    const changed = pair.idu.model !== iduModel || pair.odu.model !== oduModel;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                pairIdu: pair.idu.model,
                pairOdu: pair.odu.model,
                roomId: room.id,
              },
            }
          : s
      ),
      objects: changed
        ? d.objects.filter(
            (o) =>
              !(
                o.systemId === system.id &&
                (o.type === "unit" || o.type === "pipe-run" || o.type === "riser")
              )
          )
        : d.objects,
    }));
    setBrowsing(false);
  };

  const pipeSizes = pairRow ? `Ø${pairRow.pipe_liquid_mm} / ${pairRow.pipe_gas_mm}` : "";

  return (
    <div className="ds-ck-sub units">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="unitsq" size={14} />
          Units
        </span>
        {hasPair && !allPlaced && (
          <span className="ds-ck-placecount">{placedCount} / 2 placed</span>
        )}
        {hasPair && allPlaced && (
          <button className="ds-ck-act" onClick={() => setBrowsing(true)} title="Swap the chosen unit">
            Select units
            <Glyph name="chev" size={12} />
          </button>
        )}
      </div>

      {!hasPair ? (
        <>
          <div className="ds-ck-uempty">
            <div className="ue-ic">
              <Glyph name="idu" size={20} />
            </div>
            <div>
              <div className="ue-t">No unit selected yet</div>
            </div>
          </div>
          <button
            className="ds-ck-inkbtn"
            style={{ marginTop: 10 }}
            onClick={() => setBrowsing(true)}
          >
            <Glyph name="plus" size={16} />
            Select units
          </button>
        </>
      ) : (
        <>
          <UnitRow
            role="idu"
            label="Indoor"
            model={iduModel}
            sub={iduSpec ? formFactorLabel(iduSpec.form_factor) : undefined}
            kw={pairRow?.rated_cool_kw ?? iduSpec?.capacity_cool_kw ?? null}
            widthMm={iduSpec?.width_mm ?? 800}
            depthMm={iduSpec?.depth_mm ?? 300}
            placed={Boolean(placedIdu)}
            onArmPlace={onArmPlace}
            onRecall={placedIdu ? () => recall(placedIdu.id) : undefined}
          />
          <div className="ds-ck-pairmid">
            <span className="tg">paired</span>
            <span className="rail-x" />
            {pipeSizes && <span className="tg">{pipeSizes}</span>}
            <span className="rail-x" />
          </div>
          <UnitRow
            role="odu"
            label="Outdoor"
            model={oduModel}
            sub={oduSpec ? `${oduSpec.phase === "3" ? "3Ø" : "1Ø"} · ${oduSpec.refrigerant}` : undefined}
            kw={pairRow?.rated_cool_kw ?? oduSpec?.capacity_cool_kw ?? null}
            widthMm={oduSpec?.width_mm ?? 900}
            depthMm={oduSpec?.depth_mm ?? 330}
            placed={Boolean(placedOdu)}
            onArmPlace={onArmPlace}
            onRecall={placedOdu ? () => recall(placedOdu.id) : undefined}
          />
          {!allPlaced && (
            <div className="ds-ck-placenote">Drag each card onto the plan to place it.</div>
          )}
        </>
      )}

      {browsing && pack && (
        <UnitBrowser pack={pack} loadKw={loadKw} basis={basis} onChoose={choose} onClose={() => setBrowsing(false)} />
      )}
    </div>
  );
}

function UnitRow({
  role,
  label,
  model,
  sub,
  kw,
  widthMm,
  depthMm,
  placed,
  onArmPlace,
  onRecall,
}: {
  role: "idu" | "odu";
  label: string;
  model: string;
  sub?: string;
  kw: number | null;
  widthMm: number;
  depthMm: number;
  placed: boolean;
  onArmPlace: (p: PlacingUnit | null) => void;
  onRecall?: () => void;
}) {
  return (
    <div
      className={`ds-ck-unit${placed ? "" : " toplace"}`}
      data-testid={`unit-card-${role}`}
      draggable={!placed}
      onDragStart={(e) => {
        if (placed) return;
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", model);
          e.dataTransfer.effectAllowed = "copy";
        }
        onArmPlace({ role, model, widthMm, depthMm });
      }}
      onDragEnd={() => onArmPlace(null)}
    >
      <div className={`ds-ck-uico ${role}`}>
        <Glyph name={role} size={21} />
        {placed && (
          <span className="ds-ck-pdot">
            <Glyph name="check" size={9} />
          </span>
        )}
      </div>
      <div>
        <div className="ds-ck-urole">{label}</div>
        <div className="ds-ck-umodel">{model}</div>
        {placed ? (
          sub && <div className="ds-ck-usub">{sub}</div>
        ) : (
          <span className="ds-ck-utotag">To place</span>
        )}
      </div>
      {kw != null && (
        <div className="ds-ck-ukw">
          {kw.toFixed(1)}
          <small> kW</small>
        </div>
      )}
      {placed && onRecall && (
        <button
          className="ds-ck-recall"
          onClick={onRecall}
          title="Recall — take this unit back off the plan"
          aria-label={`Recall ${label} unit`}
        >
          <Glyph name="rotate" size={12} />
          Recall
        </button>
      )}
    </div>
  );
}

function PipeworkSub({
  doc,
  system,
  onSelect,
}: {
  doc: DesignDocument;
  system: DesignSystem;
  onSelect: (id: string | null) => void;
}) {
  const runs = doc.objects.filter((o) => o.systemId === system.id && o.type === "pipe-run");
  const risers = doc.objects.filter((o) => o.systemId === system.id && o.type === "riser");
  const floorById = new Map(doc.floors.map((f) => [f.id, f]));

  const runLength = (o: DesignObject): string => {
    if (o.geometry.kind !== "polyline") return "—";
    const scale = floorById.get(o.floorId)?.scaleMmPerUnit ?? null;
    if (scale == null) return "—";
    return `${unitsToMeters(polylineLength(o.geometry.points), scale).toFixed(1)} m`;
  };

  return (
    <div className="ds-ck-sub pipes">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="pipes" size={14} />
          Pipework
        </span>
      </div>
      {runs.length + risers.length === 0 ? (
        <div className="ds-ck-pipeempty">No pipe run added yet</div>
      ) : (
        <>
          {runs.map((r) => (
            <button key={r.id} className="ds-ck-pipe" onClick={() => onSelect(r.id)}>
              <span className="ds-ck-pico">
                <Glyph name="run" size={15} />
              </span>
              <div>
                <div className="ds-ck-pt">Refrigerant run</div>
                <div className="ds-ck-ps">
                  {(r.props.startAttach ? 1 : 0) + (r.props.endAttach ? 1 : 0)}/2 ends
                </div>
              </div>
              <span className="ds-ck-pv">{runLength(r)}</span>
            </button>
          ))}
          {risers.map((r) => (
            <button key={r.id} className="ds-ck-pipe" onClick={() => onSelect(r.id)}>
              <span className="ds-ck-pico">
                <Glyph name="riser" size={15} />
              </span>
              <div>
                <div className="ds-ck-pt">Riser R-{String(r.props.group ?? "A")}</div>
                <div className="ds-ck-ps">Vertical · up</div>
              </div>
              <span className="ds-ck-pv">{String(r.props.heightM ?? 3)} m</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── components view ─────────────────────────── */

function ComponentsView({
  rows,
  hasRooms,
  system,
  onMutate,
}: {
  rows: ComponentRow[];
  hasRooms: boolean;
  system: DesignSystem;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const pick = (key: string, optionId: string) => {
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                components: {
                  ...(s.settings.components && typeof s.settings.components === "object"
                    ? (s.settings.components as Record<string, unknown>)
                    : {}),
                  [key]: optionId,
                },
              },
            }
          : s
      ),
    }));
    setOpenKey(null);
  };

  if (rows.length === 0) {
    return (
      <div className="ds-ck-emptycard">
        <div className="ds-ck-emptyic">
          <Glyph name="cube" size={24} />
        </div>
        <div className="ds-ck-emptyt">No components yet</div>
        <div className="ds-ck-emptys">
          {hasRooms
            ? "Components appear here once you select units for this room."
            : "System components appear here once the system has rooms and units."}
        </div>
      </div>
    );
  }

  return (
    <div className="ds-ck-comps">
      {rows.map((row) => {
        const open = row.kind === "choice" && openKey === row.choice!.key;
        return (
          <div key={row.id}>
            {row.kind === "choice" ? (
              <button
                className={`ds-ck-comp choice${open ? " open" : ""}`}
                onClick={() => setOpenKey(open ? null : row.choice!.key)}
              >
                <span className="ds-ck-compic">
                  <Glyph name={row.icon} size={20} />
                </span>
                <div className="ds-ck-comptx">
                  <div className="ds-ck-comprole">{row.role}</div>
                  <div className="ds-ck-compname">{row.name}</div>
                  {row.sub && <div className="ds-ck-compsub">{row.sub}</div>}
                </div>
                <span className="ds-ck-compv">{row.value}</span>
                <span className="ds-ck-compchev">
                  <Glyph name="chev" size={15} />
                </span>
              </button>
            ) : (
              <div className="ds-ck-comp">
                <span className="ds-ck-compic">
                  <Glyph name={row.icon} size={20} />
                </span>
                <div className="ds-ck-comptx">
                  <div className="ds-ck-comprole">{row.role}</div>
                  <div className="ds-ck-compname">{row.name}</div>
                  {row.sub && <div className="ds-ck-compsub">{row.sub}</div>}
                </div>
                <span className="ds-ck-compv">{row.value}</span>
              </div>
            )}

            {open && (
              <div className="ds-ck-opts">
                {row.choice!.options.map((opt) => (
                  <button
                    key={opt.id}
                    className={`ds-ck-opt${opt.id === row.choice!.selectedId ? " on" : ""}`}
                    onClick={() => pick(row.choice!.key, opt.id)}
                  >
                    <span className="ds-ck-opt-nm">
                      {opt.name}
                      {opt.sub && <small>{opt.sub}</small>}
                    </span>
                    <span className="ds-ck-opt-tick">
                      <Glyph name="check" size={15} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── object inspect card (selected canvas object) ───────────────
   Replaces the room Inspect card when a unit / riser / pipe-run is selected.
   Same mutations as the old SystemObjectInspector, cockpit-styled. */

function ObjectInspectCard({
  doc,
  obj,
  floor,
  onMutate,
  onSelect,
}: {
  doc: DesignDocument;
  obj: DesignObject;
  floor: Floor;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onSelect: (id: string | null) => void;
}) {
  const system = doc.systems.find((s) => s.id === obj.systemId);
  const del = () => {
    onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== obj.id) }));
    onSelect(null);
  };

  let title = "Object";
  let body: React.ReactNode = null;
  let delLabel = "Delete";

  if (obj.type === "unit") {
    const isIdu = String(obj.props.role) === "idu";
    title = isIdu ? "Indoor unit" : "Outdoor unit";
    delLabel = "Delete unit";
    const floorRooms = doc.objects.filter((o) => o.type === "room" && o.floorId === obj.floorId);
    const serveRoom = (roomId: string) =>
      onMutate((d) => {
        const room = d.objects.find((o) => o.id === roomId);
        const foreign = room && obj.systemId && room.systemId !== obj.systemId;
        const sys = foreign ? d.systems.find((s) => s.id === obj.systemId) : null;
        const cur = Array.isArray(sys?.settings.roomIds) ? (sys!.settings.roomIds as string[]) : [];
        return {
          ...d,
          systems:
            foreign && sys && !cur.includes(roomId)
              ? d.systems.map((s) =>
                  s.id === sys.id
                    ? { ...s, settings: { ...s.settings, roomIds: [...cur, roomId] } }
                    : s
                )
              : d.systems,
          objects: d.objects.map((o) => {
            if (o.id !== obj.id) return o;
            const props: Record<string, unknown> = { ...o.props, roomLock: true };
            if (roomId) props.roomId = roomId;
            else delete props.roomId;
            return { ...o, props };
          }),
        };
      });
    body = (
      <>
        <ObjRow k="Model" v={String(obj.props.model ?? "—")} />
        <ObjRow k="System" v={system?.name ?? "—"} />
        <ObjRow k="Floor" v={floor.name} />
        {isIdu && (
          <label className="ds-ck-objfield">
            <span>Serves room</span>
            <select value={String(obj.props.roomId ?? "")} onChange={(e) => serveRoom(e.target.value)}>
              <option value="">— not attributed —</option>
              {floorRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.props.name ?? "Room")}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  } else if (obj.type === "riser") {
    title = "Riser";
    delLabel = "Delete riser";
    body = (
      <>
        <label className="ds-ck-objfield">
          <span>Group (same letter joins floors)</span>
          <input
            value={String(obj.props.group ?? "A")}
            maxLength={1}
            onChange={(e) =>
              onMutate((d) => ({
                ...d,
                objects: d.objects.map((o) =>
                  o.id === obj.id
                    ? { ...o, props: { ...o.props, group: e.target.value.toUpperCase() || "A" } }
                    : o
                ),
              }))
            }
          />
        </label>
        <label className="ds-ck-objfield">
          <span>Vertical rise to next floor (m)</span>
          <input
            inputMode="decimal"
            value={String(obj.props.heightM ?? 3)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onMutate((d) => ({
                ...d,
                objects: d.objects.map((o) =>
                  o.id === obj.id
                    ? { ...o, props: { ...o.props, heightM: Number.isFinite(v) ? v : 3 } }
                    : o
                ),
              }));
            }}
          />
        </label>
      </>
    );
  } else {
    title = "Refrigerant run";
    delLabel = "Delete run";
    body = (
      <>
        <ObjRow k="System" v={system?.name ?? "—"} />
        <ObjRow
          k="Attached"
          v={`${(obj.props.startAttach ? 1 : 0) + (obj.props.endAttach ? 1 : 0)} of 2 ends`}
        />
      </>
    );
  }

  return (
    <div className="ds-ck-inspect ds-ck-objcard">
      <div className="ds-ck-ihead">
        <div className="ds-ck-itxt">
          <div className="ds-ck-iname">{title}</div>
        </div>
      </div>
      <div className="ds-ck-objbody">
        {body}
        <button className="ds-ck-objdel" onClick={del}>
          <Glyph name="x" size={14} />
          {delLabel}
        </button>
      </div>
    </div>
  );
}

function ObjRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="ds-ck-objrow">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

/* form-factor → a friendly label for the unit sub-line */
function formFactorLabel(ff: string): string {
  const map: Record<string, string> = {
    wall: "Wall-mounted",
    ducted: "Ducted",
    "cassette-4way": "4-way cassette",
    "cassette-2way": "2-way cassette",
    "cassette-1way": "1-way cassette",
    "cassette-compact": "Compact cassette",
    "under-ceiling": "Under-ceiling",
    "floor-console": "Floor console",
    "floor-concealed": "Floor concealed",
    bulkhead: "Bulkhead",
  };
  return map[ff] ?? ff;
}
