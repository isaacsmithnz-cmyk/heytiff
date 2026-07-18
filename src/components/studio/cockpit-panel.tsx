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

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/shell/icon";
import type {
  DesignDocument,
  DesignObject,
  DesignSystem,
  DesignVariantRef,
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
import { formFactorLabel } from "@/lib/studio/unit-specs";
import { isAirCapable, moduleFor } from "@/lib/studio/modules";
import {
  pruneObjects,
  releaseRoomsFromSystems,
  removedRoomIds,
  stripAttachesTo,
} from "@/lib/studio/attach";
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
  validateMultiSystem,
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
   Container CSS sizes each svg; the width/height here are fallbacks.

   NOT annotated `Record<string, …>` on purpose. That annotation widened
   `keyof typeof GLYPHS` to plain `string`, so `<Glyph name="square" />` and
   `<Glyph name="hexagon" />` type-checked against a map holding neither and
   fell through to the cube — the room shape picker offered ▢ and ⬡ as two
   identical stacked-cube icons for as long as it has existed. Inferred keys
   plus `satisfies` make a name that isn't here a compile error. */
const GLYPHS = {
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
  /* the two room shapes — a true square and a regular hexagon (circumradius 9
     about the 12,12 centre), so ▢ and ⬡ read apart at 16px */
  square: { d: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>', sw: 2 },
  hexagon: { d: '<path d="M12 3 19.79 7.5v9L12 21l-7.79-4.5v-9Z"/>', sw: 2 },
} satisfies Record<string, { d: string; sw?: number; fill?: boolean }>;

/* every ComponentIcon must have a glyph — indexing below is what enforces it */
function Glyph({ name, size = 16 }: { name: keyof typeof GLYPHS | ComponentIcon; size?: number }) {
  const g = GLYPHS[name];
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

/* Drawing a room is shape-first, and the shape choice now lives ON the button
   you pressed to ask for it. It used to appear as a pill pinned to the top of
   the CANVAS — several hundred px from the cockpit button that raised it, on
   the far side of the screen from where you were looking — so pressing "Add
   room" read as doing nothing at all. A marching-ants ring was added to make
   that pill louder, which treated a LOCATION problem as a salience one. */
export type RoomDraw = {
  /** the picker is up (raised by Add room / Draw a room) */
  open: boolean;
  /** which shape is armed, if any */
  shape: "rect" | "poly" | null;
  /** raise the picker */
  start: () => void;
  /** arm a shape — null cancels back to the select tool */
  pick: (shape: "rect" | "poly" | null) => void;
};

/** "Add room" that becomes the shape choice in place: ▢ · ⬡ · ✕. Same
    control, same spot — so the click visibly did something. */
function RoomDrawControl({
  draw,
  variant,
}: {
  draw: RoomDraw;
  /** the roster's dashed row, or the empty state's solid ink button */
  variant: "row" | "ink";
}) {
  const first = useRef<HTMLButtonElement | null>(null);
  /* keyboard users land in the choice they just asked for, rather than being
     left on a button that has turned into something else */
  useEffect(() => {
    if (draw.open) first.current?.focus();
  }, [draw.open]);

  const base = variant === "ink" ? "ds-ck-inkbtn" : "ds-ck-rowadd";
  if (!draw.open) {
    return (
      <button className={base} onClick={draw.start}>
        <Glyph name="edit" size={variant === "ink" ? 16 : 14} />
        {variant === "ink" ? "Draw a room" : "Add room"}
      </button>
    );
  }
  return (
    <div className={`${base} picking`} role="toolbar" aria-label="Room shape">
      <button
        ref={first}
        className={`ds-ck-shape${draw.shape === "rect" ? " on" : ""}`}
        onClick={() => draw.pick("rect")}
        aria-pressed={draw.shape === "rect"}
        aria-label="Rectangle room"
        title="Rectangle room (R)"
      >
        <Glyph name="square" size={16} />
      </button>
      <button
        className={`ds-ck-shape${draw.shape === "poly" ? " on" : ""}`}
        onClick={() => draw.pick("poly")}
        aria-pressed={draw.shape === "poly"}
        aria-label="Polygon room"
        title="Polygon room (G)"
      >
        <Glyph name="hexagon" size={16} />
      </button>
      <button
        className="ds-ck-shape x"
        onClick={() => draw.pick(null)}
        aria-label="Cancel drawing a room"
        title="Cancel (Esc)"
      >
        <Glyph name="x" size={13} />
      </button>
    </div>
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
  roomDraw,
  onFloor,
  floor,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
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
  roomDraw: RoomDraw;
  onFloor?: (floorId: string) => void;
  floor: Floor;
  /** design variations — branched/switched from the system dropdown */
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [changingType, setChangingType] = useState(false);

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

  const deleteSystem = (id: string) => {
    onMutate((d) => {
      // another system's runs must not keep attaches to units that went with
      // this one, and its rooms must not linger in anyone's adopted list
      const keep = (o: DesignObject) => o.systemId !== id;
      return {
        ...d,
        systems: releaseRoomsFromSystems(
          d.systems.filter((s) => s.id !== id),
          removedRoomIds(d.objects, keep)
        ),
        objects: pruneObjects(d.objects, keep),
      };
    });
    if (id === active?.id) onActivate(null);
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

  /* an unbranched design has no roster yet — show the one it is, if named */
  const variants: DesignVariantRef[] =
    doc.variants.length > 0
      ? doc.variants
      : doc.meta.variantLabel
        ? [{ id: doc.id, label: doc.meta.variantLabel }]
        : [];

  const systemSelector = (
    <SystemSelector
      systems={systems}
      activeId={active?.id ?? null}
      onActivate={onActivate}
      onAdd={() => {
        setChangingType(false);
        setAdding(true);
      }}
      onDelete={deleteSystem}
      variants={variants}
      currentVariantId={doc.id}
      onAddVariant={onAddVariant}
      onSwitchVariant={onSwitchVariant}
      onRenameVariant={onRenameVariant}
    />
  );

  return (
    <div className="ds-ck">
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
          roomDraw={roomDraw}
          onFloor={onFloor}
          systemSelector={systemSelector}
          onChangeType={() => {
            setAdding(false);
            setChangingType(true);
          }}
        />
      ) : active && mod && !mod.available ? (
        <>
          <SimpleHero label={mod.label} systemSelector={systemSelector} />
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
        <SimpleHero label={mod.label} systemSelector={systemSelector} />
      ) : null}
    </div>
  );
}

/* ───────────────── system selector (dropdown, mirrors the floor picker) ─────────────────
   Lives in the hero's top-left. Trigger shows the active system; the menu lists
   every system with a red-on-hover delete x behind a two-step confirm, plus Add
   system. Reuses the shared .ds-layers-menu + .ds-floor-* row/confirm visuals.

   Design variations hang off the ACTIVE system's row: switch between them,
   rename the current one, or branch a new one. They read as "another take on
   what I'm working on" here, which is where the thought occurs — but the
   caption says *design* variations because a variation carries the WHOLE
   design (every system), not just the one it sits under. */
function SystemSelector({
  systems,
  activeId,
  onActivate,
  onAdd,
  onDelete,
  variants,
  currentVariantId,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
}: {
  systems: DesignSystem[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  /** the design's sibling options — empty until the first branch */
  variants: DesignVariantRef[];
  currentVariantId: string;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [armedDel, setArmedDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const active = systems.find((s) => s.id === activeId) ?? systems[0] ?? null;
  if (!active) return null;
  return (
    <div className="ds-layers-wrap ds-sys-wrap">
      <button
        className={`ds-sys-trigger${open ? " on" : ""}`}
        onClick={() => {
          setArmedDel(null);
          setOpen((v) => !v);
        }}
        title={`${active.name} — switch system`}
      >
        <span className="ds-sys-dot" style={{ background: active.colour }} />
        <span className="ds-sys-name">{active.name}</span>
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-layers-menu ds-sys-menu" role="menu">
          {systems.map((s) => (
            <Fragment key={s.id}>
              <div className={`ds-sys-row${s.id === active.id ? " on" : ""}`}>
                <button
                  className="ds-sys-pick"
                  onClick={() => {
                    onActivate(s.id);
                    setOpen(false);
                  }}
                >
                  <span className="ds-sys-dot" style={{ background: s.colour }} />
                  <span className="nm">{s.name}</span>
                  <span className="ty">{moduleFor(s.type).label}</span>
                </button>
                {armedDel === s.id ? (
                  <span className="ds-floor-confirm">
                    <button
                      className="yes"
                      onClick={() => {
                        onDelete(s.id);
                        setArmedDel(null);
                      }}
                    >
                      Delete?
                    </button>
                    <button
                      className="no"
                      onClick={() => setArmedDel(null)}
                      aria-label="Cancel delete"
                    >
                      <Glyph name="x" size={12} />
                    </button>
                  </span>
                ) : (
                  <button
                    className="ds-floor-x"
                    onClick={() => setArmedDel(s.id)}
                    title="Delete this system and its objects"
                    aria-label={`Delete ${s.name}`}
                  >
                    <Glyph name="x" size={12} />
                  </button>
                )}
              </div>
              {s.id === active.id && (
                <div className="ds-var-sec">
                  <div className="ds-var-cap">Design variations</div>
                  {variants.map((v) =>
                    renaming && v.id === currentVariantId ? (
                      <form
                        key={v.id}
                        className="ds-var-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRenameVariant(draft);
                          setRenaming(false);
                          setOpen(false);
                        }}
                      >
                        <input
                          autoFocus
                          value={draft}
                          aria-label="Rename this variation"
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => setRenaming(false)}
                        />
                      </form>
                    ) : (
                      <div
                        key={v.id}
                        className={`ds-var-row${v.id === currentVariantId ? " on" : ""}`}
                      >
                        <button
                          className="ds-var-pick"
                          role="menuitemradio"
                          aria-checked={v.id === currentVariantId}
                          onClick={() => {
                            setOpen(false);
                            if (v.id !== currentVariantId) onSwitchVariant(v.id);
                          }}
                        >
                          {v.id === currentVariantId ? (
                            <Glyph name="check" size={11} />
                          ) : (
                            <span className="ds-var-dot" />
                          )}
                          <span className="nm">{v.label}</span>
                        </button>
                        {v.id === currentVariantId && (
                          <button
                            className="ds-var-edit"
                            onClick={() => {
                              setDraft(v.label);
                              setRenaming(true);
                            }}
                            title="Rename this variation"
                            aria-label="Rename this variation"
                          >
                            <Glyph name="edit" size={11} />
                          </button>
                        )}
                      </div>
                    )
                  )}
                  <button
                    className="ds-var-add"
                    onClick={() => {
                      onAddVariant();
                      setOpen(false);
                    }}
                    title="Branch the whole design into another option — every system comes with it"
                  >
                    <Glyph name="plus" size={12} />
                    Add variation
                  </button>
                </div>
              )}
            </Fragment>
          ))}
          <button
            className="ds-floor-add"
            onClick={() => {
              onAdd();
              setOpen(false);
            }}
          >
            <Glyph name="plus" size={13} />
            Add system
          </button>
        </div>
      )}
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
  roomDraw,
  onFloor,
  onChangeType,
  systemSelector,
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
  roomDraw: RoomDraw;
  onFloor?: (floorId: string) => void;
  onChangeType: () => void;
  systemSelector?: React.ReactNode;
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
          systemSelector={systemSelector}
        />
      ) : conn ? (
        <CockpitHero hero={computeMultiHero(conn)} onChangeType={onChangeType} systemSelector={systemSelector} />
      ) : hero ? (
        <CockpitHero hero={hero} onChangeType={onChangeType} systemSelector={systemSelector} />
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
            roomDraw={roomDraw}
            onFloor={onFloor}
          />
          <ComponentsView
            doc={doc}
            pack={pack}
            rows={componentRows}
            hasRooms={rooms.length > 0}
            system={system}
            ducted={ducted}
            perRoom={perRoom}
            onMutate={onMutate}
            onSelect={onSelect}
          />
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

/** shared donut math: coverage = selected ÷ required → ≥100% ok · 90–99% warn
    · <90% bad. Until both figures resolve it's "empty" (muted donut) with
    `emptySumLabel` naming the missing precondition. */
function donutModel(
  label: string,
  requiredKw: number | null,
  selectedKw: number | null,
  emptySumLabel: string
): HeroModel {
  const sized =
    requiredKw != null && requiredKw > 0 && selectedKw != null && selectedKw > 0;

  if (!sized) {
    return {
      label,
      state: "empty",
      pct: null,
      requiredKw,
      selectedKw,
      sumLabel: emptySumLabel,
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

/** capacity-coverage hero: Required (room load) vs Selected (chosen pair kW). */
function computeHero(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem,
  rooms: RoomObj[],
  basis: SizingBasis
): HeroModel {
  const room = rooms[0] ?? null;
  const cov = room && pack ? roomCoverage(doc, pack, room, basis) : null;
  const requiredKw = cov?.loadKw ?? null;
  const selectedKw = pack ? systemPairKw(doc, pack, system.id, basis) : null;
  const emptySumLabel =
    rooms.length === 0 ? "Not sized" : requiredKw == null ? "Calibrate" : "Select units";
  return donutModel(moduleFor(system.type).label, requiredKw, selectedKw, emptySumLabel);
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
  systemSelector,
}: {
  label: string;
  state: HeroState;
  requiredKw: number | null;
  selectedKw: number | null;
  sumLabel: string;
  sumValue: string;
  donut: React.ReactNode;
  onChangeType?: () => void;
  systemSelector?: React.ReactNode;
}) {
  const [name, ratio] = splitLabel(label);
  const typeInner = (
    <>
      {name}
      {ratio && <span> {ratio}</span>}
    </>
  );
  return (
    <div className="ds-ck-caphero" data-state={state}>
      {/* top row: system selector (left) · clickable type → change (right) */}
      <div className="ds-ck-caphero-top">
        {systemSelector}
        {onChangeType ? (
          <button
            className="ds-ck-caphero-type"
            onClick={onChangeType}
            title="Change system type — a different type clears the system's units"
          >
            {typeInner}
          </button>
        ) : (
          <span className="ds-ck-caphero-type">{typeInner}</span>
        )}
      </div>
      <div className="ds-ck-caphero-cols">
        <div className="ds-ck-caphero-left">
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

function CockpitHero({
  hero,
  onChangeType,
  systemSelector,
}: {
  hero: HeroModel;
  onChangeType: () => void;
  systemSelector?: React.ReactNode;
}) {
  return (
    <HeroShell
      label={hero.label}
      state={hero.state}
      requiredKw={hero.requiredKw}
      selectedKw={hero.selectedKw}
      sumLabel={hero.sumLabel}
      sumValue={hero.sumValue}
      onChangeType={onChangeType}
      systemSelector={systemSelector}
      donut={<Donut state={hero.state} pct={hero.pct} dash={hero.dash} over={hero.over} />}
    />
  );
}

/** a minimal hero for unavailable modules (no pack-driven coverage) */
function SimpleHero({ label, systemSelector }: { label: string; systemSelector?: React.ReactNode }) {
  return (
    <HeroShell
      label={label}
      state="empty"
      requiredKw={null}
      selectedKw={null}
      systemSelector={systemSelector}
      /* NAMES THE MISSING PRECONDITION, like every other empty hero on this
         panel ("Not sized", "Calibrate", "Select units"). It read "Coming
         soon", which is a release promise in a ledger row — and the panel
         directly beneath already says what is and is not there. */
      sumLabel="Not covered"
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
  systemSelector,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  basis: SizingBasis;
  req: DuctedRequirement;
  onChangeType: () => void;
  systemSelector?: React.ReactNode;
}) {
  const { iduModel, oduModel } = ductedPair(doc, system);
  const hasPair = Boolean(iduModel && oduModel);
  const pairKw = hasPair && pack ? systemPairKw(doc, pack, system.id, basis) : null;
  // requiredKw degrades to "— kW" + the precondition label, never a guess
  // (Principle 5); room/spill counts live in the AHU section
  const emptySumLabel =
    req.roomCount === 0
      ? "Not sized"
      : req.requiredKw == null
        ? "Calibrate"
        : "Select units";
  const hero = donutModel(
    moduleFor(system.type).label,
    req.requiredKw,
    pairKw,
    emptySumLabel
  );
  return <CockpitHero hero={hero} onChangeType={onChangeType} systemSelector={systemSelector} />;
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
              <div className="ue-s">
                {req.requiredKw != null
                  ? `Needs ~${req.requiredKw.toFixed(1)} kW · ${req.roomCount} room${
                      req.roomCount === 1 ? "" : "s"
                    }${req.spillRooms > 0 ? ` + ${req.spillRooms} spill` : ""}`
                  : "One concealed unit serves every room."}
              </div>
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

/** multi-split coverage through the same donut: Required = Σ served-room
    loads, Selected = Σ connected indoor capacity. The ODU-side story — ports,
    combination %, rule findings — lives in the outdoor section below
    (right-panel spec §3); the hero reads load coverage only. */
function computeMultiHero(conn: MultiConnection): HeroModel {
  const emptySumLabel =
    conn.rooms.length === 0
      ? "Not sized"
      : conn.requiredKw == null
        ? "Calibrate"
        : "Select units";
  return donutModel(
    moduleFor("multi-split").label,
    conn.requiredKw,
    conn.connectedKw,
    emptySumLabel
  );
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
          {/* a set-but-unknown model degrades to a grey reason, never a guess */}
          {!oduSpec && (
            <div className="ds-ck-mwarn">
              <Glyph name="alert" size={12} />
              {`${conn.oduModel} isn't in this pack`}
            </div>
          )}
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
  roomDraw,
  onFloor,
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
  roomDraw: RoomDraw;
  /** take the canvas to a floor — selecting a room on another storey should
      show you that storey, not leave you looking at a plan it isn't on */
  onFloor?: (floorId: string) => void;
}) {
  const [adopting, setAdopting] = useState(false);
  /* which floor groups are folded away. View state, like the layer toggles —
     it never reaches the document. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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
          <RoomDrawControl draw={roomDraw} variant="ink" />
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

  /* ── the roster, grouped by storey ──────────────────────────────────
     A flat list interleaves ground-floor and first-floor rooms with nothing
     to tell them apart. Group by floor, ordered the way the building stacks
     (top storey first, like a section), each group collapsible and carrying
     its own count so a folded floor still says it isn't empty.

     Numbering stays CONTINUOUS across the system: the number identifies the
     room, and restarting it per floor would renumber a room because a
     different storey gained one. */
  const groups = doc.floors
    .map((f) => ({ floor: f, rooms: rooms.filter((r) => r.floorId === f.id) }))
    .filter((g) => g.rooms.length > 0 || g.floor.id === floor.id)
    .reverse();
  /* one storey in the whole design: the header would be a wrapper around
     everything, saying nothing. Only stack a job that HAS a stack. */
  const grouped = doc.floors.length > 1;
  const numberOf = new Map(rooms.map((r, i) => [r.id, i + 1]));

  const roomRow = (r: RoomObj) => {
    const cov = roomCoverage(doc, pack, r, basis);
          // done = covered · none = nothing placed/pending · pending = in progress
          const dot =
            cov.status === "covered"
              ? "done"
              : cov.coveredKw === 0 && cov.pendingKw === 0
                ? "none"
                : "pending";
    const on = r.id === highlightRoomId;
    const roomName = String(r.props.name ?? "Room");
    return (
            <div key={r.id} className="ds-ck-rrow-wrap">
              <button
                className={`ds-ck-rrow${on ? " on" : ""}`}
                onClick={() => {
                  // follow the room to its own storey before selecting it
                  if (r.floorId !== floor.id) onFloor?.(r.floorId);
                  onSelect(r.id);
                }}
                title={
                  cov.status === "covered"
                    ? "Load covered"
                    : cov.loadKw != null
                      ? `${(cov.loadKw - cov.coveredKw).toFixed(1)} kW short`
                      : "Calibrate the floor to compute the load"
                }
              >
                <span className="ds-ck-rnum">{numberOf.get(r.id)}</span>
                <span className={`ds-ck-rdot ${dot}`} />
                <span className="ds-ck-rnm">{roomName}</span>
                {/* the room's heat load, on the row instead of buried in the
                    tooltip above — it's the number you scan the list for.
                    Nothing at all when there's no scale yet: "— kW" says
                    less than the grey status dot already does. */}
                {cov.loadKw != null && cov.loadKw > 0 && (
                  <span className="ds-ck-rload">{cov.loadKw.toFixed(1)} kW</span>
                )}
                {/* spill rooms carry the ⤢ badge and no sizing expectations
                    (ducted spec §9b–9c; the share slot arrives at Step 3) */}
                {ducted && isSpillRoom(r) && (
                  <span className="ds-ck-rspill" title="Spill room — receives spill air only">
                    ⤢
                  </span>
                )}
              </button>
              {/* Configure moved off the room card onto the pill (opens the room modal) */}
              <button
                className="ds-ck-rcfg"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditRoom(r.id);
                }}
                title={`Configure ${roomName} — name, area, heat load, walls`}
                aria-label="Configure room"
              >
                <Glyph name="configure" size={14} />
              </button>
            </div>
    );
  };

  return (
    <>
      <div className="ds-ck-roster">
        {!grouped && rooms.map(roomRow)}
        {grouped &&
          groups.map((g) => {
            const isActive = g.floor.id === floor.id;
            // the storey you're drawing on is never folded away — the Add
            // room control lives in it, and a room would land out of sight
            const shut = collapsed.has(g.floor.id) && !isActive;
            return (
              <div key={g.floor.id} className="ds-ck-fgrp">
                <button
                  className={`ds-ck-fhead${shut ? " shut" : ""}${isActive ? " on" : ""}`}
                  onClick={() =>
                    setCollapsed((c) => {
                      const next = new Set(c);
                      if (next.has(g.floor.id)) next.delete(g.floor.id);
                      else next.add(g.floor.id);
                      return next;
                    })
                  }
                  aria-expanded={!shut}
                  title={shut ? `Show ${g.floor.name}` : `Hide ${g.floor.name}`}
                >
                  <Glyph name="chev" size={12} />
                  <span className="fn">{g.floor.name}</span>
                  {/* the count is why a folded floor still tells you something */}
                  <span className="fc">
                    {g.rooms.length === 1 ? "1 room" : `${g.rooms.length} rooms`}
                  </span>
                </button>
                {!shut && g.rooms.map(roomRow)}
                {/* Add room belongs to the storey it will draw on, so it sits
                    under that floor's last room and moves when you change page */}
                {!shut && isActive && <RoomDrawControl draw={roomDraw} variant="row" />}
              </div>
            );
          })}
        {!grouped && <RoomDrawControl draw={roomDraw} variant="row" />}
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
          onMutate={onMutate}
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
  onMutate,
  onArmPlace,
  onRelease,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  room: RoomObj;
  basis: SizingBasis;
  /** ducted rooms show the spill toggle only — Outlets/Duct replace Units at
      Steps 3–4; Configure lives on the room pill; Pipework lives in Components */
  ducted?: boolean;
  /** per-room modules (multi / VRF): one indoor unit per room, shared outdoor */
  perRoom?: boolean;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  onRelease: (roomId: string) => void;
}) {
  const cov = roomCoverage(doc, pack, room, basis);
  const areaM2 = roomAreaM2(doc, room);
  const covered = cov.status === "covered";
  const shared = room.systemId !== system.id;
  const dot = covered ? "ok" : cov.status === "under" ? "under" : "none";
  /* ducted spill flag (spec §9c) — the engine excludes spill rooms from the
     required-capacity sums; toggle lives here now that Configure moved away */
  const setSpill = (on: boolean) =>
    onMutate((d) => ({
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
    <div className="ds-ck-inspect">
      <div className="ds-ck-ihead">
        <span className={`ds-ck-cdot ${dot}`} />
        <div className="ds-ck-itxt">
          <div className="ds-ck-iname">{String(room.props.name ?? "Room")}</div>
          {/* how big it is and what it needs — the two facts you open a room
              for. Covered/short isn't repeated: the badge to the right of
              this already says it. With no scale there are no numbers to
              give, so name the fix instead of printing "— · —". */}
          <div className="ds-ck-ifacts">
            {areaM2 == null && cov.loadKw == null
              ? "Calibrate the floor to size this room"
              : [
                  areaM2 == null ? null : `${areaM2.toFixed(1)} m²`,
                  cov.loadKw == null ? null : `${cov.loadKw.toFixed(1)} kW required`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
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
      {/* the room card carries unit selection only — Configure is on the pill,
          Pipework moved to the Components tab */}
      <div className="ds-ck-ibody">
        {ducted ? (
          <>
            <div className="ds-ck-pipeempty">Outlets arrive with ductwork — Step 3</div>
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
          </>
        ) : perRoom ? (
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
        )}
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
  const sysIdu = mine.find((o) => o.props.role === "idu") ?? null;
  /* A split is ONE pair serving ONE room — but a system can SERVE several
     rooms (a drop into a foreign room adopts it; "Serve an existing room"
     does the same). The pair belongs to the room its indoor unit is
     attributed to; every other served room gets a read-only note instead of
     the same unit again. Without this the one placed unit showed up on
     whichever room you clicked, as though it had migrated there — and could
     be recalled, or its pair re-chosen, from a room that doesn't own it.

     A unit dropped OUTSIDE any room carries no attribution: it stays visible
     on every served card rather than vanishing from the panel entirely,
     since there's no owning room to send you to. */
  const ownerRoomId = String(sysIdu?.props.roomId ?? system.settings.roomId ?? "") || null;
  const owns = ownerRoomId == null || ownerRoomId === room.id;
  const placedIdu = owns ? sysIdu : null;
  const placedOdu = owns ? (mine.find((o) => o.props.role === "odu") ?? null) : null;
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

  /* served by this split, but the pair lives in another room: say so and stop.
     Read-only on purpose — Recall and the pair picker both act on the SYSTEM,
     so offering them here would let you undo another room's work from a card
     that only looks like it owns the unit. */
  if (!owns) {
    const owner = doc.objects.find((o) => o.id === ownerRoomId);
    const ownerName = String(owner?.props.name ?? "another room");
    return (
      <div className="ds-ck-sub units">
        <div className="ds-ck-subh">
          <span className="ds-ck-st">
            <Glyph name="unitsq" size={14} />
            Units
          </span>
        </div>
        <div className="ds-ck-uempty" data-testid="units-elsewhere">
          <div className="ue-ic">
            <Glyph name="idu" size={20} />
          </div>
          <div>
            <div className="ue-t">Served by {system.name}</div>
            <div className="ue-s">Its indoor unit is in {ownerName} — change it there.</div>
          </div>
        </div>
      </div>
    );
  }

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
          {/* Same slot as the first-run button above — the action for this
              section sits UNDER what it acts on, so it reads as "these units,
              change them" rather than as a header control. It stays offered
              mid-placement: picking the wrong pair and placing one of them
              used to leave you stuck with it, and `choose` takes any placed
              unit back off the plan with it, so nothing is stranded. */}
          <button
            className="ds-ck-inkbtn"
            style={{ marginTop: 10 }}
            onClick={() => setBrowsing(true)}
            title="Swap the chosen units"
          >
            <Glyph name="rotate" size={16} />
            Swap units
          </button>
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
          <span className="ds-ck-utotag">Drag to place</span>
        )}
      </div>
      {kw != null && (
        <div className="ds-ck-ukw">
          {kw.toFixed(1)}
          <small> kW</small>
        </div>
      )}
      {/* The action column is ALWAYS here, even empty. Recall used to be
          absolutely positioned at `right: 10px` — the same spot the kW figure
          claims with `margin-left: auto` — so hovering the card dropped the
          button straight on top of the capacity. Reserving the slot means
          nothing overlaps and nothing shifts on hover; the button reveals
          into space that was already its own. Icon-only: the word cost ~46px
          of a 284px rail for a control that has a tooltip and a label. */}
      <div className="ds-ck-uact">
        {placed && onRecall && (
          <button
            className="ds-ck-recall"
            onClick={onRecall}
            title="Recall — take this unit back off the plan"
            aria-label={`Recall ${label} unit`}
          >
            <Glyph name="rotate" size={14} />
          </button>
        )}
      </div>
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

/* Multi-split pipework: a branch per placed indoor unit back to the shared
   outdoor, each at its port's pipe sizes, judged against the rule's
   per-branch, total and lift limits (multi_rules). Compatibility findings
   stay in the shared-outdoor section — only geometry renders here. */
const MULTI_GEOMETRY_CODES = new Set([
  "not-connected",
  "over-length",
  "over-total-length",
  "over-lift",
  "uncalibrated",
  "orphan-run",
]);

function MultiPipeworkSub({
  doc,
  pack,
  system,
  onSelect,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  onSelect: (id: string | null) => void;
}) {
  const v = useMemo(
    () => (pack ? validateMultiSystem(doc, pack, system.id) : null),
    [doc, pack, system.id]
  );
  const runs = doc.objects.filter(
    (o) => o.systemId === system.id && o.type === "pipe-run"
  );
  const risers = doc.objects.filter(
    (o) => o.systemId === system.id && o.type === "riser"
  );
  /* attached runs are accounted for inside the branches; loose ends stay
     visible (they also raise the amber orphan finding) */
  const loose = runs.filter((r) => !r.props.startAttach || !r.props.endAttach);

  const red = { color: "var(--ds-red-d)" } as const;
  const rule = v?.rule ?? null;
  const branches = v?.branches ?? [];
  const maxLiftM = branches.reduce<number | null>(
    (a, b) => (b.liftM == null ? a : a == null ? b.liftM : Math.max(a, b.liftM)),
    null
  );
  const overTotal =
    rule != null && v?.totalLengthM != null && v.totalLengthM > rule.max_total_pipe_m;
  const overLift = rule != null && maxLiftM != null && maxLiftM > rule.max_lift_m;
  const geomFindings = (v?.findings ?? []).filter((f) =>
    MULTI_GEOMETRY_CODES.has(f.code)
  );

  return (
    <div className="ds-ck-sub pipes" data-testid="multi-pipework">
      <div className="ds-ck-subh">
        <span className="ds-ck-st">
          <Glyph name="pipes" size={14} />
          Pipework
        </span>
      </div>
      {branches.length + loose.length + risers.length === 0 ? (
        <div className="ds-ck-pipeempty">No pipe run added yet</div>
      ) : (
        <>
          {branches.map((b) => {
            const over =
              rule != null && b.lengthM != null && b.lengthM > rule.max_per_branch_m;
            return (
              <button
                key={b.iduId}
                className="ds-ck-pipe"
                onClick={() => onSelect(b.iduId)}
              >
                <span className="ds-ck-pico">
                  <Glyph name="run" size={15} />
                </span>
                <div>
                  <div className="ds-ck-pt">
                    {b.roomName || b.model || "Indoor unit"}
                  </div>
                  <div className="ds-ck-ps">
                    {[
                      b.roomName ? b.model : null,
                      b.port != null ? `Port ${b.port + 1}` : null,
                      b.liquidMm != null && b.gasMm != null
                        ? `ø${b.liquidMm} / ø${b.gasMm}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <span
                  className="ds-ck-pv"
                  style={!b.connected || over ? red : undefined}
                >
                  {!b.connected
                    ? "Not connected"
                    : b.lengthM == null
                      ? "— m"
                      : rule
                        ? `${b.lengthM.toFixed(1)} / ${rule.max_per_branch_m} m`
                        : `${b.lengthM.toFixed(1)} m`}
                </span>
              </button>
            );
          })}
          {loose.map((r) => (
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
              <span className="ds-ck-pv">—</span>
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
          {rule && branches.length > 0 && (
            <>
              <div className="ds-ck-objrow" style={{ marginTop: 9 }}>
                <span>Total pipe</span>
                <b style={overTotal ? red : undefined}>
                  {v?.totalLengthM != null
                    ? `${v.totalLengthM.toFixed(1)} / ${rule.max_total_pipe_m} m`
                    : `— / ${rule.max_total_pipe_m} m`}
                </b>
              </div>
              <div className="ds-ck-objrow" style={{ marginTop: 5 }}>
                <span>Max lift</span>
                <b style={overLift ? red : undefined}>
                  {maxLiftM != null
                    ? `${maxLiftM.toFixed(1)} / ${rule.max_lift_m} m`
                    : `— / ${rule.max_lift_m} m`}
                </b>
              </div>
            </>
          )}
        </>
      )}
      {geomFindings.map((f) => (
        <div
          key={f.code + f.message}
          className={`ds-ck-mwarn${f.severity === "red" ? " red" : ""}`}
        >
          <Glyph name="alert" size={12} />
          {f.message}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── components view ─────────────────────────── */

function ComponentsView({
  doc,
  pack,
  rows,
  hasRooms,
  system,
  ducted,
  perRoom,
  onMutate,
  onSelect,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  rows: ComponentRow[];
  hasRooms: boolean;
  system: DesignSystem;
  /** ducted systems route air through ductwork, not refrigerant pipe runs */
  ducted: boolean;
  /** per-room modules (multi-split; VRF later) get the per-branch pipework */
  perRoom: boolean;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onSelect: (id: string | null) => void;
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

  /* Pipework (system refrigerant runs) moved here from the room card;
     per-room modules get the per-branch view with port sizes + limits */
  const pipework = ducted ? null : perRoom ? (
    <MultiPipeworkSub doc={doc} pack={pack} system={system} onSelect={onSelect} />
  ) : (
    <PipeworkSub doc={doc} system={system} onSelect={onSelect} />
  );

  if (rows.length === 0) {
    return (
      <>
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
        {pipework}
      </>
    );
  }

  return (
    <>
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
    {pipework}
    </>
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
    // deleting an AHU carries its plenums (spec §10.3 — confirm copy Step 8);
    // runs that attached to the object lose the ref and become open ends
    onMutate((d) => ({
      ...d,
      objects: stripAttachesTo(
        d.objects.filter(
          (o) => o.id !== obj.id && !(obj.type === "unit" && isPlenumOf(o, obj.id))
        ),
        new Set([obj.id])
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
        {air && (
          /* airflow direction is user-defined (spec §1a): flip swaps the
             faces until the first plenum locks the orientation */
          <div className="ds-ck-airflip">
            <span className="k">Airflow</span>
            <button
              type="button"
              disabled={fitted.length > 0}
              title={
                fitted.length > 0
                  ? "Orientation is set by the fitted plenum"
                  : "Swap which long face is supply"
              }
              onClick={() =>
                onMutate((d) => ({
                  ...d,
                  objects: d.objects.map((o) =>
                    o.id === obj.id
                      ? { ...o, props: { ...o.props, airFlip: o.props.airFlip !== true } }
                      : o
                  ),
                }))
              }
            >
              {fitted.length > 0 ? "Set by plenum" : "Flip"}
            </button>
          </div>
        )}
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
    // the mounting face is a LONG face — the unit's width (spec §1a)
    unitWidthMm: Number(unit?.props.widthMm) || null,
    spigots,
        stream,
  });
  /* Which face a NEW takeoff lands on. Sides fill first, then the far face:
     two ducts come off the sloped sides and the body closes to a V point;
     only a third needs a flat face to sit on, sized to that one duct. That's
     how these are drawn by hand (field sketch 2026-07-23) — defaulting every
     spigot to "front" forced a trapezoid the moment there were two.
     An explicit pick always wins and sticks. */
  const nextFreeFace = (): PlenumSpigot["face"] =>
    !spigots.some((s) => s.face === "left")
      ? "left"
      : !spigots.some((s) => s.face === "right")
        ? "right"
        : "front";
  const [facePick, setFacePick] = useState<PlenumSpigot["face"] | null>(null);
  const face = facePick ?? nextFreeFace();
  const setFace = (f: PlenumSpigot["face"]) => setFacePick(f);

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
          /* the OPENING (W × H) — what the duct has to fit through. The plan
             depth is geometry, not a spec figure, and never shown. */
          v={`${Math.round(body.baseWMm)} × ${
            body.openingHMm == null ? "—" : Math.round(body.openingHMm)
          } mm`}
        />
        {body.derived && (
          <div className="ds-ck-usub">estimated — no opening data in pack</div>
        )}
        {body.overSpigot && (
          <div className="ds-ck-usub warn">too many ducts for this plenum</div>
        )}
        {body.overHeight && (
          <div className="ds-ck-usub warn">
            duct taller than the opening — the plenum needs oversizing
          </div>
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
