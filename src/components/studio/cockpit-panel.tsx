"use client";

/* Design Studio — System Cockpit (right-rail panel, v3).
   One uniform skeleton for every system type, imported pixel-faithfully from
   the dev handoff: Chrome-style system TABS above a white page, a dark ink
   HERO (type + load coverage), a Rooms/Components segmented SWITCH that slides,
   numbered room PILLS that load the INSPECT card (Configure · Units · Pipework),
   and a COMPONENTS list of the system-level parts.

   Split (1:1) is the live module. The skeleton is factored so multi-split /
   ducted / VRF drop into the same shape at their stages: the body branches on
   moduleFor(type).summary — "split" renders the load-coverage hero + Units/
   Pipework inspect, "ducted" the required-capacity hero + air-handler section
   (Stage 7 Step 1; gauge/outlets arrive at later steps), "capacity" the
   connected-capacity hero + shared-outdoor section with a per-room Unit tab
   (multi-split Stage 5; VRF reuses the shape at Stage 8). All numbers come
   from the engines (coverage / split / ducted / multi / components) — this
   file renders + arms intents, mutating through onMutate exactly as the old
   panel did. */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type {
  DesignDocument,
  DesignObject,
  DesignSystem,
  Floor,
  SystemType,
} from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import { polylineLength, unitsToMeters } from "@/lib/studio/geometry";
import { sizingCapacityKw, type SizingBasis } from "@/lib/studio/loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { roomsServedBy, roomCoverage, systemPairKw } from "@/lib/studio/coverage";
import type { PairProposal } from "@/lib/studio/split";
import { isAirCapable, moduleFor } from "@/lib/studio/modules";
import {
  distributeSpigots,
  ductedRequirement,
  DUCTED_OBJECT_TYPES,
  formatDia,
  isPlenumOf,
  isSpillRoom,
  plenumBody,
  SIZE_SERIES_MM,
  spigotsOf,
  streamOf,
  type DuctedRequirement,
  type PlenumSpigot,
} from "@/lib/studio/ducted";
import {
  multiConnection,
  multiIduSelections,
  type MultiConnection,
  type MultiOduProposal,
} from "@/lib/studio/multi";
import {
  systemComponents,
  type ComponentIcon,
  type ComponentRow,
} from "@/lib/studio/components";
import { SystemTypeChooser } from "./system-type-chooser";
import { UnitBrowser } from "./unit-browser";
import { MultiIduPicker, MultiOduPicker } from "./multi-browser";
import type { PlacingUnit } from "./canvas";

/* one colour per system, cycled on creation (kept from the old SystemsPanel) */
const SYSTEM_COLOURS = ["#2E68FF", "#E4572E", "#17A398", "#9B5DE5", "#F5A623", "#D63384"];

/* objects dropped when a system changes type — everything type-specific; the
   rooms it serves stay. Covers the five ducted palette types up front (ducted
   spec §9f) even though most of those objects arrive at later steps. */
const TYPE_WIPED_OBJECTS: ReadonlySet<string> = new Set([
  "unit",
  "pipe-run",
  "riser",
  ...DUCTED_OBJECT_TYPES,
]);

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

  /* change an existing system's type — the TYPE_WIPED_OBJECTS are dropped and
     the unit selections (pair + per-room) cleared; the rooms it serves stay. */
  const changeType = (type: SystemType) => {
    setChangingType(false);
    if (!active || type === active.type) return;
    const sysId = active.id;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === sysId
          ? {
              ...s,
              type,
              settings: {
                ...s.settings,
                pairIdu: undefined,
                pairOdu: undefined,
                multiIdus: undefined,
              },
            }
          : s
      ),
      objects: d.objects.filter(
        (o) => !(o.systemId === sysId && TYPE_WIPED_OBJECTS.has(o.type))
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

  /* the module's SummaryKind picks the body: "ducted" gets the required-
     capacity hero + air-handler section; "capacity" (multi / VRF) the
     connected-capacity hero + shared-outdoor section; "split" keeps the
     load-coverage hero unchanged */
  const summary = moduleFor(system.type).summary;
  const ducted = summary === "ducted";
  const perRoom = summary === "capacity";

  const rooms = useMemo(() => roomsServedBy(doc, system.id), [doc, system.id]);
  const componentRows = useMemo(
    () => systemComponents(doc, pack, system, basis),
    [doc, pack, system, basis]
  );
  const hero = useMemo(
    () => (ducted || perRoom ? null : computeHero(doc, pack, system, rooms, basis)),
    [ducted, perRoom, doc, pack, system, rooms, basis]
  );
  const req = useMemo(
    () => (ducted ? ductedRequirement(doc, system) : null),
    [ducted, doc, system]
  );
  const conn = useMemo(
    () => (perRoom ? multiConnection(doc, pack, system, basis) : null),
    [perRoom, doc, pack, system, basis]
  );

  /* the selected canvas object, if it belongs to this system → object card */
  const selObj = doc.objects.find(
    (o) =>
      o.id === selectedId &&
      o.systemId === system.id &&
      (o.type === "unit" || o.type === "riser" || o.type === "pipe-run" || o.type === "plenum")
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
      {req ? (
        <DuctedHero
          doc={doc}
          pack={pack}
          system={system}
          basis={basis}
          req={req}
          onChangeType={onChangeType}
        />
      ) : conn ? (
        <CockpitHero hero={computeMultiHero(conn)} onChangeType={onChangeType} />
      ) : hero ? (
        <CockpitHero hero={hero} onChangeType={onChangeType} />
      ) : null}

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
        {req && (
          <AhuSection
            doc={doc}
            pack={pack}
            system={system}
            basis={basis}
            req={req}
            onMutate={onMutate}
            onArmPlace={onArmPlace}
          />
        )}
        {conn && (
          <OutdoorSection
            pack={pack}
            system={system}
            basis={basis}
            conn={conn}
            onMutate={onMutate}
            onArmPlace={onArmPlace}
          />
        )}
        <SegWindow view={view}>
          <RoomsView
            doc={doc}
            pack={pack}
            system={system}
            basis={basis}
            floor={floor}
            rooms={rooms}
            ducted={ducted}
            perRoom={perRoom}
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

interface HeroModel {
  label: string; // module label, e.g. "Split (1:1)"
  covLabel: string; // "Load coverage"
  main: string;
  em: string;
  muted: boolean;
  barPct: number | null; // null → dashed empty bar
  badge: { kind: "ok" | "warn" | "muted"; text: string };
  note: { strong?: string; rest: string };
}

/** split-summary hero derivation (see the button→route map in the spec). */
function computeHero(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem,
  rooms: RoomObj[],
  basis: SizingBasis
): HeroModel {
  const label = moduleFor(system.type).label;
  const base = { label, covLabel: "Load coverage" };

  if (rooms.length === 0) {
    return {
      ...base,
      main: "—",
      em: " / — kW",
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Not sized" },
      note: { rest: "0 rooms served" },
    };
  }

  const room = rooms[0];
  const cov = roomCoverage(doc, pack, room, basis);
  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
  const placedIdu = mine.find((o) => o.props.role === "idu") ?? null;
  const iduModel = String(placedIdu?.props.model ?? system.settings.pairIdu ?? "");
  const oduModel = String(
    mine.find((o) => o.props.role === "odu")?.props.model ?? system.settings.pairOdu ?? ""
  );
  const hasPair = Boolean(iduModel && oduModel);

  if (cov.loadKw == null) {
    return {
      ...base,
      main: "—",
      em: " / — kW",
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Not sized" },
      note: { rest: "Calibrate to size" },
    };
  }
  const load = cov.loadKw;

  if (!hasPair) {
    return {
      ...base,
      main: "0",
      em: ` / ${load.toFixed(1)} kW load`,
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Not sized" },
      note: { rest: "Select units to size" },
    };
  }

  if (!placedIdu) {
    return {
      ...base,
      main: "2 units selected",
      em: "",
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Awaiting placement" },
      note: { rest: "Place on plan to size" },
    };
  }

  const pct = Math.min(cov.pct ?? 0, 100);
  if (cov.status === "covered") {
    const head = cov.coveredKw - load;
    return {
      ...base,
      main: cov.coveredKw.toFixed(1),
      em: ` / ${load.toFixed(1)} kW load`,
      muted: false,
      barPct: pct,
      badge: { kind: "ok", text: "Covered" },
      note: { strong: `+${head.toFixed(1)} kW`, rest: " headroom" },
    };
  }
  const short = load - cov.coveredKw;
  return {
    ...base,
    main: cov.coveredKw.toFixed(1),
    em: ` / ${load.toFixed(1)} kW load`,
    muted: false,
    barPct: pct,
    badge: { kind: "warn", text: "Undersized" },
    note: { strong: `−${short.toFixed(1)} kW`, rest: " to cover" },
  };
}

function CockpitHero({ hero, onChangeType }: { hero: HeroModel; onChangeType: () => void }) {
  const [name, ratio] = splitLabel(hero.label);
  return (
    <div className="ds-ck-hero">
      <div className="ds-ck-herotop">
        <span className="ds-ck-eyebrow">System type</span>
        <button
          className="ds-ck-change"
          onClick={onChangeType}
          title="Change system type — a different type clears the system's units"
        >
          Change
        </button>
      </div>
      <div className="ds-ck-herotype">
        {name}
        {ratio && <span> {ratio}</span>}
      </div>
      <div className="ds-ck-cov">
        <div className="ds-ck-cr">
          <span className="k">{hero.covLabel}</span>
          <span className={`v${hero.muted ? " muted" : ""}`}>
            {hero.main}
            {hero.em && <em>{hero.em}</em>}
          </span>
        </div>
        <div className={`ds-ck-bar${hero.barPct == null ? " empty" : ""}`}>
          {hero.barPct != null && <i style={{ width: `${hero.barPct}%` }} />}
        </div>
        <div className="ds-ck-herofoot">
          <span className={`ds-ck-badge ${hero.badge.kind}`}>
            {hero.badge.kind === "ok" && <Glyph name="check" size={12} />}
            {hero.badge.text}
          </span>
          <span className="ds-ck-hd">
            {hero.note.strong && <b>{hero.note.strong}</b>}
            {hero.note.rest}
          </span>
        </div>
      </div>
    </div>
  );
}

/** a minimal hero for unavailable modules (no pack-driven coverage) */
function SimpleHero({ label }: { label: string }) {
  const [name, ratio] = splitLabel(label);
  return (
    <div className="ds-ck-hero">
      <div className="ds-ck-herotop">
        <span className="ds-ck-eyebrow">System type</span>
      </div>
      <div className="ds-ck-herotype">
        {name}
        {ratio && <span> {ratio}</span>}
      </div>
      <div className="ds-ck-cov">
        <div className="ds-ck-cr">
          <span className="k">Load coverage</span>
          <span className="v muted">— / — kW</span>
        </div>
        <div className="ds-ck-bar empty" />
        <div className="ds-ck-herofoot">
          <span className="ds-ck-badge muted">Coming soon</span>
          <span className="ds-ck-hd">Not yet available</span>
        </div>
      </div>
    </div>
  );
}

function splitLabel(label: string): [string, string] {
  const i = label.indexOf(" (");
  if (i === -1) return [label, ""];
  return [label.slice(0, i), label.slice(i + 1)];
}

/* ─────────────────────────── ducted (Stage 7, Step 1) ───────────────────────────
   Minimal body — the required-capacity hero and the air-handler section. The
   gauge, counts row and warnings strip arrive at Step 7; outlets/ductwork at
   Steps 3–4. Selecting an AHU writes settings.pairIdu/pairOdu — the split
   pairing keys — so resolvePair/systemPairKw/systemComponents resolve
   unchanged (no separate ahuModel key). */

/** the ducted pairing state: placed unit models win, else the chosen pair */
function ductedPair(doc: DesignDocument, system: DesignSystem) {
  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
  const placedIdu = mine.find((o) => o.props.role === "idu") ?? null;
  const placedOdu = mine.find((o) => o.props.role === "odu") ?? null;
  return {
    placedIdu,
    placedOdu,
    iduModel: String(placedIdu?.props.model ?? system.settings.pairIdu ?? ""),
    oduModel: String(placedOdu?.props.model ?? system.settings.pairOdu ?? ""),
  };
}

function DuctedHero({
  doc,
  pack,
  system,
  basis,
  req,
  onChangeType,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  req: DuctedRequirement;
  onChangeType: () => void;
}) {
  const [name, ratio] = splitLabel(moduleFor(system.type).label);
  const { iduModel, oduModel } = ductedPair(doc, system);
  const hasPair = Boolean(iduModel && oduModel);
  const pairKw = hasPair && pack ? systemPairKw(doc, pack, system.id, basis) : null;
  const barPct =
    req.requiredKw != null && req.requiredKw > 0 && pairKw != null
      ? Math.min((pairKw / req.requiredKw) * 100, 100)
      : null;
  // requiredKw degrades to "—" + a grey reason, never a guess (Principle 5)
  const note =
    req.requiredKw == null
      ? req.roomCount === 0
        ? "No rooms served yet"
        : `Room loads unavailable · ${req.unknownRooms} room${req.unknownRooms === 1 ? "" : "s"}`
      : hasPair
        ? pairKw != null
          ? `${pairKw.toFixed(1)} kW selected`
          : "Pair capacity unknown"
        : "Select an air handler to size";
  return (
    <div className="ds-ck-hero">
      <div className="ds-ck-herotop">
        <span className="ds-ck-eyebrow">System type</span>
        <button
          className="ds-ck-change"
          onClick={onChangeType}
          title="Change system type — a different type clears the system's units"
        >
          Change
        </button>
      </div>
      <div className="ds-ck-herotype">
        {name}
        {ratio && <span> {ratio}</span>}
      </div>
      <div className="ds-ck-cov">
        <div className="ds-ck-cr">
          <span className="k">Required capacity</span>
          <span className={`v${req.requiredKw == null ? " muted" : ""}`}>
            {req.requiredKw != null ? `~${req.requiredKw.toFixed(1)}` : "—"}
            <em>
              {` kW · ${req.roomCount} room${req.roomCount === 1 ? "" : "s"}${
                req.spillRooms > 0 ? ` + ${req.spillRooms} spill` : ""
              }`}
            </em>
          </span>
        </div>
        <div className={`ds-ck-bar${barPct == null ? " empty" : ""}`}>
          {barPct != null && <i style={{ width: `${barPct}%` }} />}
        </div>
        <div className="ds-ck-herofoot">
          <span className="ds-ck-badge muted">
            {hasPair ? "Air handler chosen" : "No air handler"}
          </span>
          <span className="ds-ck-hd">{note}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Air-handler section: the choose CTA, the chosen pair's engine figures,
   and the two drag-to-plan cards (same arm/drag mechanics as UnitsSub).
   Exported so the ducted tests can drive it in isolation. ── */

export function AhuSection({
  doc,
  pack,
  system,
  basis,
  req,
  onMutate,
  onArmPlace,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  req: DuctedRequirement;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const { placedIdu, placedOdu, iduModel, oduModel } = ductedPair(doc, system);
  const hasPair = Boolean(iduModel && oduModel);
  const iduSpec = pack?.indoor_units.find((u) => u.model === iduModel) ?? null;
  const oduSpec = pack?.outdoor_units.find((u) => u.model === oduModel) ?? null;
  const pairRow =
    pack?.pair_tables.find((p) => p.idu_model === iduModel && p.odu_model === oduModel) ?? null;
  const pairKw = hasPair && pack ? systemPairKw(doc, pack, system.id, basis) : null;
  const airflowLs = iduSpec?.airflow_ls ?? null;
  const allPlaced = Boolean(placedIdu && placedOdu);

  // recalling the AHU takes its plenums with it (they're its plenums, §10.3)
  const recall = (unitId: string) =>
    onMutate((d) => ({
      ...d,
      objects: d.objects.filter(
        (o) =>
          o.id !== unitId &&
          !isPlenumOf(o, unitId) &&
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
              },
            }
          : s
      ),
      // a different AHU drops the placed refrigerant side, exactly like
      // split — plus the plenums fitted to the old unit
      objects: changed
        ? d.objects.filter(
            (o) =>
              !(
                o.systemId === system.id &&
                (o.type === "unit" ||
                  o.type === "pipe-run" ||
                  o.type === "riser" ||
                  o.type === "plenum")
              )
          )
        : d.objects,
    }));
    setBrowsing(false);
  };

  const pipeSizes = pairRow ? `Ø${pairRow.pipe_liquid_mm} / ${pairRow.pipe_gas_mm}` : "";

  return (
    <div className="ds-ck-sub units" style={{ marginTop: 10 }} data-testid="ahu-section">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="idu" size={14} />
          Air handler
        </span>
        {hasPair && (
          <button
            className="ds-ck-act"
            onClick={() => setBrowsing(true)}
            title="Swap the chosen air handler"
          >
            Change
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
              <div className="ue-t">No air handler yet</div>
              <div className="ue-s">One concealed unit serves every room.</div>
            </div>
          </div>
          <button
            className="ds-ck-inkbtn"
            style={{ marginTop: 10 }}
            onClick={() => setBrowsing(true)}
          >
            <Glyph name="plus" size={16} />
            Select air handler
          </button>
        </>
      ) : (
        <>
          {/* plain engine-sourced lines — the verdict gauge is Step 7 */}
          <ObjRow k="Capacity" v={pairKw != null ? `${pairKw.toFixed(1)} kW` : "—"} />
          <ObjRow k="Rated airflow" v={airflowLs != null ? `${airflowLs} L/s` : "—"} />
          {airflowLs == null && <div className="ds-ck-usub">airflow missing from pack</div>}
          <ObjRow
            k="Requires"
            v={req.requiredKw != null ? `~${req.requiredKw.toFixed(1)} kW` : "—"}
          />
          <UnitRow
            role="idu"
            label="Air handler"
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
        <UnitBrowser
          pack={pack}
          loadKw={req.requiredKw}
          basis={basis}
          initialFormFactor="ducted"
          requiredKw={req.requiredKw}
          onChoose={choose}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── multi-split (Stage 5) ───────────────────────────
   The "capacity" summary body: the hero becomes the connected-capacity gauge
   (connected IDU kW vs the shared outdoor's rating, ports badge, combination
   note) and a shared-outdoor section sits above the seg window — the exact
   shape of the split layout with the pair swapped for roster + shared ODU.
   Selections: an indoor unit per room on settings.multiIdus (roomId → model),
   the shared outdoor on settings.pairOdu (the split key, reused so
   components/coverage resolve unchanged). All numbers come from multi.ts. */

/** does this pipe-run attach to the given unit at either end? */
function runTouches(o: DesignObject, unitId: string): boolean {
  const attachId = (v: unknown): string =>
    v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") : "";
  return attachId(o.props.startAttach) === unitId || attachId(o.props.endAttach) === unitId;
}

/** connected-capacity hero (right-panel spec §3: ODU capacity gauge + IDU
    count) rendered through the same CockpitHero shell as split */
function computeMultiHero(conn: MultiConnection): HeroModel {
  const base = {
    label: moduleFor("multi-split").label,
    covLabel: "Connected capacity",
  };
  if (conn.rooms.length === 0) {
    return {
      ...base,
      main: "—",
      em: " / — kW",
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Not sized" },
      note: { rest: "0 rooms served" },
    };
  }
  const loadEm =
    conn.requiredKw != null
      ? ` / ${conn.requiredKw.toFixed(1)} kW load`
      : " kW connected";
  if (conn.iduCount === 0) {
    return {
      ...base,
      main: "0",
      em: loadEm,
      muted: true,
      barPct: null,
      badge: { kind: "muted", text: "Not sized" },
      note: { rest: "Select a unit per room" },
    };
  }
  const connected = conn.connectedKw ?? 0;
  if (!conn.odu) {
    // a set-but-unknown model degrades to a grey reason, never a guess
    const unknown = Boolean(conn.oduModel);
    return {
      ...base,
      main: connected.toFixed(1),
      em: loadEm,
      muted: false,
      barPct: null,
      badge: { kind: "muted", text: unknown ? "Outdoor unknown" : "No outdoor yet" },
      note: {
        rest: unknown
          ? `${conn.oduModel} isn't in this pack`
          : `${conn.iduCount} unit${conn.iduCount === 1 ? "" : "s"} — select the shared outdoor`,
      },
    };
  }
  const rated = conn.oduKw;
  const pct = rated != null && rated > 0 ? Math.min((connected / rated) * 100, 100) : null;
  const breach = conn.findings.some((f) => f.severity === "red");
  return {
    ...base,
    main: connected.toFixed(1),
    em: rated != null ? ` / ${rated.toFixed(1)} kW outdoor` : " kW connected",
    muted: false,
    barPct: pct,
    badge: {
      kind: breach ? "warn" : "ok",
      text: conn.ports != null ? `${conn.portsUsed}/${conn.ports} ports` : "Outdoor chosen",
    },
    note:
      conn.comboPct != null
        ? { strong: `${Math.round(conn.comboPct)}%`, rest: " combination" }
        : { rest: `${conn.iduCount} unit${conn.iduCount === 1 ? "" : "s"} connected` },
  };
}

/* ── Shared-outdoor section: the choose CTA, the connection figures + rule
   findings from the engine, and the drag-to-plan card (same arm/drag
   mechanics as UnitsSub). Exported so the multi tests can drive it in
   isolation. ── */

export function OutdoorSection({
  pack,
  system,
  basis,
  conn,
  onMutate,
  onArmPlace,
}: {
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  conn: MultiConnection;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const hasOdu = Boolean(conn.oduModel);
  const oduSpec = conn.odu;

  /* recall / swap take the placed outdoor AND the runs plumbed to it off the
     plan; every room's indoor selection stays untouched */
  const dropOduObjects = (d: DesignDocument, placedId: string) =>
    d.objects.filter(
      (o) =>
        o.id !== placedId &&
        !(o.systemId === system.id && o.type === "pipe-run" && runTouches(o, placedId))
    );

  const recall = (placedId: string) =>
    onMutate((d) => ({ ...d, objects: dropOduObjects(d, placedId) }));

  const choose = (p: MultiOduProposal) => {
    const changed = p.odu.model !== conn.oduModel;
    const placedId = conn.placedOduId;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? { ...s, settings: { ...s.settings, pairOdu: p.odu.model } }
          : s
      ),
      objects: changed && placedId ? dropOduObjects(d, placedId) : d.objects,
    }));
    setBrowsing(false);
  };

  const connectedIdus = conn.rooms
    .map((r) => r.idu)
    .filter((u): u is IndoorUnit => u != null);

  return (
    <div className="ds-ck-sub units" style={{ marginTop: 10 }} data-testid="outdoor-section">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="odu" size={14} />
          Shared outdoor
        </span>
        {hasOdu && (
          <button
            className="ds-ck-act"
            onClick={() => setBrowsing(true)}
            title="Swap the shared outdoor unit"
          >
            Change
            <Glyph name="chev" size={12} />
          </button>
        )}
      </div>

      {!hasOdu ? (
        <>
          <div className="ds-ck-uempty">
            <div className="ue-ic">
              <Glyph name="odu" size={20} />
            </div>
            <div>
              <div className="ue-t">No outdoor unit yet</div>
              <div className="ue-s">One outdoor serves every room.</div>
            </div>
          </div>
          <button
            className="ds-ck-inkbtn"
            style={{ marginTop: 10 }}
            onClick={() => setBrowsing(true)}
          >
            <Glyph name="plus" size={16} />
            Select outdoor unit
          </button>
        </>
      ) : (
        <>
          <ObjRow
            k="Rated capacity"
            v={conn.oduKw != null ? `${conn.oduKw.toFixed(1)} kW` : "—"}
          />
          <ObjRow
            k="Connected"
            v={
              conn.connectedKw != null
                ? `${conn.connectedKw.toFixed(1)} kW · ${conn.iduCount} unit${conn.iduCount === 1 ? "" : "s"}`
                : conn.iduCount > 0
                  ? `${conn.iduCount} unit${conn.iduCount === 1 ? "" : "s"} · capacity unknown`
                  : "None yet"
            }
          />
          <ObjRow k="Ports" v={conn.ports != null ? `${conn.portsUsed} / ${conn.ports}` : "—"} />
          <ObjRow
            k="Combination"
            v={conn.comboPct != null ? `${Math.round(conn.comboPct)}%` : "—"}
          />
          {conn.findings.map((f) => (
            <div
              key={f.code + f.message}
              className={`ds-ck-mwarn${f.severity === "red" ? " red" : ""}`}
            >
              <Glyph name="alert" size={12} />
              {f.message}
            </div>
          ))}
          <UnitRow
            role="odu"
            label="Outdoor"
            model={conn.oduModel}
            sub={
              oduSpec
                ? `${oduSpec.phase === "3" ? "3Ø" : "1Ø"} · ${oduSpec.refrigerant}`
                : undefined
            }
            kw={conn.oduKw}
            widthMm={oduSpec?.width_mm ?? 900}
            depthMm={oduSpec?.depth_mm ?? 330}
            placed={conn.oduPlaced}
            onArmPlace={onArmPlace}
            onRecall={conn.placedOduId ? () => recall(conn.placedOduId!) : undefined}
          />
          {!conn.oduPlaced && (
            <div className="ds-ck-placenote">Drag the card onto the plan to place it.</div>
          )}
        </>
      )}

      {browsing && pack && (
        <MultiOduPicker
          pack={pack}
          idus={connectedIdus}
          basis={basis}
          requiredKw={conn.requiredKw}
          current={conn.oduModel || undefined}
          onChoose={choose}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

/* ── Per-room Unit sub-card: one indoor unit for THIS room, chosen from the
   multi-capable catalogue and dragged to the plan (placement stamps
   props.roomId — the coverage attribution). Exported so the multi tests can
   drive it in isolation. ── */

export function MultiUnitsSub({
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

  const placedIdu =
    doc.objects.find(
      (o) =>
        o.systemId === system.id &&
        o.type === "unit" &&
        o.props.role === "idu" &&
        o.props.roomId === room.id
    ) ?? null;
  const model = String(placedIdu?.props.model ?? multiIduSelections(system)[room.id] ?? "");
  const spec = pack?.indoor_units.find((u) => u.model === model) ?? null;
  const kw = spec ? sizingCapacityKw(spec, basis) : null;

  /* recall drops THIS room's unit + the runs plumbed to it — other rooms'
     units and pipework stay */
  const dropUnitObjects = (d: DesignDocument, unitId: string) =>
    d.objects.filter(
      (o) =>
        o.id !== unitId &&
        !(o.systemId === system.id && o.type === "pipe-run" && runTouches(o, unitId))
    );

  const recall = (unitId: string) =>
    onMutate((d) => ({ ...d, objects: dropUnitObjects(d, unitId) }));

  const choose = (idu: IndoorUnit) => {
    const changed = idu.model !== model;
    const placedId = placedIdu?.id ?? null;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                multiIdus: { ...multiIduSelections(s), [room.id]: idu.model },
              },
            }
          : s
      ),
      // a different unit takes the placed one (and its runs) back off the plan
      objects: changed && placedId ? dropUnitObjects(d, placedId) : d.objects,
    }));
    setBrowsing(false);
  };

  return (
    <div className="ds-ck-sub units" data-testid="multi-unit-sub">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="unitsq" size={14} />
          Unit
        </span>
        {model && (
          <button
            className="ds-ck-act"
            onClick={() => setBrowsing(true)}
            title="Swap this room's indoor unit"
          >
            Change
            <Glyph name="chev" size={12} />
          </button>
        )}
      </div>

      {!model ? (
        <>
          <div className="ds-ck-uempty">
            <div className="ue-ic">
              <Glyph name="idu" size={20} />
            </div>
            <div>
              <div className="ue-t">No unit for this room yet</div>
            </div>
          </div>
          <button
            className="ds-ck-inkbtn"
            style={{ marginTop: 10 }}
            onClick={() => setBrowsing(true)}
          >
            <Glyph name="plus" size={16} />
            Select unit
          </button>
        </>
      ) : (
        <>
          <UnitRow
            role="idu"
            label="Indoor"
            model={model}
            sub={spec ? formFactorLabel(spec.form_factor) : undefined}
            kw={kw}
            widthMm={spec?.width_mm ?? 800}
            depthMm={spec?.depth_mm ?? 300}
            placed={Boolean(placedIdu)}
            onArmPlace={onArmPlace}
            onRecall={placedIdu ? () => recall(placedIdu.id) : undefined}
          />
          {!placedIdu && (
            <div className="ds-ck-placenote">
              Drag the card onto the plan to place it in this room.
            </div>
          )}
        </>
      )}

      {browsing && pack && (
        <MultiIduPicker
          pack={pack}
          loadKw={loadKw}
          basis={basis}
          current={model || undefined}
          onChoose={choose}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
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
  ducted,
  perRoom,
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
  ducted: boolean;
  perRoom: boolean;
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
          Draw a room on the plan, or serve an existing one, to start sizing this{" "}
          {ducted || perRoom ? "system" : "split"}.
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
              {/* spill rooms carry the ⤢ badge and no sizing expectations
                  (ducted spec §9b–9c; the share slot arrives at Step 3) */}
              {ducted && isSpillRoom(r) && (
                <span className="ds-ck-rspill" title="Spill room — receives spill air only">
                  ⤢
                </span>
              )}
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
        selObj.type === "plenum" ? (
          <PlenumInspectCard
            doc={doc}
            pack={pack}
            obj={selObj}
            onMutate={onMutate}
            onSelect={onSelect}
          />
        ) : (
          <ObjectInspectCard
            doc={doc}
            pack={pack}
            obj={selObj}
            floor={floor}
            onMutate={onMutate}
            onSelect={onSelect}
          />
        )
      ) : inspectRoom ? (
        <RoomInspectCard
          doc={doc}
          pack={pack}
          system={system}
          room={inspectRoom}
          basis={basis}
          ducted={ducted}
          perRoom={perRoom}
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
  ducted,
  perRoom,
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
  /** ducted rooms get Configure only — Outlets/Duct replace Units/Pipework
      at Steps 3–4 */
  ducted?: boolean;
  /** per-room modules (multi / VRF): one indoor unit per room, shared outdoor */
  perRoom?: boolean;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onRelease: (roomId: string) => void;
}) {
  const [tab, setTab] = useState<"configure" | "units" | "pipework">(
    ducted ? "configure" : "units"
  );
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
        {!ducted && (
          <>
            <button
              role="tab"
              aria-selected={tab === "units"}
              className={`ds-ck-stb${tab === "units" ? " on" : ""}`}
              onClick={() => setTab("units")}
            >
              <Glyph name="unitsq" size={13} />
              {perRoom ? "Unit" : "Units"}
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
          </>
        )}
      </div>
      <div className="ds-ck-ibody">
        {tab === "configure" && (
          <ConfigureSub
            doc={doc}
            room={room}
            ducted={ducted}
            onMutate={onMutate}
            onEditRoom={onEditRoom}
          />
        )}
        {ducted && (
          <div className="ds-ck-pipeempty">Outlets arrive with ductwork — Step 3</div>
        )}
        {!ducted && tab === "units" && (
          perRoom ? (
            <MultiUnitsSub
              doc={doc}
              pack={pack}
              system={system}
              room={room}
              basis={basis}
              onMutate={onMutate}
              onArmPlace={onArmPlace}
            />
          ) : (
            <UnitsSub
              doc={doc}
              pack={pack}
              system={system}
              room={room}
              basis={basis}
              onMutate={onMutate}
              onArmPlace={onArmPlace}
            />
          )
        )}
        {!ducted && tab === "pipework" && (
          <PipeworkSub doc={doc} system={system} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function ConfigureSub({
  doc,
  room,
  ducted,
  onMutate,
  onEditRoom,
}: {
  doc: DesignDocument;
  room: RoomObj;
  /** ducted systems gain the Spill toggle (spec §9c) */
  ducted?: boolean;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
}) {
  const area = roomAreaM2(doc, room);
  const kw = roomLoadKw(doc, room);
  const floorName = doc.floors.find((f) => f.id === room.floorId)?.name ?? "—";
  /* the toggle writes room.props.spill — the engine excludes spill rooms from
     the required-capacity sums, shares and outlet gating */
  const setSpill = (on: boolean) =>
    onMutate?.((d) => ({
      ...d,
      objects: d.objects.map((o) => {
        if (o.id !== room.id) return o;
        const props = { ...o.props };
        if (on) props.spill = true;
        else delete props.spill;
        return { ...o, props };
      }),
    }));
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
      {ducted && (
        <label className="ds-ck-spill">
          <input
            type="checkbox"
            checked={isSpillRoom(room)}
            onChange={(e) => setSpill(e.target.checked)}
            aria-label="Spill room"
          />
          <span className="ds-ck-spill-tx">
            <b>Spill room ⤢</b>
            <small>
              receives spill air only — excluded from sizing, needs no outlets
            </small>
          </span>
        </label>
      )}
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
  pack,
  obj,
  floor,
  onMutate,
  onSelect,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  obj: DesignObject;
  floor: Floor;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onSelect: (id: string | null) => void;
}) {
  const system = doc.systems.find((s) => s.id === obj.systemId);
  const del = () => {
    // deleting an AHU carries its plenums (spec §10.3 — confirm copy Step 8)
    onMutate((d) => ({
      ...d,
      objects: d.objects.filter(
        (o) => o.id !== obj.id && !(obj.type === "unit" && isPlenumOf(o, obj.id))
      ),
    }));
    onSelect(null);
  };

  let title = "Object";
  let body: React.ReactNode = null;
  let delLabel = "Delete";

  if (obj.type === "unit") {
    const isIdu = String(obj.props.role) === "idu";
    title = isIdu ? "Indoor unit" : "Outdoor unit";
    delLabel = "Delete unit";
    /* air-capable AHUs report their plenum status (ducted spec §9d) */
    const row = isIdu
      ? (pack?.indoor_units.find((u) => u.model === String(obj.props.model ?? "")) ?? null)
      : null;
    const air = row != null && isAirCapable(row);
    const fitted = doc.objects.filter((o) => isPlenumOf(o, obj.id));
    const supplyFitted = fitted.some((p) => p.props.end === "supply");
    const returnFitted = fitted.some((p) => p.props.end === "return");
    const returnBuiltIn = row?.return_opening === "built-in";
    const plenumStatus = supplyFitted
      ? returnBuiltIn
        ? "Supply plenum fitted · return built-in"
        : returnFitted
          ? "Supply + return plenums fitted"
          : "Supply plenum fitted · no return yet"
      : returnBuiltIn
        ? "Return built-in · no supply plenum yet"
        : returnFitted
          ? "Return plenum fitted · no supply yet"
          : "No plenums yet";
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
        {air && <ObjRow k="Plenums" v={plenumStatus} />}
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

/* ── plenum inspect card (ducted spec §9d) — body dims + facet state from the
   engine, the spigot roster, and the "+ spigot" size-series picker. Every
   number comes from plenumBody/formatDia; the card computes nothing. Exported
   so the ducted tests can drive it via the cockpit. ── */

export function PlenumInspectCard({
  doc,
  pack,
  obj,
  onMutate,
  onSelect,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  obj: DesignObject;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onSelect: (id: string | null) => void;
}) {
  const units = doc.settings.units;
  const stream = streamOf(obj.props) === "return" ? "return" : "supply";
  const unit = doc.objects.find((o) => o.id === String(obj.props.unitId ?? ""));
  const model = String(unit?.props.model ?? "");
  const row = pack?.indoor_units.find((u) => u.model === model) ?? null;
  const opening = row
    ? ((stream === "return" ? row.return_opening : row.supply_opening) ?? null)
    : null;
  const spigots = spigotsOf(obj.props);
  const body = plenumBody({
    opening,
    // the mounting face is the AHU's short end — its depth
    unitWidthMm: Number(unit?.props.depthMm) || null,
    spigots,
    units,
  });
  const [face, setFace] = useState<PlenumSpigot["face"]>("front");

  const writeSpigots = (next: PlenumSpigot[]) =>
    onMutate((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        o.id === obj.id ? { ...o, props: { ...o.props, spigots: next } } : o
      ),
    }));
  /* new spigots pack evenly — t = (i+1)/(n+1) per face, recomputed on every
     add/delete (engine distributeSpigots; drag-slide is a later nicety) */
  const addSpigot = (diaMm: number) =>
    writeSpigots(distributeSpigots([...spigots, { id: newId("spg"), diaMm, t: 0.5, face }]));
  const delSpigot = (id: string) =>
    writeSpigots(distributeSpigots(spigots.filter((s) => s.id !== id)));
  const del = () => {
    onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== obj.id) }));
    onSelect(null);
  };

  return (
    <div className="ds-ck-inspect ds-ck-objcard" data-testid="plenum-card">
      <div className="ds-ck-ihead">
        <div className="ds-ck-itxt">
          <div className="ds-ck-iname">
            {stream === "return" ? "Return plenum" : "Supply plenum"}
          </div>
        </div>
      </div>
      <div className="ds-ck-objbody">
        <ObjRow
          k="Base"
          v={`${Math.round(body.baseWMm)} × ${Math.round(body.depthMm)} mm`}
        />
        {body.derived && (
          <div className="ds-ck-usub">estimated — no opening data in pack</div>
        )}
        {body.overSpigot && (
          <div className="ds-ck-usub warn">too many ducts for this plenum</div>
        )}
        <ObjRow k="On" v={model || "—"} />
        <ObjRow k="On" v={model || "—"} />

        <div className="ds-ck-spigs">
          {spigots.length === 0 ? (
            <div className="ds-ck-pipeempty">No spigots yet — add one below</div>
          ) : (
            spigots.map((s) => (
              <div key={s.id} className="ds-ck-spig">
                <span className="ds-ck-spig-size">{formatDia(s.diaMm, units)}</span>
                <span className="ds-ck-spig-face">{s.face}</span>
                {s.capped && <span className="ds-ck-spig-cap">capped</span>}
                <button
                  className="ds-ck-spig-del"
                  aria-label={`Delete ${formatDia(s.diaMm, units)} ${s.face} spigot`}
                  title="Delete spigot"
                  onClick={() => delSpigot(s.id)}
                >
                  <Glyph name="x" size={11} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="ds-ck-addspig">
          <div className="ds-ck-addspig-t">+ spigot</div>
          <div className="ds-ck-facepick" role="radiogroup" aria-label="Spigot face">
            {(["front", "left", "right"] as const).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={face === f}
                className={`ds-ck-facebtn${face === f ? " on" : ""}`}
                onClick={() => setFace(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="ds-ck-sizechips">
            {SIZE_SERIES_MM.map((mm) => (
              <button
                key={mm}
                className="ds-ck-sizechip"
                title={`Add a ${formatDia(mm, units)} spigot on the ${face} face`}
                onClick={() => addSpigot(mm)}
              >
                {formatDia(mm, units)}
              </button>
            ))}
          </div>
        </div>

        <button className="ds-ck-objdel" onClick={del}>
          <Glyph name="x" size={14} />
          Delete plenum
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
