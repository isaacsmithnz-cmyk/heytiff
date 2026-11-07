"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { IconButton } from "@/components/parts/button";
import { SearchField } from "@/components/parts/search-field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack, FormFactor, IndoorUnit } from "@/lib/studio/packs/schema";
import { indexNotation, indexText } from "@/lib/studio/packs/schema";
import { sizingCapacityKw, type SizingBasis } from "@/lib/studio/loads";
import { coverPct, coversLoad, FIT_RANK, shortKw, type UnitFit } from "@/lib/studio/fit";
import { roomLoadKw } from "@/lib/studio/loads-room";
import { multiCapableIdus, multiFormFactorSummary, multiUnitOptions, poolOf, type HeadPool } from "@/lib/studio/multi";
import { vrfBand } from "@/lib/studio/vrf";
import { headPipeMm } from "@/lib/studio/pipe-sizes";
import { formFactorSummary, unitOptions } from "@/lib/studio/select";
import { roomsServed } from "@/lib/studio/allocations";
import { outletsText, systemAir, unitAir, type RoomAir } from "@/lib/studio/airflow";
import { joinZone, setZoning, zoneKit, zoningOf, zonesOf, type UnitZoning, type ZoneControl } from "@/lib/studio/zoning";
import { DUCT_AIRWAY_FORMS } from "@/lib/studio/form-factors";
import { isDevice } from "@/lib/studio/devices";
import {
  addBandUnit,
  addHead,
  addSplitBeside,
  adoptLegacySystem,
  allocationsOf,
  chooseOutdoor,
  handBackToProposal,
  hasAllocations,
  moveAllocation,
  releaseSystem,
  removeAllocation,
  removeZone,
  roomsLabel,
  roomVerdict,
  setRoomsServed,
  swapAllocation,
  zonesToAdd,
  type Allocation,
} from "@/lib/studio/builder";
import { claimZone, newSystem, renameSystem, retypeSystem, type SystemFamily } from "@/lib/studio/zones";
import { brandName, combinationWord, doneBlockers, systemFindings } from "@/lib/studio/verdict";
import { readSystem } from "./system-builder";
import { unitMatchesQuery } from "./unit-browser";
import { StackDot, StackGroup, StackHead, StackRow, StackScreen, StackSection } from "./stack";

/* EDIT SYSTEM IN ONE COLUMN (the next flow; the "Edit system in one column"
   board). The right column beside the plan, never over it, so the plan stays
   in view: a system's rooms, heads, outdoor, connection, pipework and zoning
   down one list, and what a choice needs (a model, an outdoor, a room) pushed
   as a screen of the same column, back naming the system.

   It edits a DRAFT, as the builder does (system-builder.tsx): Done applies it
   as one change, Discard changes drops it, Delete system takes effect at once.
   It reads the system with the builder's own readSystem, so a zone's word here
   and on the builder's card can never differ, and every write is the engine's:
   this file lays out and wires, it does not decide. */

export interface SystemPanelProps {
  doc: DesignDocument;
  pack: DataPack;
  /** open on this unit: Swap from the plan (an outdoor opens the outdoors) */
  focus?: { systemId: string; allocationId: string } | null;
  /** the one system being edited; without one the unit's, else the first, and
      with none at all a new one is started in the draft */
  systemId?: string | null;
  /** a draft to start from instead of the design: a zone moved onto this
      system, so Done applies the move and Discard changes undoes it */
  start?: DesignDocument;
  /** open with this room unfolded and in view */
  aimZoneId?: string | null;
  /** Done: the built design, as one change */
  onCommit: (next: DesignDocument) => void;
  onClose: () => void;
}

type SystemView = ReturnType<typeof readSystem>;
type ZoneView = SystemView["zones"][number];
type Tone = "good" | "look" | "bad";

/** what a pushed model list is choosing for */
type ModelTarget =
  | { kind: "add"; zoneId: string }
  | { kind: "split"; zoneId: string }
  | { kind: "band" }
  | { kind: "swap"; allocationId: string };

type Screen =
  | { name: "model"; target: ModelTarget }
  | { name: "outdoor" }
  | { name: "rooms" }
  | { name: "types" };

const FAMILY_OPTIONS: readonly { value: SystemFamily; label: string }[] = [
  { value: "split", label: "Split" },
  { value: "multi", label: "Multi" },
  { value: "ducted", label: "Ducted" },
  { value: "vrf", label: "VRF" },
];

const CONTROL_OPTIONS: readonly { value: ZoneControl; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on_off", label: "On/off" },
  { value: "temperature", label: "Temperature" },
];

const SENSOR_OPTIONS: readonly { value: UnitZoning["sensors"]; label: string }[] = [
  { value: "wireless", label: "Wireless" },
  { value: "wired", label: "Wired" },
];

/** past this many rooms, a covered room folds to one line */
const FOLD_PAST = 4;

const kwText = (kw: number | null | undefined): string => (kw == null ? "—" : `${kw.toFixed(1)} kW`);
const toneOf = (tone: "ok" | "bad" | "warn" | "quiet"): Tone | null =>
  tone === "ok" ? "good" : tone === "warn" ? "look" : tone === "bad" ? "bad" : null;
const iduRowOf = (pack: DataPack, model: string): IndoorUnit | null =>
  pack.indoor_units.find((u) => u.model === model) ?? null;
const kwOf = (pack: DataPack, model: string, basis: SizingBasis): number | null => {
  const row = iduRowOf(pack, model);
  return row ? sizingCapacityKw(row, basis) : null;
};
/** a state's class: named as a state, for the guard on the OK colour */
const stateClass = (tone: Tone | null): string => `ds-syp-state${tone ? ` ${tone === "good" ? "ok" : tone}` : ""}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ─────────────────────────── opening the draft ─────────────────────────── */

/** the draft to start on, the system it edits, and what Done measures a change
    against: the design as it stands, or the given draft's design, so a draft
    that came in holding a move is applied by Done */
function openDraft(
  doc: DesignDocument,
  given: DesignDocument | undefined,
  pack: DataPack,
  wanted: string | null
): { first: DesignDocument; base: DesignDocument; sysId: string; made: boolean } {
  const from = given ?? doc;
  const adopted = from.systems.reduce((d, s) => adoptLegacySystem(d, pack, s.id), from);
  const sysId = wanted ?? adopted.systems[0]?.id ?? null;
  if (sysId && adopted.systems.some((s) => s.id === sysId)) {
    return { first: adopted, base: given ? doc : adopted, sysId, made: false };
  }
  const started = newSystem(adopted, pack.meta.version);
  return { first: started.doc, base: started.doc, sysId: started.systemId, made: true };
}

/* ─────────────────────────── the words ─────────────────────────── */

/** the system's one line under its figures */
function systemWord(view: SystemView): { text: string; tone: Tone } | null {
  if (view.empty) return null;
  const short = view.zones.filter((z) => z.short).length;
  const bare = view.zones.filter((z) => !z.short && z.lines.length === 0 && z.word.tone === "warn").length;
  const lead = short
    ? `${plural(short, "room", "rooms")} short`
    : bare
      ? `${plural(bare, "room", "rooms")} without a unit`
      : view.zonesLoadKw != null
        ? "Covered"
        : null;
  const combo = view.combination === "Valid" ? "combination valid" : view.combination === "Fails" ? "combination fails" : null;
  const text = [lead, combo].filter(Boolean).join(", ");
  if (!text) return null;
  const tone: Tone = view.combination === "Fails" || short ? "bad" : bare ? "look" : "good";
  return { text: text[0].toUpperCase() + text.slice(1), tone };
}

/** a zone's word, with what covers it where the board gives the figure */
const roomWord = (z: ZoneView): string =>
  z.word.text === "Covered" && z.lines.length > 0 ? `Covered, ${z.verdict.coverKw.toFixed(1)} kW` : z.word.text;

/** connection: the figure, and the top the book gives where it gives a ratio.
    Where the book is a combination table the table decides, so no top is said */
function connectionWords(pack: DataPack, view: SystemView): string | null {
  if (!view.ratio || !view.oduRow) return null;
  const odu = view.oduRow;
  const band =
    odu.system_type === "vrf"
      ? vrfBand(odu, view.heads.length)
      : (pack.multi_rules.find((r) => r.odu_model_ref === odu.model)?.compatibility.find((c) => c.method === "index_ratio_band") ?? null);
  const top = band && band.method === "index_ratio_band" ? band.ratio_max_pct : null;
  return `${view.ratio.pct}% of the outdoor${top != null ? `, up to ${top}% allowed` : ""}`;
}

function pipeworkWords(view: SystemView): string | null {
  if (!view.oduRow) return null;
  if (view.bandUnits.length) return "One line pair, ducted to each zone";
  if (view.oduRow.system_type === "multi") return "One line pair per port";
  if (view.oduRow.system_type !== "vrf") return "One line pair";
  const fittings = view.vrfTree?.fittings ?? [];
  const boxes = fittings.filter((f) => f.kind === "box").length;
  const joints = fittings.length - boxes;
  return [
    "One shared line",
    joints ? plural(joints, "branch joint", "branch joints") : null,
    boxes ? plural(boxes, "branch box", "branch boxes") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** where the plan has the outdoor */
function outdoorWhere(draft: DesignDocument, view: SystemView): string {
  const placed = view.odu ? draft.objects.find((o) => o.id === view.odu?.id) : undefined;
  if (!placed) return "Not on the plan yet";
  if (placed.plane === "external-roof") return "On the roof";
  const floor = draft.floors.find((f) => f.id === placed.floorId);
  return !floor || floor.level === 0 ? "On the ground" : `Outside, ${floor.name}`;
}

/** the short name a book gives a size ("P25"), else the model */
function sizeName(pack: DataPack, u: IndoorUnit): string {
  const notation = indexNotation(pack, u.brand);
  return u.capacity_index != null && !notation.includes(" ") ? indexText(notation, u.capacity_index) : u.model;
}

/* ─────────────────────────── reading ─────────────────────────── */

/** the sizes a head could be: its series, in units this system type can take */
function sizesOf(pack: DataPack, sys: DesignSystem, current: IndoorUnit | null): IndoorUnit[] {
  if (!current) return [];
  const pairFlow = sys.type === "split" || sys.type === "ducted";
  const pool = pairFlow
    ? pack.indoor_units.filter((u) => pack.pair_tables.some((p) => p.idu_model === u.model))
    : sys.type === "vrf"
      ? poolOf(pack, "vrf")
      : multiCapableIdus(pack);
  return pool
    .filter((u) => u.series === current.series)
    .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model));
}

interface Smaller {
  allocationId: string;
  model: string;
  name: string;
  pct: number;
}

/** an oversized room with one head on it: the smallest size of its series that
    fits the room and that the combination still takes */
function smallerFor(draft: DesignDocument, pack: DataPack, basis: SizingBasis, view: SystemView, z: ZoneView): Smaller | null {
  if (z.verdict.word !== "Oversized" || z.lines.length !== 1 || !z.lines[0].mine) return null;
  const head = z.lines[0].alloc;
  if (roomsServed(head).length > 1) return null;
  const nowKw = kwOf(pack, head.model, basis);
  if (nowKw == null) return null;
  const sizes = sizesOf(pack, view.sys, iduRowOf(pack, head.model))
    .map((u) => ({ u, kw: sizingCapacityKw(u, basis) }))
    .filter((s) => s.kw < nowKw)
    .sort((a, b) => a.kw - b.kw);
  for (const { u } of sizes) {
    const swap = swapAllocation(draft, pack, basis, view.sys.id, head.id, u.model);
    if (!swap.ok) continue;
    const verdict = roomVerdict(swap.doc, pack, basis, z.zone);
    if (verdict.word !== "Fits" || verdict.loadKw == null) continue;
    const after = swap.doc.systems.find((s) => s.id === view.sys.id);
    if (!after || doneBlockers(systemFindings(swap.doc, pack, after)).length) continue;
    return {
      allocationId: head.id,
      model: u.model,
      name: sizeName(pack, u),
      pct: coverPct(verdict.coverKw, verdict.loadKw) ?? 0,
    };
  }
  return null;
}

/** a system's rooms in the column: a room each, and one group for a unit given
    several of them (one line to the outdoor, its air to each room) */
function roomRows(view: SystemView): { z: ZoneView; group: { unit: Allocation; zones: ZoneView[] } | null }[] {
  const groupOf = new Map<string, Allocation>();
  for (const a of view.heads) {
    const served = roomsServed(a);
    if (served.length > 1) for (const r of served) if (!groupOf.has(r)) groupOf.set(r, a);
  }
  const rows: { z: ZoneView; group: { unit: Allocation; zones: ZoneView[] } | null }[] = [];
  const grouped = new Set<string>();
  for (const z of view.zones) {
    const unit = groupOf.get(z.zone.id);
    if (!unit) {
      rows.push({ z, group: null });
      continue;
    }
    if (grouped.has(unit.id)) continue;
    grouped.add(unit.id);
    const zones = roomsServed(unit)
      .map((id) => view.zones.find((x) => x.zone.id === id))
      .filter((x): x is ZoneView => x != null);
    rows.push({ z: zones[0] ?? z, group: { unit, zones } });
  }
  return rows;
}

const airWords = (r: RoomAir | null | undefined): string | null =>
  r ? `${Math.round(r.ls)} L/s, ${outletsText(r)}` : null;

/* ─────────────────────────── the panel ─────────────────────────── */

export function SystemPanel({
  doc,
  pack,
  focus = null,
  systemId = null,
  start: startFrom,
  aimZoneId = null,
  onCommit,
  onClose,
}: SystemPanelProps) {
  const basis: SizingBasis = doc.settings.sizingBasis;
  const [opening] = useState(() => openDraft(doc, startFrom, pack, systemId ?? focus?.systemId ?? null));
  const { base, sysId, made } = opening;

  const [draft, setDraftNow] = useState<DesignDocument>(opening.first);
  /* ⌘Z here takes back the last change to the draft, as in the builder */
  const [past, setPast] = useState<DesignDocument[]>([]);
  const [future, setFuture] = useState<DesignDocument[]>([]);
  const setDraft = (next: DesignDocument) => {
    if (next === draft) return;
    setPast((p) => [...p, draft].slice(-50));
    setFuture([]);
    setDraftNow(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) {
        const next = future[future.length - 1];
        if (!next) return;
        setFuture(future.slice(0, -1));
        setPast([...past, draft]);
        setDraftNow(next);
      } else {
        const prev = past[past.length - 1];
        if (!prev) return;
        setPast(past.slice(0, -1));
        setFuture([...future, draft]);
        setDraftNow(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [past, future, draft]);
  /** anything Done would apply, so anything leaving would lose */
  const changed = draft !== base;

  const sys = draft.systems.find((s) => s.id === sysId) ?? null;
  const view = useMemo(() => (sys ? readSystem(draft, pack, basis, sys) : null), [draft, pack, basis, sys]);

  const [error, setError] = useState<string | null>(null);
  const [formFactor, setFormFactor] = useState<FormFactor | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  /** covered rooms unfolded by hand, when a long system folds them */
  const [openRooms, setOpenRooms] = useState<string[]>(() => (aimZoneId ? [aimZoneId] : []));
  /* a room aimed at unfolds: adjusted while rendering when the aim changes,
     as React has state follow a prop, not in an effect */
  const [aimSeen, setAimSeen] = useState(aimZoneId);
  if (aimZoneId !== aimSeen) {
    setAimSeen(aimZoneId);
    if (aimZoneId && !openRooms.includes(aimZoneId)) setOpenRooms([...openRooms, aimZoneId]);
  }

  /* what is pushed over the system, deepest last. A Swap from the plan opens on
     its unit, a move that could not be installed on the outdoors, where the fix is */
  const [stack, setStack] = useState<Screen[]>(() => {
    const s = opening.first.systems.find((x) => x.id === sysId);
    if (!s) return [];
    if (startFrom && doneBlockers(systemFindings(opening.first, pack, s)).length) return [{ name: "outdoor" }];
    const opened = focus && hasAllocations(s) ? allocationsOf(s).find((a) => a.id === focus.allocationId) : null;
    if (!opened) return [];
    return opened.role === "odu" ? [{ name: "outdoor" }] : [{ name: "model", target: { kind: "swap", allocationId: opened.id } }];
  });
  const top = stack[stack.length - 1] ?? null;
  const push = (s: Screen) => setStack((all) => [...all, s]);
  const pop = () => setStack((all) => all.slice(0, -1));
  const toSystem = () => setStack([]);

  /* Esc steps back through what is pushed, and leaves only with nothing to lose */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (stack.length) {
        setStack(stack.slice(0, -1));
        return;
      }
      if (!changed) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack, changed, onClose]);

  const rootRef = useRef<HTMLDivElement>(null);
  /* a pushed screen takes the focus, or it would be left on a hidden row */
  const depth = stack.length;
  useEffect(() => {
    if (depth) rootRef.current?.querySelector<HTMLElement>(".ds-syp-layer:not([hidden]) .ds-stack-back")?.focus();
  }, [depth]);
  /* and comes into view */
  useEffect(() => {
    if (!aimZoneId) return;
    const groups = rootRef.current ? [...rootRef.current.querySelectorAll("[data-zone]")] : [];
    groups.find((g) => g.getAttribute("data-zone") === aimZoneId)?.scrollIntoView?.({ block: "nearest" });
  }, [aimZoneId]);

  const smaller = useMemo(() => {
    const out = new Map<string, Smaller>();
    if (!view) return out;
    for (const z of view.zones) {
      const s = smallerFor(draft, pack, basis, view, z);
      if (s) out.set(z.zone.id, s);
    }
    return out;
  }, [draft, pack, basis, view]);

  /* the head types on offer: the pack's styles, for the flow the family drives */
  const perRoom = view ? view.family !== "split" && view.family !== "ducted" : false;
  const ductedFamily = view?.family === "ducted";
  const headPool: HeadPool = view && (view.kind === "vrf" || view.family === "vrf") ? "vrf" : "multi";
  const headTypes = useMemo(
    () =>
      (perRoom ? multiFormFactorSummary(pack, null, basis, headPool) : formFactorSummary(pack, null, basis))
        .map((t) => ({ value: t.formFactor, label: t.label }))
        .filter((t) => !ductedFamily || DUCT_AIRWAY_FORMS.includes(t.value)),
    [perRoom, pack, basis, headPool, ductedFamily]
  );
  const firstHeadType = view?.heads[0] ? (iduRowOf(pack, view.heads[0].model)?.form_factor ?? null) : null;
  const headType: FormFactor | null =
    (formFactor && headTypes.some((t) => t.value === formFactor) ? formFactor : null) ??
    (firstHeadType && headTypes.some((t) => t.value === firstHeadType) ? firstHeadType : null) ??
    (headTypes.some((t) => t.value === (ductedFamily ? "ducted" : "wall"))
      ? ductedFamily
        ? "ducted"
        : "wall"
      : (headTypes[0]?.value ?? null));
  const headTypeLabel = headTypes.find((t) => t.value === headType)?.label ?? null;

  /* ── writes: every one is the engine's, on the draft ── */
  const write = (next: DesignDocument) => {
    setError(null);
    setDraft(next);
  };

  if (!view || !sys) return null;

  /** the family is a starting point: it is written to the system, its type
      re-read, and a proposal (never a pick) made again */
  const pickFamily = (family: SystemFamily) => {
    let d: DesignDocument = {
      ...draft,
      systems: draft.systems.map((s) => (s.id === sys.id ? { ...s, settings: { ...s.settings, family } } : s)),
    };
    d = retypeSystem(d, pack, sys.id);
    if (sys.settings.oduChosen !== true) d = handBackToProposal(d, pack, sys.id);
    write(d);
  };
  const openSwap = (alloc: Allocation) => {
    setFormFactor(iduRowOf(pack, alloc.model)?.form_factor ?? null);
    push({ name: "model", target: { kind: "swap", allocationId: alloc.id } });
  };
  /* Choose another model: the unit opened from the plan, else the first head;
     with none yet, the first room waiting for one, or the rooms to pick from */
  const chooseModel = () => {
    const focused = focus ? view.heads.find((a) => a.id === focus.allocationId) : null;
    const head = focused ?? view.heads[0] ?? null;
    if (head) return openSwap(head);
    if (ductedFamily) return push({ name: "model", target: { kind: "band" } });
    const waiting = view.zones.find((z) => z.zone.id === aimZoneId) ?? view.zones.find((z) => !z.lines.some((l) => l.mine));
    if (waiting) return push({ name: "model", target: { kind: "add", zoneId: waiting.zone.id } });
    push({ name: "rooms" });
  };
  const pickModel = (target: ModelTarget, model: string) => {
    if (target.kind === "add") write(addHead(draft, pack, { systemId: sys.id, zoneId: target.zoneId, iduModel: model }));
    else if (target.kind === "split") write(addSplitBeside(draft, pack, { zoneId: target.zoneId, iduModel: model }).doc);
    else if (target.kind === "band") write(addBandUnit(draft, pack, { systemId: sys.id, iduModel: model }));
    else {
      const swap = swapAllocation(draft, pack, basis, sys.id, target.allocationId, model);
      if (!swap.ok) setError(swap.reason ?? null);
      else write(swap.doc);
    }
    toSystem();
  };
  const commitRename = () => {
    write(renameSystem(draft, sys.id, nameDraft));
    setRenaming(false);
  };

  const headsKw = view.heads.reduce<number | null>((n, a) => {
    const kw = kwOf(pack, a.model, basis);
    return kw == null ? n : (n ?? 0) + kw;
  }, null);
  const standing = systemWord(view);
  const rows = roomRows(view);
  const folding = rows.length > FOLD_PAST;
  const canAddRoom = zonesToAdd(draft, sys.id).length > 0;
  const connection = connectionWords(pack, view);
  const pipework = pipeworkWords(view);
  const airs = systemAir(draft, pack, sys);
  const band = view.bandUnits[0] ?? null;
  const zoned = view.heads.filter((a) => (unitAir(draft, pack, sys, a)?.rooms.length ?? 0) > 0);
  /* heads of a room each share one tray, as the board has it. A unit given a
     group of rooms has its own, and then a head of one room says nothing until
     it is set. Units already set differently each keep their own. */
  const roomsOf = (a: Allocation) => unitAir(draft, pack, sys, a)?.rooms.length ?? 0;
  const someGroup = zoned.some((a) => roomsOf(a) > 1);
  const shareTray =
    zoned.length > 1 && !someGroup && zoned.every((a) => zoningOf(sys, a.id).control === zoningOf(sys, zoned[0].id).control);
  const placedControllers = draft.objects.filter((o) => isDevice(o) && o.type === "wall-controller" && o.systemId === sys.id).length;
  const addOpens = (z: ZoneView): ModelTarget => ({ kind: z.slot === "split" ? "split" : "add", zoneId: z.zone.id });

  return (
    <div className="ds-syp" ref={rootRef}>
      <div className="ds-syp-layer" hidden={top != null}>
        <StackScreen
          label={`Edit ${view.sys.name}`}
          foot={
            <>
              {(error || view.reason) && (
                <p className="ds-syp-reason" role="alert">
                  {error ?? view.reason}
                </p>
              )}
              <button
                type="button"
                className="ds-stack-main"
                disabled={view.blocking.length > 0}
                onClick={() => (changed ? onCommit(draft) : onClose())}
              >
                Done
              </button>
              <div className="ds-syp-footrow">
                {!made && (
                  <button
                    type="button"
                    className="ds-stack-danger"
                    onClick={() => {
                      onCommit(releaseSystem(doc, view.sys.id));
                      onClose();
                    }}
                  >
                    Delete system
                  </button>
                )}
                <button type="button" className="ds-stack-second" onClick={onClose}>
                  Discard changes
                </button>
              </div>
            </>
          }
        >
          {/* back leaves only with nothing to lose; with changes, the foot says which way */}
          <StackHead
            back={changed ? undefined : "Systems"}
            onBack={changed ? undefined : onClose}
            name={
              renaming ? (
                <input
                  className="ds-syp-name-input"
                  aria-label="System name"
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="ds-syp-name"
                  aria-label={`Rename ${view.sys.name}`}
                  onClick={() => {
                    setNameDraft(view.sys.name);
                    setRenaming(true);
                  }}
                >
                  <StackDot colour={view.sys.colour} />
                  {view.sys.name}
                </button>
              )
            }
          />

          <div className="ds-syp-block">
            <button type="button" className="ds-stack-small" onClick={chooseModel}>
              {view.heads.length ? "Choose another model" : "Choose a model"}
            </button>
          </div>
          <div className="ds-syp-block">
            <Tray ariaLabel="System type" options={FAMILY_OPTIONS} value={view.family} onChange={pickFamily} />
          </div>

          <StackGroup>
            {headTypeLabel && <StackRow name={`${headTypeLabel} heads`} chevron onPress={() => push({ name: "types" })} />}
            <StackRow name={brandName(pack, pack.meta.brand)} />
          </StackGroup>

          {!(view.empty && view.zones.length === 0) && (
            <StackGroup>
              <dl className="ds-syp-figs">
                <div>
                  <dt>Load</dt>
                  <dd>{view.loadText}</dd>
                </div>
                <div>
                  <dt>Heads</dt>
                  <dd>{kwText(headsKw)}</dd>
                </div>
                <div>
                  <dt>Outdoor</dt>
                  <dd>{view.oduRow ? kwText(sizingCapacityKw(view.oduRow, basis)) : "—"}</dd>
                </div>
              </dl>
              {standing && (
                <p className={`ds-syp-standing ${stateClass(standing.tone)}`} role="status">
                  {standing.text}
                </p>
              )}
            </StackGroup>
          )}

          {/* a whole-system unit: what its rooms are fed by, above them */}
          {(band || ductedFamily) && (
            <StackGroup>
              <StackRow name={<span className="ds-syp-strong">Whole system</span>} />
              {band ? (
                <HeadRow
                  model={band.model}
                  kw={kwOf(pack, band.model, basis)}
                  onModel={() => openSwap(band)}
                  onRemove={() => write(removeAllocation(draft, sys.id, band.id, pack))}
                />
              ) : (
                <StackRow name="No unit yet">
                  <button type="button" className="ds-stack-small" onClick={() => push({ name: "model", target: { kind: "band" } })}>
                    Choose a unit
                  </button>
                </StackRow>
              )}
            </StackGroup>
          )}

          {rows.map(({ z, group }) => {
            if (group) {
              return (
                <div key={`group:${group.unit.id}`} data-zone={z.zone.id}>
                  <UnitGroup
                    draft={draft}
                    pack={pack}
                    basis={basis}
                    view={view}
                    unit={group.unit}
                    zones={group.zones}
                    air={airs.find((u) => u.unit.id === group.unit.id)?.rooms ?? []}
                    onModel={() => openSwap(group.unit)}
                    onRemove={() => write(removeAllocation(draft, sys.id, group.unit.id, pack))}
                    onClear={(zoneId) => write(removeZone(draft, pack, sys.id, zoneId))}
                  />
                </div>
              );
            }
            const fold = folding && z.word.tone === "ok" && !openRooms.includes(z.zone.id);
            return (
              <div key={z.zone.id} data-zone={z.zone.id}>
                {fold ? (
                  <StackGroup>
                    <StackRow
                      name={z.name}
                      sub={band ? kwText(z.loadKw) : plural(z.lines.length, "head", "heads")}
                      value={roomWord(z)}
                      tone="good"
                      label={`${z.name}, ${roomWord(z)}, open the room`}
                      onPress={() => setOpenRooms((o) => [...o, z.zone.id])}
                    >
                      <span className="ds-stack-chev" aria-hidden="true">
                        <Icon name="chevD" size={16} />
                      </span>
                    </StackRow>
                  </StackGroup>
                ) : (
                  <RoomGroup
                    draft={draft}
                    view={view}
                    z={z}
                    air={airWords(band ? airs.find((u) => u.unit.id === band.id)?.rooms.find((r) => r.roomId === z.zone.id) : null)}
                    canAdd={!ductedFamily && !band}
                    smaller={smaller.get(z.zone.id) ?? null}
                    onModel={openSwap}
                    onRemove={(a) => write(removeAllocation(draft, sys.id, a.id, pack))}
                    onAdd={() => push({ name: "model", target: addOpens(z) })}
                    onUse={(s) => {
                      const swap = swapAllocation(draft, pack, basis, sys.id, s.allocationId, s.model);
                      if (swap.ok) write(swap.doc);
                      else setError(swap.reason ?? null);
                    }}
                    onClear={() => write(removeZone(draft, pack, sys.id, z.zone.id))}
                  />
                )}
              </div>
            );
          })}

          {view.strays.length > 0 && (
            <StackGroup>
              <StackRow name={<span className="ds-syp-strong">No room</span>} />
              {view.strays.map((a) => (
                <HeadRow
                  key={a.id}
                  model={a.model}
                  kw={kwOf(pack, a.model, basis)}
                  onModel={() => openSwap(a)}
                  onRemove={() => write(removeAllocation(draft, sys.id, a.id, pack))}
                />
              ))}
            </StackGroup>
          )}

          {(canAddRoom || view.zones.length === 0) && (
            <StackGroup>
              {canAddRoom ? (
                <StackRow name="Add a room" chevron onPress={() => push({ name: "rooms" })} />
              ) : (
                <StackRow name="No rooms on the plan yet" />
              )}
            </StackGroup>
          )}

          {!view.empty || view.zones.length > 0 ? (
            <StackGroup>
              <StackRow name={<span className="ds-syp-strong">Outdoor</span>} sub={view.odu ? outdoorWhere(draft, view) : undefined} />
              {view.odu ? (
                <StackRow
                  name={
                    <button type="button" className="ds-syp-model" onClick={() => push({ name: "outdoor" })}>
                      {view.odu.model}
                      <Icon name="chevD" size={12} />
                    </button>
                  }
                  sub={view.oduByHand ? "Picked" : "Proposed"}
                  value={view.oduRow ? kwText(sizingCapacityKw(view.oduRow, basis)) : "—"}
                />
              ) : (
                <StackRow name="No outdoor yet">
                  <button type="button" className="ds-stack-small" onClick={() => push({ name: "outdoor" })}>
                    Choose an outdoor
                  </button>
                </StackRow>
              )}
              {connection && <StackRow name="Connection" sub={connection} />}
              {pipework && <StackRow name="Pipework" sub={pipework} />}
            </StackGroup>
          ) : null}

          {!view.empty && (
            <StackGroup>
              <StackRow name={<span className="ds-syp-strong">Zones and controls</span>} />
              {shareTray && (
                <StackRow name="Zoning">
                  <Tray
                    ariaLabel="Zoning"
                    options={CONTROL_OPTIONS}
                    value={zoningOf(sys, zoned[0].id).control}
                    onChange={(control) => write(zoned.reduce((d, a) => setZoning(d, sys.id, a.id, { control }), draft))}
                  />
                </StackRow>
              )}
              {zoned
                .filter((a) => !shareTray || zoningOf(sys, a.id).control !== "off")
                .filter((a) => shareTray || zoned.length === 1 || !someGroup || roomsOf(a) > 1 || zoningOf(sys, a.id).control !== "off")
                .map((a) => (
                  <ZoningRows
                    key={a.id}
                    draft={draft}
                    pack={pack}
                    sys={sys}
                    alloc={a}
                    tray={shareTray ? "none" : zoned.length > 1 ? "named" : "plain"}
                    onChange={write}
                  />
                ))}
              <StackRow name="Controllers" value={placedControllers ? `${placedControllers} on the plan` : "None on the plan"} />
            </StackGroup>
          )}
        </StackScreen>
      </div>

      {top?.name === "model" && (
        <div className="ds-syp-layer">
          <ModelScreen
            draft={draft}
            pack={pack}
            basis={basis}
            view={view}
            target={top.target}
            perRoom={perRoom}
            pool={headPool}
            headType={headType}
            headTypeLabel={headTypeLabel}
            ductedFamily={ductedFamily}
            onBack={pop}
            onTypes={() => push({ name: "types" })}
            onPick={(model) => pickModel(top.target, model)}
            onWrite={write}
          />
        </div>
      )}
      {top?.name === "outdoor" && (
        <div className="ds-syp-layer">
          <OutdoorScreen
            pack={pack}
            basis={basis}
            view={view}
            onBack={pop}
            onPick={(model) => {
              write(chooseOutdoor(draft, pack, basis, sys.id, model));
              pop();
            }}
            onProposal={() => {
              write(handBackToProposal(draft, pack, sys.id));
              pop();
            }}
          />
        </div>
      )}
      {top?.name === "rooms" && (
        <div className="ds-syp-layer">
          <RoomsScreen
            draft={draft}
            sysId={sys.id}
            back={view.sys.name}
            onBack={pop}
            onPick={(zoneId) => {
              write(claimZone(draft, sys.id, zoneId));
              pop();
            }}
          />
        </div>
      )}
      {top?.name === "types" && (
        <div className="ds-syp-layer">
          <StackScreen label="Head type">
            <StackHead name="Head type" back={stack.length > 1 ? "Models" : view.sys.name} onBack={pop} />
            <StackGroup>
              {headTypes.map((t) => (
                <StackRow
                  key={t.value}
                  name={`${t.label} heads`}
                  onPress={() => {
                    setFormFactor(t.value);
                    pop();
                  }}
                >
                  {t.value === headType && <Chosen />}
                </StackRow>
              ))}
            </StackGroup>
          </StackScreen>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── a room and its heads ─────────────────────────── */

function Chosen() {
  return (
    <span className="ds-syp-on" role="img" aria-label="Chosen">
      <Icon name="check" size={16} />
    </span>
  );
}

function HeadRow({
  model,
  kw,
  onModel,
  onRemove,
}: {
  model: string;
  kw: number | null;
  onModel: () => void;
  onRemove: () => void;
}) {
  return (
    <StackRow
      name={
        <button type="button" className="ds-syp-model" onClick={onModel}>
          {model}
          <Icon name="chevD" size={12} />
        </button>
      }
      value={kwText(kw)}
    >
      <button type="button" className="ds-syp-remove" aria-label={`Remove ${model}`} onClick={onRemove}>
        Remove
      </button>
    </StackRow>
  );
}

function RoomHead({ name, sub, onClear, sysName }: { name: string; sub: string; onClear: () => void; sysName: string }) {
  return (
    <StackRow name={<span className="ds-syp-strong">{name}</span>} sub={sub}>
      <IconButton glyph="clear" label={`Clear ${name} from ${sysName}`} size={32} className="ds-syp-edge" onClick={onClear} />
    </StackRow>
  );
}

const floorOf = (draft: DesignDocument, z: ZoneView): string | null =>
  draft.floors.find((f) => f.id === z.zone.floorId)?.name ?? null;

function RoomGroup({
  draft,
  view,
  z,
  air,
  canAdd,
  smaller,
  onModel,
  onRemove,
  onAdd,
  onUse,
  onClear,
}: {
  draft: DesignDocument;
  view: SystemView;
  z: ZoneView;
  /** the air it gets from a whole-system unit */
  air: string | null;
  canAdd: boolean;
  smaller: Smaller | null;
  onModel: (a: Allocation) => void;
  onRemove: (a: Allocation) => void;
  onAdd: () => void;
  onUse: (s: Smaller) => void;
  onClear: () => void;
}) {
  const tone = toneOf(z.word.tone);
  const word = roomWord(z);
  const sub = [z.loadKw != null ? kwText(z.loadKw) : "No load yet", floorOf(draft, z)].filter(Boolean).join(", ");
  return (
    <StackGroup>
      <RoomHead name={z.name} sub={sub} sysName={view.sys.name} onClear={onClear} />
      {air && <StackRow name="Air" sub={air} />}
      {z.lines.map((line) =>
        line.mine ? (
          <HeadRow
            key={line.alloc.id}
            model={line.alloc.model}
            kw={line.kw}
            onModel={() => onModel(line.alloc)}
            onRemove={() => onRemove(line.alloc)}
          />
        ) : (
          <StackRow
            key={line.alloc.id}
            lead={<StackDot colour={line.sys.colour} />}
            name={line.alloc.model}
            sub={line.sys.name}
            value={kwText(line.kw)}
          />
        )
      )}
      {smaller ? (
        <StackRow
          name={<span className={stateClass(tone)}>{word}</span>}
          sub={`${smaller.name} covers it at ${smaller.pct}%`}
        >
          <button type="button" className="ds-stack-small" onClick={() => onUse(smaller)}>
            Use {smaller.name}
          </button>
        </StackRow>
      ) : (
        (word || canAdd) && (
          <StackRow name={word ? <span className={stateClass(tone)}>{word}</span> : "No unit yet"}>
            {canAdd && (
              <button type="button" className="ds-syp-quiet" aria-label={`Add a head in ${z.name}`} onClick={onAdd}>
                {z.slot === "split" ? "Add another split" : "Add a head here"}
              </button>
            )}
          </StackRow>
        )
      )}
    </StackGroup>
  );
}

/** one unit given a group of the system's rooms, judged as one against their
    loads together */
function UnitGroup({
  draft,
  pack,
  basis,
  view,
  unit,
  zones,
  air,
  onModel,
  onRemove,
  onClear,
}: {
  draft: DesignDocument;
  pack: DataPack;
  basis: SizingBasis;
  view: SystemView;
  unit: Allocation;
  zones: ZoneView[];
  air: RoomAir[];
  onModel: () => void;
  onRemove: () => void;
  onClear: (zoneId: string) => void;
}) {
  const unitKw = kwOf(pack, unit.model, basis);
  const loads = zones.map((m) => m.loadKw);
  const groupLoad = loads.some((l) => l != null) ? loads.reduce<number>((t, l) => t + (l ?? 0), 0) : null;
  const judged = unitKw != null && groupLoad != null && groupLoad > 0;
  const covered = judged && coversLoad(unitKw, groupLoad);
  const floor = zones[0] ? floorOf(draft, zones[0]) : null;
  return (
    <StackGroup>
      <StackRow
        name={<span className="ds-syp-strong">{roomsLabel(zones.map((m) => m.name))}</span>}
        sub={[kwText(groupLoad), floor].filter(Boolean).join(", ")}
      />
      <HeadRow model={unit.model} kw={unitKw} onModel={onModel} onRemove={onRemove} />
      {zones.map((m) => (
        <StackRow key={m.zone.id} name={m.name} sub={airWords(air.find((r) => r.roomId === m.zone.id)) ?? undefined} value={kwText(m.loadKw)}>
          <IconButton glyph="clear" label={`Clear ${m.name} from ${view.sys.name}`} size={32} className="ds-syp-edge" onClick={() => onClear(m.zone.id)} />
        </StackRow>
      ))}
      {judged && (
        <StackRow
          name={
            <span className={stateClass(covered ? "good" : "bad")}>
              {covered ? `Covered, ${unitKw.toFixed(1)} of ${groupLoad.toFixed(1)} kW` : `${shortKw(groupLoad, unitKw).toFixed(1)} kW short`}
            </span>
          }
        />
      )}
    </StackGroup>
  );
}

/* ─────────────────────────── zoning ─────────────────────────── */

/** a ducted or bulkhead unit's zoning (zoning.ts): Off, On/off or Temperature;
    the zones its rooms make, a zone opened to tick which rooms share it; the
    kit the brand's pack gives; the sensors; the zone that takes the spill */
function ZoningRows({
  draft,
  pack,
  sys,
  alloc,
  tray: trayKind,
  onChange,
}: {
  draft: DesignDocument;
  pack: DataPack;
  sys: DesignSystem;
  alloc: Allocation;
  /** its control's tray: alone on the system, named among others, or none
      where it shares the system's */
  tray: "plain" | "named" | "none";
  onChange: (next: DesignDocument) => void;
}) {
  const [openZone, setOpenZone] = useState<string | null>(null);
  const air = unitAir(draft, pack, sys, alloc);
  if (!air || air.rooms.length === 0) return null;
  const z = zoningOf(sys, alloc.id);
  const zones = zonesOf(air, z);
  const kit = zoneKit(pack, z, zones);
  const set = (change: Partial<UnitZoning>) => onChange(setZoning(draft, sys.id, alloc.id, change));
  const trayLabel = trayKind === "named" ? `Zoning, ${alloc.model}` : "Zoning";
  const tray = <Tray ariaLabel={trayLabel} options={CONTROL_OPTIONS} value={z.control} onChange={(control) => set({ control })} />;
  return (
    <>
      {trayKind === "named" && (
        <>
          <StackRow name="Zoning" sub={`${roomsLabel(air.rooms.map((r) => r.name))}, ${alloc.model}`} />
          <div className="ds-stack-row ds-syp-trayrow">{tray}</div>
        </>
      )}
      {trayKind === "plain" && <StackRow name="Zoning">{tray}</StackRow>}
      {zones.map((zone) => {
        const isOpen = openZone === zone.key;
        return (
          <div key={zone.key} className="ds-syp-zone">
            <StackRow
              name={`${zone.label} ${zone.name}`}
              value={plural(zone.roomIds.length, "room", "rooms")}
              label={`${isOpen ? "Close" : "Open"} ${zone.label} ${zone.name}`}
              onPress={() => setOpenZone(isOpen ? null : zone.key)}
            />
            {isOpen &&
              air.rooms.map((r) => {
                const on = zone.roomIds.includes(r.roomId);
                return (
                  <div key={r.roomId} className="ds-stack-row">
                    <Tick
                      label={r.name}
                      checked={on}
                      disabled={on && zone.roomIds.length === 1}
                      onChange={() => onChange(joinZone(draft, sys.id, alloc.id, air, r.roomId, on ? null : zone.key))}
                    />
                  </div>
                );
              })}
          </div>
        );
      })}
      {zones.length > 0 && (
        <StackRow name="Controller" value={kit.interfaceModel ?? (kit.problem ? "None fits" : "Zone controller")} tone={kit.problem ? "bad" : undefined} />
      )}
      {kit.problem && (
        <p className={`ds-syp-problem ${stateClass("bad")}`} role="alert">
          {kit.problem}
        </p>
      )}
      {zones.length > 0 && z.control === "temperature" && (
        <StackRow name="Sensors">
          <Tray ariaLabel="Sensors" options={SENSOR_OPTIONS} value={z.sensors} onChange={(sensors) => set({ sensors })} />
        </StackRow>
      )}
      {zones.length > 1 && (
        <StackRow name="Spill zone">
          <Tray
            ariaLabel="Spill zone"
            options={zones.map((zone) => ({ value: zone.key, label: zone.label }))}
            value={z.spill ?? ""}
            onChange={(key) => set({ spill: z.spill === key ? null : key })}
          />
        </StackRow>
      )}
    </>
  );
}

/* ─────────────────────────── choosing a model ─────────────────────────── */

interface ModelRow {
  idu: IndoorUnit;
  kw: number;
  fit: UnitFit;
}

/** the models on offer, what suits the load leading, nothing taken away */
function modelRows(
  pack: DataPack,
  basis: SizingBasis,
  opts: { perRoom: boolean; pool: HeadPool; loadKw: number | null; formFactor: FormFactor | null }
): ModelRow[] {
  const { perRoom, pool, loadKw, formFactor } = opts;
  const rows: ModelRow[] = perRoom
    ? multiUnitOptions(pack, { loadKw, basis, formFactor, pool }).map((p) => ({ idu: p.idu, kw: p.capacityKw, fit: p.fit }))
    : unitOptions(pack, { loadKw, basis, formFactor }).map((o) => ({ idu: o.idu, kw: o.defaultPair.capacityKw, fit: o.fit }));
  /* short ones nearest the load first; the rest smallest first */
  return rows.sort(
    (a, b) =>
      FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
      (a.fit === "undersized" ? b.kw - a.kw : a.kw - b.kw) ||
      a.idu.model.localeCompare(b.idu.model)
  );
}

/** how a capacity sits against the load, in the words fit.ts judges it by */
function fitWord(row: ModelRow, loadKw: number | null): { text: string; tone?: Tone } | null {
  if (loadKw == null || !(loadKw > 0)) return null;
  if (row.fit === "undersized") return { text: `${shortKw(loadKw, row.kw).toFixed(1)} kW short`, tone: "bad" };
  const pct = coverPct(row.kw, loadKw) ?? 0;
  return row.fit === "oversized" ? { text: `Oversized, ${pct}%`, tone: "look" } : { text: `${pct}%` };
}

/** a swap's own sizes, each saying what the swap would do to the system */
function swapNotes(
  draft: DesignDocument,
  pack: DataPack,
  basis: SizingBasis,
  view: SystemView,
  head: Allocation | null
): Map<string, { ok: boolean; note: string | null }> {
  const out = new Map<string, { ok: boolean; note: string | null }>();
  if (!head) return out;
  const beforeOdu = view.odu?.model ?? "";
  for (const u of sizesOf(pack, view.sys, iduRowOf(pack, head.model))) {
    if (u.model === head.model) continue;
    const swap = swapAllocation(draft, pack, basis, view.sys.id, head.id, u.model);
    if (!swap.ok) {
      out.set(u.model, { ok: false, note: swap.reason ?? null });
      continue;
    }
    const after = swap.doc.systems.find((s) => s.id === view.sys.id);
    const word = after ? combinationWord(swap.doc, pack, after) : null;
    const afterOdu = after ? (allocationsOf(after).find((a) => a.role === "odu")?.model ?? "") : "";
    out.set(u.model, {
      ok: true,
      note: word === "Fails" ? "Combination fails" : word === "Valid" && afterOdu !== beforeOdu ? `Outdoor becomes ${afterOdu}` : null,
    });
  }
  return out;
}

function ModelScreen({
  draft,
  pack,
  basis,
  view,
  target,
  perRoom,
  pool,
  headType,
  headTypeLabel,
  ductedFamily,
  onBack,
  onTypes,
  onPick,
  onWrite,
}: {
  draft: DesignDocument;
  pack: DataPack;
  basis: SizingBasis;
  view: SystemView;
  target: ModelTarget;
  perRoom: boolean;
  pool: HeadPool;
  headType: FormFactor | null;
  headTypeLabel: string | null;
  ductedFamily: boolean;
  onBack: () => void;
  onTypes: () => void;
  onPick: (model: string) => void;
  onWrite: (next: DesignDocument) => void;
}) {
  const [query, setQuery] = useState("");
  const sys = view.sys;
  const head = target.kind === "swap" ? (view.heads.find((a) => a.id === target.allocationId) ?? null) : null;
  const headRow = head ? iduRowOf(pack, head.model) : null;
  const headZone = head ? (view.zones.find((z) => z.zone.id === head.roomId) ?? null) : null;
  const addZone = target.kind === "add" || target.kind === "split" ? (view.zones.find((z) => z.zone.id === target.zoneId) ?? null) : null;

  const served = head ? roomsServed(head) : [];
  const loadKw =
    target.kind === "band" || head?.serves === "system"
      ? view.zonesLoadKw
      : served.length > 1
        ? served.reduce<number>((n, id) => n + (view.zones.find((z) => z.zone.id === id)?.loadKw ?? 0), 0)
        : (headZone ?? addZone)?.loadKw ?? null;

  const all = modelRows(pack, basis, { perRoom, pool, loadKw, formFactor: query.trim() ? null : headType });
  const rows = all
    .filter((r) => !query.trim() || unitMatchesQuery(r.idu, query))
    .filter((r) => !ductedFamily || !query.trim() || DUCT_AIRWAY_FORMS.includes(r.idu.form_factor));

  const sizes = swapNotes(draft, pack, basis, view, head);

  const pipe = head ? headPipeMm(pack, sys, head, view.odu?.model ?? null, view.vrfTree) : null;
  const headKw = head ? kwOf(pack, head.model, basis) : null;
  const airway = headRow != null && DUCT_AIRWAY_FORMS.includes(headRow.form_factor);

  const where = !head
    ? null
    : head.serves === "system"
      ? "Whole system"
      : served.length > 1
        ? roomsLabel(served.map((id) => view.zones.find((z) => z.zone.id === id)?.name ?? "").filter(Boolean))
        : (headZone?.name ?? "No room");
  const title = head ? head.model : target.kind === "band" ? "Choose a unit" : "Choose a head";
  const sub = head
    ? [kwText(headKw), pipe ? `${pipe.liquidMm} / ${pipe.gasMm} mm` : null, where].filter(Boolean).join(", ")
    : target.kind === "band"
      ? `Whole system${view.zonesLoadKw != null ? `, needs ${view.zonesLoadKw.toFixed(1)} kW` : ""}`
      : addZone
        ? `${addZone.name}${addZone.loadKw != null ? `, needs ${addZone.loadKw.toFixed(1)} kW` : ""}`
        : undefined;

  const series = rows.filter((r) => sizes.has(r.idu.model) || r.idu.model === head?.model);
  const others = head ? rows.filter((r) => !series.includes(r)) : rows;
  const modelRow = (r: ModelRow) => {
    const current = r.idu.model === head?.model;
    const size = sizes.get(r.idu.model);
    const word = fitWord(r, loadKw);
    const line = [kwText(r.kw), query.trim() ? r.idu.series : null, size?.note ?? null].filter(Boolean).join(", ");
    return (
      <StackRow
        key={r.idu.model}
        name={r.idu.model}
        sub={line}
        value={word?.text}
        tone={word?.tone}
        onPress={current || (size && !size.ok) ? undefined : () => onPick(r.idu.model)}
      >
        {current && <Chosen />}
      </StackRow>
    );
  };

  return (
    <StackScreen label={title}>
      <StackHead name={title} sub={sub} back={sys.name} onBack={onBack} />

      {head && head.serves !== "system" && airway && (
        <>
          <StackSection>Rooms it serves</StackSection>
          <StackGroup>
            {view.zones.map((z) => {
              const on = served.includes(z.zone.id);
              return (
                <div key={z.zone.id} className="ds-stack-row">
                  <Tick
                    label={z.name}
                    checked={on}
                    disabled={on && served.length === 1}
                    onChange={() => {
                      const next = on ? served.filter((r) => r !== z.zone.id) : [...served, z.zone.id];
                      onWrite(setRoomsServed(draft, pack, { systemId: sys.id, allocationId: head.id, roomIds: next }));
                    }}
                  />
                  <span className="ds-stack-row-v">{kwText(z.loadKw)}</span>
                </div>
              );
            })}
          </StackGroup>
        </>
      )}
      {head && head.serves !== "system" && !airway && view.zones.length > 1 && (
        <>
          <StackSection>Room</StackSection>
          <StackGroup>
            {view.zones.map((z) => (
              <StackRow
                key={z.zone.id}
                name={z.name}
                sub={kwText(z.loadKw)}
                onPress={z.zone.id === head.roomId ? undefined : () => onWrite(moveAllocation(draft, sys.id, head.id, z.zone.id))}
              >
                {z.zone.id === head.roomId && <Chosen />}
              </StackRow>
            ))}
          </StackGroup>
        </>
      )}

      <div className="ds-syp-block">
        <SearchField value={query} onChange={setQuery} label="Search models" />
      </div>
      {headTypeLabel && !query.trim() && (
        <StackGroup>
          <StackRow name={`${headTypeLabel} heads`} chevron onPress={onTypes} />
        </StackGroup>
      )}

      {series.length > 0 && (
        <>
          <StackSection>Sizes</StackSection>
          <StackGroup>{series.map(modelRow)}</StackGroup>
        </>
      )}
      {others.length > 0 ? (
        <>
          {head && <StackSection>Other models</StackSection>}
          <StackGroup>{others.map(modelRow)}</StackGroup>
        </>
      ) : (
        series.length === 0 && (
          <StackGroup>
            <StackRow name={query.trim() ? `No model matches ${query.trim()}` : "No models of this type"} />
          </StackGroup>
        )
      )}
    </StackScreen>
  );
}

/* ─────────────────────────── choosing an outdoor ─────────────────────────── */

function OutdoorScreen({
  pack,
  basis,
  view,
  onBack,
  onPick,
  onProposal,
}: {
  pack: DataPack;
  basis: SizingBasis;
  view: SystemView;
  onBack: () => void;
  onPick: (model: string) => void;
  onProposal: () => void;
}) {
  const facts: [string, string | null][] = [
    ["Connected", view.connectedText],
    ["Takes", view.takesText],
    ["Supply", view.supplyText],
    ["Pipe", view.pipeText],
    ["Fittings", view.jointsText],
    ["Limits", view.limitsText],
    ["Drawn", view.oduRow ? view.drawnText : null],
    ["Refrigerant", view.refrigerantText],
  ];
  return (
    <StackScreen label="Outdoor">
      <StackHead
        name="Outdoor"
        sub={view.oduRow ? view.outFacts : undefined}
        back={view.sys.name}
        onBack={onBack}
        action={
          view.oduByHand ? (
            <button type="button" className="ds-stack-small" onClick={onProposal}>
              Use the proposal
            </button>
          ) : undefined
        }
      />
      {view.outRows.length > 0 ? (
        <StackGroup>
          {view.outRows.map((r) => {
            const note = r.current ? (r.proposal ? "On the system, proposed" : "On the system") : r.proposal ? "Proposal" : null;
            return (
              <StackRow
                key={r.odu.model}
                name={r.odu.model}
                sub={[kwText(sizingCapacityKw(r.odu, basis)), r.ratio != null ? `${r.ratio}%` : null, note].filter(Boolean).join(", ")}
                value={r.valid == null ? undefined : r.valid ? "Valid" : "Fails"}
                tone={r.valid == null ? undefined : r.valid ? "good" : "bad"}
                onPress={r.current ? undefined : () => onPick(r.odu.model)}
              >
                {r.current && <Chosen />}
              </StackRow>
            );
          })}
        </StackGroup>
      ) : (
        <StackGroup>
          <StackRow name={`No outdoors in ${brandName(pack, pack.meta.brand)}'s pack for this type`} />
        </StackGroup>
      )}
      {view.oduRow && (
        <StackGroup>
          {facts.map(([k, v]) => (v ? <StackRow key={k} name={k} sub={v} /> : null))}
        </StackGroup>
      )}
    </StackScreen>
  );
}

/* ─────────────────────────── adding a room ─────────────────────────── */

function RoomsScreen({
  draft,
  sysId,
  back,
  onBack,
  onPick,
}: {
  draft: DesignDocument;
  sysId: string;
  back: string;
  onBack: () => void;
  onPick: (zoneId: string) => void;
}) {
  const toAdd = zonesToAdd(draft, sysId);
  const free = toAdd.filter((z) => z.sharedWith.length === 0);
  const taken = toAdd.filter((z) => z.sharedWith.length > 0);
  const name = (z: { props: Record<string, unknown> }) => String(z.props.name ?? "Zone");
  return (
    <StackScreen label="Add a room">
      <StackHead name="Add a room" back={back} onBack={onBack} />
      {free.length > 0 && (
        <>
          <StackSection>Without a system</StackSection>
          <StackGroup>
            {free.map(({ zone }) => (
              <StackRow key={zone.id} name={name(zone)} value={kwText(roomLoadKw(draft, zone))} onPress={() => onPick(zone.id)} />
            ))}
          </StackGroup>
        </>
      )}
      {taken.length > 0 && (
        <>
          <StackSection>On another system</StackSection>
          <StackGroup>
            {taken.map(({ zone, sharedWith }) => (
              <StackRow
                key={zone.id}
                lead={<StackDot colour={sharedWith[0].colour} />}
                name={name(zone)}
                sub={sharedWith.map((s) => s.name).join(", ")}
                value={kwText(roomLoadKw(draft, zone))}
                onPress={() => onPick(zone.id)}
              />
            ))}
          </StackGroup>
        </>
      )}
      {toAdd.length === 0 && (
        <StackGroup>
          <StackRow name="No rooms left to add" />
        </StackGroup>
      )}
    </StackScreen>
  );
}
