"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack, FormFactor, IndoorUnit, OutdoorUnit } from "@/lib/studio/packs/schema";
import { sizingCapacityKw, type SizingBasis } from "@/lib/studio/loads";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { systemCover, systemPairKw } from "@/lib/studio/coverage";
import { multiCapableIdus, multiFormFactorSummary } from "@/lib/studio/multi";
import { formFactorSummary } from "@/lib/studio/select";
import { UnitBrowser, type UnitChoice } from "./unit-browser";
import {
  addBandUnit,
  addHead,
  addSplitBeside,
  adoptLegacySystem,
  allocationsOf,
  chooseOutdoor,
  hasAllocations,
  moveAllocation,
  outdoorsListing,
  releaseSystem,
  removeAllocation,
  removeZone,
  roomVerdict,
  swapAllocation,
  /* the engine's name begins with "use", which the hooks rules read as a
     hook; under this name it is the plain function it is */
  useProposal as proposalHandedBack,
  zonesToAdd,
  type Allocation,
  type RoomVerdict,
  proposedOutdoorModel,
} from "@/lib/studio/builder";
import {
  claimZone,
  familyOf,
  KIND_WORD,
  renameSystem,
  retypeSystem,
  systemKind,
  systemZones,
  type SystemFamily,
  type SystemKind,
} from "@/lib/studio/zones";
import {
  blockingFindings,
  brandName,
  combinationWord,
  connectionRatio,
  doneReason,
  systemFindings,
  type SystemFinding,
} from "@/lib/studio/verdict";

/* The system builder (docs/studio-zones-and-systems.md, "The builder"). One
   system at a time, its zones given: the rail says what the system is, the
   picker lists heads and outdoors, the summary reads the pack, and the
   schematic is the thing you build on — heads dragged onto zone cards, a
   whole-system unit onto the band, an outdoor onto its box.

   It edits a DRAFT of the design. Done applies it as one change (one undo
   step); Discard changes drops it; Delete system takes effect at once. Every
   rule it shows comes from builder.ts, zones.ts and verdict.ts — this file
   lays out and wires, it does not decide. */

type Side = "indoor" | "outdoor";
type Tone = "ok" | "bad" | "warn" | "quiet";
interface Word {
  text: string;
  tone: Tone;
}

/** what a dragged row carries: a head for a zone card or the band, an
    outdoor for the outdoor box */
type DragPayload = { iduModel: string } | { oduModel: string };
const DRAG_TYPE = "application/x-heytiff-builder-unit";

const FAMILY_WORD: Record<SystemFamily, string> = { split: "Split", multi: "Multi", vrf: "VRF" };
const FAMILIES: SystemFamily[] = ["split", "multi", "vrf"];

const kwText = (kw: number | null | undefined): string => (kw == null ? "—" : `${kw.toFixed(1)} kW`);
const zoneName = (z: RoomObj): string => String(z.props.name ?? "Zone");
const pct = (cover: number, load: number): number => Math.round((cover / load) * 100);
const iduRowOf = (pack: DataPack, model: string): IndoorUnit | null =>
  pack.indoor_units.find((u) => u.model === model) ?? null;
const oduRowOf = (pack: DataPack, model: string): OutdoorUnit | null =>
  pack.outdoor_units.find((u) => u.model === model) ?? null;
const kwOf = (pack: DataPack, model: string, basis: SizingBasis): number | null => {
  const row = iduRowOf(pack, model);
  return row ? sizingCapacityKw(row, basis) : null;
};

/* ─────────────────────────── reading the system ─────────────────────────── */

interface HeadLine {
  alloc: Allocation;
  sys: DesignSystem;
  /** this system's head, so it can be selected and dropped beside */
  mine: boolean;
  kw: number | null;
}

interface ZoneView {
  zone: RoomObj;
  name: string;
  loadKw: number | null;
  /** another system has a head here too: its heads are drawn read-only */
  shared: boolean;
  lines: HeadLine[];
  word: Word;
  short: boolean;
  /** a head of this system here cannot join its outdoor */
  cant: boolean;
  /** the short zone's slot: another split beside, or another unit on the multi */
  slot: "split" | "multi" | null;
  /** the pipe size of the last head, for the right of the last line */
  pipe: string | null;
  verdict: RoomVerdict;
}

interface OutRow {
  odu: OutdoorUnit;
  /** null where the builder has no rule to check (a VRF outdoor) */
  valid: boolean | null;
  ratio: number | null;
  current: boolean;
  proposal: boolean;
}

interface SystemView {
  sys: DesignSystem;
  family: SystemFamily;
  kind: SystemKind;
  empty: boolean;
  heads: Allocation[];
  bandUnits: Allocation[];
  /** heads whose zone is not one of the system's zones */
  strays: Allocation[];
  odu: Allocation | null;
  oduRow: OutdoorUnit | null;
  oduByHand: boolean;
  findings: SystemFinding[];
  blocking: SystemFinding[];
  reason: string | null;
  combination: "Valid" | "Fails" | null;
  zones: ZoneView[];
  zonesLoadKw: number | null;
  loadText: string;
  coverKw: number | null;
  coveredText: string;
  anyShort: boolean;
  proposalModel: string | null;
  outRows: OutRow[];
  outFacts: string;
  ratio: ReturnType<typeof connectionRatio>;
  connectedText: string | null;
  takesText: string | null;
  supplyText: string | null;
  pipeText: string | null;
  limitsText: string | null;
  drawnText: string;
  refrigerantText: string | null;
  bandPipe: string | null;
}

/** the pipe a head is drawn with: a split's pairing, a multi head's own
    connection */
function pipeSize(pack: DataPack, sys: DesignSystem, head: Allocation, oduModel: string | null): string | null {
  if (sys.type === "split" || sys.type === "ducted") {
    const pair = pack.pair_tables.find((p) => p.idu_model === head.model && p.odu_model === oduModel);
    if (pair) return `${pair.pipe_liquid_mm} / ${pair.pipe_gas_mm}`;
  }
  const u = iduRowOf(pack, head.model);
  return u ? `${u.conn_liquid_mm} / ${u.conn_gas_mm}` : null;
}

function zoneWord(args: {
  cant: boolean;
  oduModel: string;
  bandKw: number | null;
  zonesLoadKw: number | null;
  loadKw: number | null;
  lines: number;
  verdict: RoomVerdict;
}): { word: Word; short: boolean } {
  const { cant, oduModel, bandKw, zonesLoadKw, loadKw, lines, verdict } = args;
  const shortBy = (need: number, cover: number): string => `${Math.max(0, need - cover).toFixed(1)} kW short`;
  if (cant) return { word: { text: `Can't join ${oduModel}`, tone: "bad" }, short: false };
  /* a unit on the band serves every zone: each zone reads the unit against
     the load of all of them together */
  if (bandKw != null) {
    if (zonesLoadKw == null || zonesLoadKw <= 0) return { word: { text: kwText(bandKw), tone: "quiet" }, short: false };
    return bandKw >= zonesLoadKw
      ? { word: { text: "Covered", tone: "ok" }, short: false }
      : { word: { text: shortBy(zonesLoadKw, bandKw), tone: "bad" }, short: true };
  }
  /* nothing in it yet: what it is short by is what it needs, and it is not
     wrong yet, only not done — amber, where a short unit is red */
  if (lines === 0) {
    return loadKw != null
      ? { word: { text: shortBy(loadKw, 0), tone: "warn" }, short: false }
      : { word: { text: "", tone: "quiet" }, short: false };
  }
  switch (verdict.word) {
    case "Fits":
      return { word: { text: "Covered", tone: "ok" }, short: false };
    case "Undersized":
      return {
        word: { text: verdict.loadKw != null ? shortBy(verdict.loadKw, verdict.coverKw) : "Short", tone: "bad" },
        short: true,
      };
    case "Oversized":
      return {
        word: { text: verdict.loadKw ? `Oversized, ${pct(verdict.coverKw, verdict.loadKw)}%` : "Oversized", tone: "warn" },
        short: false,
      };
    case "Calibrate":
      return { word: { text: kwText(verdict.coverKw), tone: "quiet" }, short: false };
    default:
      return { word: { text: "", tone: "quiet" }, short: false };
  }
}

/** everything the rail, the picker, the summary and the schematic show
    about one system, read once per draft */
function readSystem(draft: DesignDocument, pack: DataPack, basis: SizingBasis, sys: DesignSystem): SystemView {
  const allocs = hasAllocations(sys) ? allocationsOf(sys) : [];
  const heads = allocs.filter((a) => a.role === "idu" && a.model);
  const bandUnits = heads.filter((a) => a.serves === "system");
  const zoneHeads = heads.filter((a) => a.serves !== "system");
  const zoneList = systemZones(draft, sys.id);
  const zoneIds = new Set(zoneList.map((z) => z.id));
  const strays = zoneHeads.filter((a) => !a.roomId || !zoneIds.has(a.roomId));
  const odu = allocs.find((a) => a.role === "odu" && a.model) ?? null;
  const oduRow = odu ? oduRowOf(pack, odu.model) : null;
  const oduByHand = sys.settings.oduChosen === true && odu != null;
  const family = familyOf(sys);
  const kind = systemKind(draft, sys);
  const empty = kind === "empty";
  const findings = systemFindings(draft, pack, sys);
  const blocking = blockingFindings(findings);
  const combination = combinationWord(draft, pack, sys);

  /* the heads a red finding names, when it can: an outdoor that takes one
     head holds every head after the first, a pair the book does not list is
     the head's own, a unit of another brand is that unit */
  const cant = new Set<string>();
  for (const f of blocking) {
    if (f.code === "outdoor-takes-one") for (const a of heads.slice(1)) cant.add(a.id);
    if (f.code === "pair-not-listed" && heads[0]) cant.add(heads[0].id);
    if (f.code === "brand-mismatch") {
      for (const a of heads) {
        const row = iduRowOf(pack, a.model);
        if (row && row.brand !== sys.brand) cant.add(a.id);
      }
    }
  }

  const cover = systemCover(draft, pack, sys, basis);
  /* coverage.ts reads a head by its zone, and a unit on the band has none:
     the whole-system unit is read here from its pairing instead, against the
     load of every zone together */
  const bandKw = bandUnits.length
    ? (systemPairKw(draft, pack, sys.id, basis) ??
      bandUnits.reduce((n, a) => n + (kwOf(pack, a.model, basis) ?? 0), 0))
    : null;

  const zoneLoads = zoneList.map((z) => roomLoadKw(draft, z));
  const zonesLoadKw = zoneLoads.some((l) => l != null)
    ? zoneLoads.reduce<number>((n, l) => n + (l ?? 0), 0)
    : null;

  /* the header's Load is this system's share of a shared zone: 7.0 of 14.0 */
  let myLoadKw = 0;
  let shareDiffers = false;
  const zones: ZoneView[] = zoneList.map((zone, i) => {
    const loadKw = zoneLoads[i];
    const mine = zoneHeads.filter((a) => a.roomId === zone.id);
    const others = draft.systems
      .filter((s) => s.id !== sys.id && hasAllocations(s))
      .flatMap((s) =>
        allocationsOf(s)
          .filter((a) => a.role === "idu" && a.model && a.roomId === zone.id)
          .map((alloc) => ({ sys: s, alloc }))
      );
    const shared = others.length > 0;
    const verdict = roomVerdict(draft, pack, basis, zone);
    const share = cover.rooms.find((r) => r.room.id === zone.id);
    const zoneShare = shared && share && share.loadKw != null ? share.loadKw : loadKw;
    if (zoneShare != null) myLoadKw += zoneShare;
    if (shared && loadKw != null && zoneShare != null && Math.abs(zoneShare - loadKw) > 0.05) shareDiffers = true;
    const cantHere = mine.some((a) => cant.has(a.id));
    const lines: HeadLine[] = [
      ...mine.map((alloc) => ({ alloc, sys, mine: true, kw: kwOf(pack, alloc.model, basis) })),
      ...others.map(({ sys: s, alloc }) => ({ alloc, sys: s, mine: false, kw: kwOf(pack, alloc.model, basis) })),
    ];
    const { word, short } = zoneWord({
      cant: cantHere,
      oduModel: odu?.model ?? "",
      bandKw,
      zonesLoadKw,
      loadKw: zoneShare ?? null,
      lines: lines.length,
      verdict,
    });
    const slot = short && mine.length > 0 && !bandUnits.length ? (kind === "split" ? "split" : "multi") : null;
    const last = mine[mine.length - 1];
    const pipe = last ? pipeSize(pack, sys, last, odu?.model ?? null) : null;
    return { zone, name: zoneName(zone), loadKw, shared, lines, word, short, cant: cantHere, slot, pipe, verdict };
  });
  const loadText =
    zonesLoadKw == null
      ? "—"
      : shareDiffers
        ? `${myLoadKw.toFixed(1)} of ${zonesLoadKw.toFixed(1)} kW`
        : `${zonesLoadKw.toFixed(1)} kW`;
  const coverKw = empty ? null : (bandKw ?? cover.coverKw);
  const anyShort = zones.some((z) => z.short);
  /* the header's Covered: the ONE figure (systemCover) over the load, the
     words the system card on the panel uses */
  const coveredText =
    coverKw == null ? "—" : zonesLoadKw == null ? kwText(coverKw) : `${coverKw.toFixed(1)} of ${zonesLoadKw.toFixed(1)} kW`;

  /* the outdoors of the family, each saying Valid or Fails against the
     heads; the one on the system is always listed, valid or not */
  const headRows = heads.map((a) => iduRowOf(pack, a.model)).filter((u): u is IndoorUnit => u != null);
  const listing = new Set(outdoorsListing(pack, headRows).map((o) => o.model));
  const listFamily: "pair" | "multi" | "vrf" =
    kind === "multi"
      ? "multi"
      : kind === "split" || kind === "ducted"
        ? "pair"
        : family === "vrf"
          ? "vrf"
          : family === "multi"
            ? "multi"
            : "pair";
  let candidates: OutdoorUnit[];
  let validOf: (o: OutdoorUnit) => boolean | null;
  if (listFamily === "multi") {
    candidates = pack.outdoor_units.filter(
      (o) => o.system_type === "multi" && pack.multi_rules.some((r) => r.odu_model_ref === o.model)
    );
    validOf = (o) => listing.has(o.model);
  } else if (listFamily === "vrf") {
    candidates = pack.outdoor_units.filter((o) => o.system_type === "vrf");
    validOf = () => null;
  } else {
    const head = heads[0]?.model ?? null;
    const pairs = head ? pack.pair_tables.filter((p) => p.idu_model === head) : pack.pair_tables;
    const models = [...new Set(pairs.map((p) => p.odu_model))];
    candidates = models.map((m) => oduRowOf(pack, m)).filter((o): o is OutdoorUnit => o != null);
    validOf = (o) => (head ? pairs.some((p) => p.odu_model === o.model) : true);
  }
  candidates.sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model));
  if (oduRow && !candidates.some((o) => o.model === oduRow.model)) candidates = [oduRow, ...candidates];
  /* the proposal: what the heads would be given */
  const proposalModel = empty ? null : oduByHand ? proposedOutdoorModel(draft, pack, sys.id) || null : (odu?.model ?? null);
  const headsKw = headRows.reduce((n, u) => n + u.capacity_cool_kw, 0);
  const outRows: OutRow[] = candidates.map((o) => ({
    odu: o,
    valid: o.model === odu?.model ? combination === "Valid" : validOf(o),
    ratio: headRows.length && o.capacity_cool_kw ? Math.round((headsKw / o.capacity_cool_kw) * 100) : null,
    current: o.model === odu?.model,
    proposal: o.model === proposalModel,
  }));

  const ratio = connectionRatio(pack, sys);
  const oduKw = oduRow ? kwText(sizingCapacityKw(oduRow, basis)) : "";
  const outFacts = !oduRow
    ? ""
    : oduRow.system_type === "multi"
      ? `${oduKw}, ${heads.length} of ${oduRow.ports ?? "?"} ports${ratio ? `, ${ratio.pct}%` : ""}`
      : kind === "split"
        ? `${oduKw}, split outdoor`
        : oduKw;
  const headWord = (n: number) => `${n} ${n === 1 ? "head" : "heads"}`;
  const connectedText = ratio
    ? `${ratio.connectedKw.toFixed(1)} kW, ${headWord(ratio.heads)}`
    : oduRow && headRows.length
      ? `${headsKw.toFixed(1)} kW, ${headWord(headRows.length)}`
      : null;
  const takesText = oduRow && oduRow.system_type !== "multi" && heads.length > 1 ? "1 head" : null;
  const supplyText = oduRow
    ? `${oduRow.phase === "3" ? "Three phase" : "Single phase"}${oduRow.max_amps_a != null ? `, ${oduRow.max_amps_a} A` : ""}`
    : null;

  /* the pipework, from the pack: a multi's port sizes, a pair's own */
  let pipeText: string | null = null;
  let limitsText: string | null = null;
  if (oduRow && oduRow.system_type === "multi") {
    pipeText = `${oduRow.conn_liquid_mm} / ${oduRow.conn_gas_mm} mm`;
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === oduRow.model);
    if (rule) limitsText = `${rule.max_total_pipe_m} m total, ${rule.max_per_branch_m} m a branch`;
  } else if (oduRow) {
    const sizes = [...new Set(heads.map((h) => pipeSize(pack, sys, h, oduRow.model)).filter((s): s is string => s != null))];
    pipeText = sizes.length ? sizes.map((s) => `${s} mm`).join(", ") : null;
    const pair = heads[0] ? pack.pair_tables.find((p) => p.idu_model === heads[0].model && p.odu_model === oduRow.model) : null;
    if (pair) limitsText = `${pair.max_length_m} m, ${pair.max_lift_m} m lift`;
  }
  const runs = draft.objects.filter((o) => o.systemId === sys.id && (o.type as string) === "pipe-run").length;
  const drawnText = runs ? `${runs} ${runs === 1 ? "run" : "runs"}` : "Not yet";
  const refrigerantText = oduRow
    ? `${oduRow.refrigerant}${oduRow.precharged_kg != null ? `, ${oduRow.precharged_kg.toFixed(2)} kg pre-charged` : ""}`
    : null;
  const bandPipe = bandUnits[0] ? pipeSize(pack, sys, bandUnits[0], odu?.model ?? null) : null;

  return {
    sys,
    family,
    kind,
    empty,
    heads,
    bandUnits,
    strays,
    odu,
    oduRow,
    oduByHand,
    findings,
    blocking,
    reason: doneReason(findings),
    combination,
    zones,
    zonesLoadKw,
    loadText,
    coverKw,
    coveredText,
    anyShort,
    proposalModel,
    outRows,
    outFacts,
    ratio,
    connectedText,
    takesText,
    supplyText,
    pipeText,
    limitsText,
    drawnText,
    refrigerantText,
    bandPipe,
  };
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
  /** open on this unit — Swap from the plan (an outdoor opens the Outdoor tab) */
  focus?: { systemId: string; allocationId: string } | null;
  /** the one system being built (its zones are given); without one, the
      unit's system, else the first */
  systemId?: string | null;
  /** a draft to start from instead of the design — a zone moved onto this
      system whose units it cannot take, so Done is off until it can and
      Discard changes undoes the move */
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
  const [draft, setDraft] = useState<DesignDocument>(start);
  const dirty = draft !== start;

  const sysId = systemId ?? focus?.systemId ?? draft.systems[0]?.id ?? null;
  const sys = draft.systems.find((s) => s.id === sysId) ?? null;
  const view = useMemo(() => (sys ? readSystem(draft, pack, basis, sys) : null), [draft, pack, basis, sys]);

  const [error, setError] = useState<string | null>(null);
  /** the head whose swap and remove are open, by allocation id */
  const [selected, setSelected] = useState<string | null>(() =>
    focus && focus.systemId === sysId ? focus.allocationId : null
  );
  /* a move that could not be installed opens on the Outdoor tab, where the
     fix is: so does a Swap from an outdoor on the plan */
  const [side, setSide] = useState<Side>(() => {
    const s = start.systems.find((x) => x.id === sysId);
    if (!s) return "indoor";
    if (startFrom && blockingFindings(systemFindings(start, pack, s)).length) return "outdoor";
    const opened = focus && hasAllocations(s) ? allocationsOf(s).find((a) => a.id === focus.allocationId) : null;
    return opened?.role === "odu" ? "outdoor" : "indoor";
  });
  const [formFactor, setFormFactor] = useState<FormFactor | null>(null);
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  /** what is in flight from the picker, so the targets that take it show */
  const [dragging, setDragging] = useState<"head" | "outdoor" | null>(null);
  /** the right-hand column, where the list's spec sheet is mounted */
  const [sideHost, setSideHost] = useState<HTMLDivElement | null>(null);

  /* Esc closes what is open first — the browser's comparison, the Add zone
     list, a selected head — and the window only when there is nothing to
     lose */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".ds-cmp-overlay")) return;
      if (addZoneOpen) {
        setAddZoneOpen(false);
        return;
      }
      if (selected) {
        setSelected(null);
        return;
      }
      if (!dirty) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onClose, addZoneOpen, selected]);

  /* a drag that ends anywhere — dropped or let go — puts the targets to rest */
  useEffect(() => {
    if (!dragging) return;
    const done = () => setDragging(null);
    window.addEventListener("dragend", done);
    window.addEventListener("drop", done);
    return () => {
      window.removeEventListener("dragend", done);
      window.removeEventListener("drop", done);
    };
  }, [dragging]);

  /* the head types the picker offers: the pack's styles, for the flow the
     family drives (a multi's heads are the ones its rules accept) */
  const perRoom = view ? view.family !== "split" : false;
  const headTypes = useMemo(
    () =>
      (perRoom ? multiFormFactorSummary(pack, null, basis) : formFactorSummary(pack, null, basis)).map((t) => ({
        value: t.formFactor,
        label: t.label,
      })),
    [perRoom, pack, basis]
  );
  const firstHeadType = view?.heads[0] ? (iduRowOf(pack, view.heads[0].model)?.form_factor ?? null) : null;
  const headType: FormFactor | null =
    (formFactor && headTypes.some((t) => t.value === formFactor) ? formFactor : null) ??
    (firstHeadType && headTypes.some((t) => t.value === firstHeadType) ? firstHeadType : null) ??
    (headTypes.some((t) => t.value === "wall") ? "wall" : (headTypes[0]?.value ?? null));

  /* the ranking lens: one zone on a split is the one load a pair is sized
     against; more zones, or a multi, rank nothing (each zone takes its own) */
  const lensKw = view && view.family === "split" && view.zones.length === 1 ? view.zones[0].loadKw : null;

  /* ── writes: every one is the engine's, on the draft ── */
  const write = (next: DesignDocument) => {
    setError(null);
    setDraft(next);
  };
  const dropHead = (zoneId: string, iduModel: string) => {
    if (!sys) return;
    write(addHead(draft, pack, { systemId: sys.id, zoneId, iduModel }));
  };
  const dropBand = (iduModel: string) => {
    if (!sys) return;
    write(addBandUnit(draft, pack, { systemId: sys.id, iduModel }));
  };
  const dropOutdoor = (oduModel: string) => {
    if (!sys) return;
    write(chooseOutdoor(draft, pack, basis, sys.id, oduModel));
  };
  const dropSlot = (zone: ZoneView, iduModel: string) => {
    if (!sys) return;
    if (zone.slot === "split") write(addSplitBeside(draft, pack, { zoneId: zone.zone.id, iduModel }).doc);
    else write(addHead(draft, pack, { systemId: sys.id, zoneId: zone.zone.id, iduModel }));
  };
  /** the family on the trail is a starting point: it is written to the
      system, its type re-read, and a proposal (never a pick) made again */
  const pickFamily = (family: SystemFamily) => {
    if (!sys) return;
    let d: DesignDocument = {
      ...draft,
      systems: draft.systems.map((s) => (s.id === sys.id ? { ...s, settings: { ...s.settings, family } } : s)),
    };
    d = retypeSystem(d, pack, sys.id);
    if (sys.settings.oduChosen !== true) d = proposalHandedBack(d, pack, sys.id);
    write(d);
  };
  const chooseFromBrowser = (choice: UnitChoice) => {
    if (!view) return;
    const iduModel = choice.kind === "pair" ? choice.pair.idu.model : choice.idu.model;
    const empty = view.zones.find((z) => !z.lines.some((l) => l.mine)) ?? view.zones[0];
    if (empty) dropHead(empty.zone.id, iduModel);
    else dropBand(iduModel);
  };
  /* WHICH ZONE ADD PUTS IT IN. It was always the first zone with nothing in
     it, derived and unchangeable, so the button said Add to Master Bedroom
     and there was no way to say Study. Clicking a zone card aims it; until
     one is clicked the first empty zone is the default, which is where you
     would have wanted it anyway. */
  const [aimedZone, setAimedZone] = useState<string | null>(null);
  const addTarget = view
    ? ((aimedZone ? view.zones.find((z) => z.zone.id === aimedZone) : null) ??
       view.zones.find((z) => !z.lines.some((l) => l.mine)) ??
       view.zones[0])
    : null;

  const commitRename = () => {
    if (sys) write(renameSystem(draft, sys.id, nameDraft));
    setRenaming(false);
  };

  const selectedAlloc = view && selected ? (view.heads.find((a) => a.id === selected) ?? null) : null;

  const body = (
    <div className="ds-sb-scrim" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose()}>
      <div className="ds-sb" role="dialog" aria-modal="true" aria-labelledby="ds-sb-title">
        <header className="ds-sb-head">
          {view && <span className="ds-sb-dot" style={{ background: view.sys.colour }} />}
          <h2 id="ds-sb-title" className="ds-sb-title">
            {!view ? (
              "Build system"
            ) : renaming ? (
              <input
                className="ds-sb-name-input"
                aria-label="System name"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="ds-sb-name"
                onClick={() => {
                  setNameDraft(view.sys.name);
                  setRenaming(true);
                }}
              >
                {view.sys.name}
              </button>
            )}
          </h2>
          {view && (
            <>
              <span className="ds-sb-rule" />
              <dl className="ds-sb-stats">
                {!view.empty && (
                  <div className="ds-sb-stat">
                    <dt>Type</dt>
                    <dd>{KIND_WORD[view.kind]}</dd>
                  </div>
                )}
                <div className="ds-sb-stat">
                  <dt>Zones</dt>
                  <dd>{view.zones.length}</dd>
                </div>
                <div className="ds-sb-stat">
                  <dt>Load</dt>
                  <dd className={view.zonesLoadKw == null ? "quiet" : ""}>{view.loadText}</dd>
                </div>
                {!view.empty && (
                  <div className="ds-sb-stat">
                    <dt>Covered</dt>
                    <dd className={view.anyShort ? "bad" : view.coverKw == null ? "quiet" : ""}>{view.coveredText}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
          <span className="ds-sb-spring" />
          <button className="ds-sb-x" onClick={onClose} aria-label="Close builder">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-sb-body">
          {view ? (
            <PipingRail
              draft={draft}
              pack={pack}
              view={view}
              selected={selected}
              headType={headType}
              aimedZoneId={side === "indoor" ? (addTarget?.zone.id ?? null) : null}
              outdoorOn={side === "outdoor" && !selectedAlloc}
              dragging={dragging}
              onAimZone={(zoneId) => {
                setAimedZone(zoneId);
                setSelected(null);
                /* the outdoor card turns the list to Outdoor; a zone is the
                   same gesture for the other side, and without this clicking
                   a zone aimed a list you could not see */
                setSide("indoor");
              }}
              addZoneOpen={addZoneOpen}
              onSelect={setSelected}
              onDropHead={dropHead}
              onDropBand={dropBand}
              onDropOutdoor={dropOutdoor}
              onDropSlot={dropSlot}
              onRemoveZone={(zoneId) => write(removeZone(draft, pack, view.sys.id, zoneId))}
              onOutdoor={() => {
                setSelected(null);
                setSide("outdoor");
              }}
              onAddZone={() => setAddZoneOpen((o) => !o)}
              onCloseAddZone={() => setAddZoneOpen(false)}
              onClaim={(zoneId) => {
                write(claimZone(draft, view.sys.id, zoneId));
                setAddZoneOpen(false);
              }}
            />
          ) : (
            <div className="ds-sb-rail" />
          )}

          <section className="ds-sb-picker" aria-label="Units">
            {view && (
              <div className="ds-sb-crumbs">
                <CrumbMenu
                  label="Family of outdoor"
                  value={view.family}
                  options={FAMILIES.map((f) => ({ value: f, label: FAMILY_WORD[f] }))}
                  onPick={(f) => pickFamily(f as SystemFamily)}
                />
                <span className="ds-sb-crumb-sep" aria-hidden="true">
                  <Icon name="chevR" size={12} />
                </span>
                {side === "indoor" && headType ? (
                  <CrumbMenu
                    label="Head type"
                    now
                    value={headType}
                    options={headTypes}
                    onPick={(ff) => setFormFactor(ff as FormFactor)}
                  />
                ) : (
                  <span className="ds-sb-crumb now">Outdoor</span>
                )}
                <span className="ds-sb-spring" />
                <div className="ds-sb-switch" role="group" aria-label="Indoor or outdoor">
                  <button
                    type="button"
                    className="ds-sb-switch-opt"
                    aria-pressed={side === "indoor"}
                    onClick={() => setSide("indoor")}
                  >
                    Indoor
                  </button>
                  <button
                    type="button"
                    className="ds-sb-switch-opt"
                    aria-pressed={side === "outdoor"}
                    onClick={() => {
                      setSelected(null);
                      setSide("outdoor");
                    }}
                  >
                    Outdoor
                  </button>
                </div>
              </div>
            )}
            {!view ? (
              <div className="ds-sb-none">
                <p>Add a system on the panel first.</p>
              </div>
            ) : side === "indoor" ? (
              <UnitBrowser
                embedded
                pack={pack}
                loadKw={lensKw}
                basis={basis}
                mode={perRoom ? "per-room" : "pair"}
                formFactor={headType}
                onFormFactor={setFormFactor}
                brandLocked={!view.empty}
                addLabel={addTarget ? `Add to ${addTarget.name}` : "Add to the band"}
                addNote={(kw) => {
                  const need = addTarget?.loadKw;
                  if (!addTarget || need == null) return null;
                  return kw >= need
                    ? `Covers ${addTarget.name} (needs ${need.toFixed(1)} kW)`
                    : `${(need - kw).toFixed(1)} kW short for ${addTarget.name}`;
                }}
                /* the spec sheet goes in the right-hand column, full height,
                   unless a unit on the system is open there */
                detailHost={selectedAlloc ? null : sideHost}
                onChoose={chooseFromBrowser}
                onDragRow={(choice, transfer) => {
                  const iduModel = choice.kind === "pair" ? choice.pair.idu.model : choice.idu.model;
                  transfer.setData(DRAG_TYPE, JSON.stringify({ iduModel }));
                  transfer.effectAllowed = "copy";
                  setDragging("head");
                }}
              />
            ) : (
              <OutdoorTable
                pack={pack}
                view={view}
                basis={basis}
                onPick={dropOutdoor}
                onProposal={() => write(proposalHandedBack(draft, pack, view.sys.id))}
                onDrag={(oduModel, transfer) => {
                  transfer.setData(DRAG_TYPE, JSON.stringify({ oduModel }));
                  transfer.effectAllowed = "copy";
                  setDragging("outdoor");
                }}
              />
            )}
          </section>

          <aside
            className="ds-sb-side"
            aria-label={selectedAlloc ? "Selected unit" : side === "outdoor" ? "Outdoor unit" : "Unit detail"}
          >
            {view && selectedAlloc ? (
              <UnitDetail
                draft={draft}
                pack={pack}
                basis={basis}
                view={view}
                alloc={selectedAlloc}
                onChange={(d, err) => {
                  setError(err ?? null);
                  if (d) setDraft(d);
                }}
                onClose={() => setSelected(null)}
              />
            ) : view && side === "outdoor" ? (
              <OutdoorSide view={view} basis={basis} />
            ) : (
              <div className="ds-sb-side-host" ref={setSideHost} />
            )}
          </aside>
        </div>

        <footer className="ds-sb-foot">
          {view && (
            <button
              className="ds-sb-btn danger"
              onClick={() => {
                onCommit(releaseSystem(doc, view.sys.id));
                onClose();
              }}
            >
              Delete system
            </button>
          )}
          <span className="ds-sb-spring" />
          {(error || view?.reason) && (
            <p className="ds-sb-error" role="alert">
              {error ?? view?.reason}
            </p>
          )}
          <button className="ds-sb-btn" onClick={onClose}>
            Discard changes
          </button>
          <button
            className="ds-sb-btn primary"
            disabled={!!view && view.blocking.length > 0}
            onClick={() => (dirty ? onCommit(draft) : onClose())}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/* ─────────────────────────── the trail's menus ─────────────────────────── */

function CrumbMenu({
  label,
  value,
  options,
  onPick,
  now = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
  /** the crumb the list is on, in ink */
  now?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div
      className="ds-sb-crumb"
      ref={boxRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`ds-sb-crumb-btn${now ? " now" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current}
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-sb-menu" role="menu" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="ds-sb-menu-opt"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── the outdoor list ─────────────────────────── */

function OutdoorTable({
  pack,
  view,
  basis,
  onPick,
  onProposal,
  onDrag,
}: {
  pack: DataPack;
  view: SystemView;
  basis: SizingBasis;
  onPick: (model: string) => void;
  onProposal: () => void;
  onDrag: (model: string, transfer: DataTransfer) => void;
}) {
  const n = view.outRows.length;
  return (
    <div className="ds-sb-outdoors-wrap">
      <div className="ds-sb-outdoors-bar">
        <span className={`ds-ub-brand${view.empty ? "" : " locked"}`}>{brandName(pack, pack.meta.brand)}</span>
        <span className="ds-sb-outdoors-count">
          {n} {n === 1 ? "outdoor" : "outdoors"}
        </span>
        {view.oduByHand && (
          <button className="ds-sb-btn small" onClick={onProposal}>
            Use the proposal
          </button>
        )}
      </div>
      <div className="ds-sb-outdoors-scroll">
        <table className="ds-sb-outdoors">
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Capacity</th>
              <th className="num">Ports</th>
              <th className="num">Ratio</th>
              <th className="num">Combination</th>
            </tr>
          </thead>
          <tbody>
            {view.outRows.map((r) => {
              const note = r.current
                ? r.proposal
                  ? "On the system, proposed"
                  : "On the system"
                : r.proposal
                  ? "Proposal"
                  : null;
              return (
                <tr
                  key={r.odu.model}
                  className={`${r.current ? "sel" : ""}${r.valid === false ? " off" : ""}`}
                  tabIndex={0}
                  aria-selected={r.current}
                  draggable
                  onClick={() => onPick(r.odu.model)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(r.odu.model);
                    }
                  }}
                  onDragStart={(e) => {
                    if (e.dataTransfer) onDrag(r.odu.model, e.dataTransfer);
                  }}
                >
                  <td>
                    <span className="ds-sb-outdoors-model">{r.odu.model}</span>
                    {note && <span className="ds-sb-outdoors-note">{note}</span>}
                  </td>
                  <td className="num">{kwText(sizingCapacityKw(r.odu, basis))}</td>
                  <td className="num">{r.odu.system_type === "multi" ? (r.odu.ports ?? "—") : 1}</td>
                  <td className="num">{r.ratio == null ? "—" : `${r.ratio}%`}</td>
                  <td className={`num ${r.valid == null ? "quiet" : r.valid ? "ok" : "bad"}`}>
                    {r.valid == null ? "—" : r.valid ? "Valid" : "Fails"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────── the outdoor, on the right ─────────────────────── */

/** the Outdoor side's right-hand column: the outdoor on the system, what is
    connected to it and its pipework, all read off the pack */
function OutdoorSide({ view, basis }: { view: SystemView; basis: SizingBasis }) {
  const odu = view.oduRow;
  if (!odu) {
    return (
      <div className="ds-sb-side-empty">
        <p>No outdoor yet</p>
      </div>
    );
  }
  return (
    <div className="ds-sb-side-scroll">
      <div className="ds-sb-side-head">
        <span className="ds-sb-side-kind">Outdoor unit</span>
        <h3 className="ds-sb-side-title">{odu.model}</h3>
        <span className="ds-sb-side-sub">
          {view.oduByHand ? "Picked" : "Proposed"}, combination{" "}
          <span className={view.combination === "Valid" ? "ok" : "bad"}>
            {view.combination === "Valid" ? "valid" : "fails"}
          </span>
        </span>
      </div>
      <dl className="ds-sb-kv">
        <dt>Capacity</dt>
        <dd>{kwText(sizingCapacityKw(odu, basis))}</dd>
        {odu.system_type === "multi" && odu.ports != null && (
          <>
            <dt>Ports</dt>
            <dd className={view.heads.length > odu.ports ? "bad" : ""}>
              {view.heads.length} of {odu.ports}
            </dd>
          </>
        )}
        {view.connectedText && (
          <>
            <dt>Connected</dt>
            <dd>{view.connectedText}</dd>
          </>
        )}
        {view.ratio && (
          <>
            <dt>Connection ratio</dt>
            <dd>{view.ratio.pct}%</dd>
          </>
        )}
        {view.takesText && (
          <>
            <dt>Takes</dt>
            <dd className="bad">{view.takesText}</dd>
          </>
        )}
        {view.supplyText && (
          <>
            <dt>Supply</dt>
            <dd>{view.supplyText}</dd>
          </>
        )}
        {view.pipeText && (
          <>
            <dt>Pipe</dt>
            <dd>{view.pipeText}</dd>
          </>
        )}
        {view.limitsText && (
          <>
            <dt>Limits</dt>
            <dd>{view.limitsText}</dd>
          </>
        )}
        <dt>Drawn</dt>
        <dd className={view.drawnText === "Not yet" ? "quiet" : ""}>{view.drawnText}</dd>
        {view.refrigerantText && (
          <>
            <dt>Refrigerant</dt>
            <dd>{view.refrigerantText}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ─────────────────────────── the piping rail ─────────────────────────── */

function readPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer?.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

/** Enter and Space press a drawn control the way a click does */
const pressKeys = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/* THE GUTTER. A split or a multi is a star: every head has its own line pair
   back to the outdoor, so each zone has its own line down the gutter, turning
   into its card — the first zone's innermost, so no two cross. A VRF is one
   shared line with a joint per branch, and a unit on the band feeds its
   zones by air, the same trunk dashed. Lines are drawn row by row: a line
   passes down a row it is not for, and turns into the card of the row it is. */
const GUT_OFF = 14;
const GUT_SP = 12;
const GUT_TRUNK = 40;

interface PipeTone {
  /** in the system's colour: a unit of this system is on the end of it */
  on: boolean;
  bad?: boolean;
  /** air off the band, not refrigerant */
  air?: boolean;
}
const pipeClass = (t: PipeTone): string => `${t.on ? " on" : ""}${t.bad ? " bad" : ""}${t.air ? " air" : ""}`;

function PipingRail({
  draft,
  pack,
  view,
  selected,
  headType,
  aimedZoneId,
  outdoorOn,
  dragging,
  onAimZone,
  addZoneOpen,
  onSelect,
  onDropHead,
  onDropBand,
  onDropOutdoor,
  onDropSlot,
  onRemoveZone,
  onOutdoor,
  onAddZone,
  onCloseAddZone,
  onClaim,
}: {
  draft: DesignDocument;
  pack: DataPack;
  view: SystemView;
  selected: string | null;
  /** what the list beside the rail is offering — the band is only drawn
      when that could serve the whole system */
  headType: FormFactor | null;
  /** the zone the list's Add button puts a unit in */
  aimedZoneId: string | null;
  /** the list is on its Outdoor side */
  outdoorOn: boolean;
  dragging: "head" | "outdoor" | null;
  onAimZone: (zoneId: string) => void;
  addZoneOpen: boolean;
  onSelect: (allocationId: string | null) => void;
  onDropHead: (zoneId: string, iduModel: string) => void;
  onDropBand: (iduModel: string) => void;
  onDropOutdoor: (oduModel: string) => void;
  onDropSlot: (zone: ZoneView, iduModel: string) => void;
  onRemoveZone: (zoneId: string) => void;
  onOutdoor: () => void;
  onAddZone: () => void;
  onCloseAddZone: () => void;
  onClaim: (zoneId: string) => void;
}) {
  const { sys } = view;
  /* which target is lit: entered and left are counted per target, because a
     drag over a card's words leaves the card's box without leaving the card.
     The count lives on the target element for the length of the gesture —
     it is the element's own, and nothing else reads it */
  const [over, setOver] = useState<string | null>(null);
  const targetProps = (key: string, onPayload: (p: DragPayload) => void) => ({
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      const n = Number(e.currentTarget.getAttribute("data-over") ?? "0") + 1;
      e.currentTarget.setAttribute("data-over", String(n));
      if (n === 1) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      const n = Number(e.currentTarget.getAttribute("data-over") ?? "1") - 1;
      if (n <= 0) {
        e.currentTarget.removeAttribute("data-over");
        setOver((o) => (o === key ? null : o));
      } else {
        e.currentTarget.setAttribute("data-over", String(n));
      }
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.currentTarget.removeAttribute("data-over");
      setOver(null);
      const payload = readPayload(e);
      if (payload) onPayload(payload);
    },
  });
  const headOnly = (fn: (iduModel: string) => void) => (p: DragPayload) => {
    if ("iduModel" in p) fn(p.iduModel);
  };

  const band = view.bandUnits[0] ?? null;
  /* the band is drawn when it holds a unit, or when the list is offering one
     that could go in it — an empty Whole system box beside a multi of wall
     heads is a drop target for something nobody is holding */
  const wholeSystemType = headType === "ducted" || headType === "bulkhead";
  const showBand = Boolean(band) || wholeSystemType;
  /* Add zone is there only while there is a zone to add: one without a
     system, or one another system has (Isaac, 2026-09-23). With every zone
     on this system it would open on a list of nothing. */
  const toAdd = zonesToAdd(draft, sys.id);
  const canAdd = toAdd.length > 0;
  const free = toAdd.filter((z) => z.sharedWith.length === 0);
  const taken = toAdd.filter((z) => z.sharedWith.length > 0);
  const oduModel = view.odu?.model ?? "";
  const valid = view.combination === "Valid";

  const addZoneBox = useRef<HTMLDivElement>(null);
  const addZoneBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!addZoneOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addZoneBox.current?.contains(t) || addZoneBtn.current?.contains(t)) return;
      onCloseAddZone();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [addZoneOpen, onCloseAddZone]);

  /* the outdoor's ports, for a multi: how many of them its heads take, red
     when there are more heads than ports; before an outdoor, how many the
     zones will want */
  const multi = view.oduRow ? view.oduRow.system_type === "multi" : view.family === "multi";
  const heads = view.heads.filter((a) => a.serves !== "system").length;
  const ports = view.oduRow?.ports ?? null;
  const portsText = !multi
    ? view.oduRow
      ? kwText(sizingCapacityKw(view.oduRow, draft.settings.sizingBasis))
      : null
    : ports != null
      ? `${heads} of ${ports} ports`
      : `Needs ${Math.max(heads, view.zones.length)} ports`;
  const portsBad = multi && ports != null && heads > ports;

  const n = view.zones.length;
  const vrf = view.oduRow ? view.oduRow.system_type === "vrf" : view.family === "vrf";
  const trunk = Boolean(band) || vrf;
  const gutter = trunk ? GUT_TRUNK : GUT_OFF + Math.max(1, n) * GUT_SP + 8;
  const xOf = (k: number) => GUT_OFF + (n - 1 - k) * GUT_SP;
  const zoneTone = (z: ZoneView): PipeTone => ({ on: z.lines.some((l) => l.mine), bad: z.cant, air: Boolean(band) });
  const trunkTone: PipeTone = band ? { on: true, air: true } : { on: Boolean(view.odu) };
  const note = band
    ? "Ducted to each zone"
    : vrf
      ? "One shared line, a joint per branch"
      : multi
        ? "One line pair per port"
        : "One line pair";

  /* drawn in SVG, a row at a time: a line's ends are the row's top, middle
     and bottom, which only percentages know */
  const vline = (key: string, x: number, span: "full" | "top" | "bottom", tone: PipeTone) => (
    <line
      key={key}
      className={`ds-sb-pipe v${pipeClass(tone)}`}
      x1={x}
      x2={x}
      y1={span === "bottom" ? "50%" : 0}
      y2={span === "top" ? "50%" : "100%"}
    />
  );
  const hline = (key: string, x: number, tone: PipeTone) => (
    <line key={key} className={`ds-sb-pipe h${pipeClass(tone)}`} x1={x} x2={gutter} y1="50%" y2="50%" />
  );
  const pipes = (lines: React.ReactNode[]) => (
    <svg className="ds-sb-pipes" width={gutter} aria-hidden="true">
      {lines}
    </svg>
  );
  /* a row the lines only pass: the band waiting empty, a unit with no zone,
     the drop between the outdoor and the first zone */
  const passing = (): React.ReactNode[] =>
    trunk ? [vline("trunk", GUT_OFF, "full", trunkTone)] : view.zones.map((z, k) => vline(z.zone.id, xOf(k), "full", zoneTone(z)));
  /* a zone's row: the lines of the zones below pass it, its own turns in */
  const zonePipes = (z: ZoneView, i: number): React.ReactNode[] => {
    if (trunk) {
      return [
        vline("trunk", GUT_OFF, i < n - 1 ? "full" : "top", trunkTone),
        hline("branch", GUT_OFF, zoneTone(z)),
        ...(vrf && !band
          ? [<rect key="joint" className="ds-sb-joint" x={GUT_OFF - 4} y="50%" width={8} height={8} rx={2} transform="translate(0 -4)" />]
          : []),
      ];
    }
    return [
      ...view.zones.slice(i + 1).map((below, j) => vline(below.zone.id, xOf(i + 1 + j), "full", zoneTone(below))),
      vline(z.zone.id, xOf(i), "top", zoneTone(z)),
      hline("elbow", xOf(i), zoneTone(z)),
    ];
  };

  const describe = `Schematic of ${sys.name}: ${
    view.odu ? `${oduModel} above` : "no outdoor yet, above"
  } ${n} ${n === 1 ? "zone" : "zones"}${band ? `, ${band.model} on the band` : ""}`;

  return (
    <section
      className={`ds-sb-rail${dragging ? ` dragging ${dragging}` : ""}`}
      aria-label={describe}
      style={{ "--sys": sys.colour } as React.CSSProperties}
    >
      <div className="ds-sb-rail-head">
        <h3 className="ds-sb-rail-title">Piping</h3>
        <span className="ds-sb-rail-note">{note}</span>
      </div>
      <div className="ds-sb-rail-scroll" onClick={() => onSelect(null)}>
        {/* the outdoor: dashed until something lands; pressing it turns the
            list to Outdoor, and an outdoor dragged from there lands on it */}
        <div
          className={`ds-sb-out${view.odu ? "" : " empty"}${outdoorOn ? " on" : ""}${over === "outdoor" ? " over" : ""}${
            view.odu && !valid ? " fails" : ""
          }`}
          role="button"
          tabIndex={0}
          aria-label={view.odu ? `Outdoor ${oduModel}` : "Outdoor"}
          aria-pressed={outdoorOn}
          onClick={(e) => {
            e.stopPropagation();
            onOutdoor();
          }}
          onKeyDown={pressKeys(onOutdoor)}
          {...targetProps("outdoor", (p) => {
            if ("oduModel" in p) onDropOutdoor(p.oduModel);
          })}
        >
          <span className="ds-sb-out-top">
            <span className="ds-sb-out-label">Outdoor</span>
            {portsText && <span className={`ds-sb-out-ports${portsBad ? " bad" : ""}`}>{portsText}</span>}
          </span>
          <span className="ds-sb-out-model">{view.odu ? oduModel : "No outdoor yet"}</span>
          {view.odu && (
            <span className={`ds-sb-state ${valid ? "ok" : "bad"}`}>
              {`${view.oduByHand ? "Picked" : "Proposed"}, combination ${valid ? "valid" : "fails"}`}
            </span>
          )}
        </div>

        {/* the band: a unit dropped here serves the whole system */}
        {showBand && (
          <div className="ds-sb-row" style={{ paddingLeft: gutter }}>
            {pipes(
              band
                ? [
                    vline("feed", GUT_OFF, "top", { on: Boolean(view.odu) }),
                    hline("in", GUT_OFF, { on: Boolean(view.odu) }),
                    vline("air", GUT_OFF, "bottom", trunkTone),
                  ]
                : passing()
            )}
            <div
              className={`ds-sb-band${band ? "" : " empty"}${over === "band" ? " over" : ""}${
                band && selected === band.id ? " sel" : ""
              }`}
              {...targetProps("band", headOnly(onDropBand))}
            >
              {band ? (
                <button
                  type="button"
                  className="ds-sb-band-btn"
                  aria-label={`${band.model}, serves the whole system`}
                  aria-pressed={selected === band.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(band.id);
                  }}
                >
                  <span className="ds-sb-band-model">{band.model}</span>
                  <span className="ds-sb-band-facts">
                    {[
                      kwText(kwOf(pack, band.model, draft.settings.sizingBasis)),
                      iduRowOf(pack, band.model)?.airflow_ls != null ? `${iduRowOf(pack, band.model)!.airflow_ls} L/s` : null,
                      view.bandPipe ? `${view.bandPipe} mm` : null,
                      "serves the whole system",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </button>
              ) : (
                <span className="ds-sb-band-word">Whole system</span>
              )}
            </div>
          </div>
        )}

        {/* heads with no zone of this system: waiting above the zones */}
        {view.strays.map((a) => (
          <div key={a.id} className="ds-sb-row" style={{ paddingLeft: gutter }}>
            {pipes(passing())}
            <button
              type="button"
              className={`ds-sb-stray${selected === a.id ? " sel" : ""}`}
              aria-label={`${a.model}, no zone`}
              aria-pressed={selected === a.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(a.id);
              }}
            >
              <span className="ds-sb-stray-model">{a.model}</span>
              <span className="ds-sb-stray-word">No zone</span>
            </button>
          </div>
        ))}

        {n > 0 && (
          <div className="ds-sb-feed">{pipes(passing())}</div>
        )}

        {view.zones.map((z, i) => {
          const key = `zone:${z.zone.id}`;
          const aimed = z.zone.id === aimedZoneId;
          return (
            <div key={z.zone.id} className="ds-sb-row" style={{ paddingLeft: gutter }}>
              {pipes(zonePipes(z, i))}
              <div
                className={`ds-sb-zone${over === key ? " over" : ""}${z.cant ? " cant" : ""}${z.short ? " short" : ""}${
                  aimed ? " aimed" : ""
                }`}
                {...targetProps(key, headOnly((m) => onDropHead(z.zone.id, m)))}
              >
                {/* the card is the aim: under its words, so a click anywhere
                    on it chooses where the list's Add puts the next unit.
                    Not "Add to <zone>": that is the list's button, which
                    performs the add */}
                <button
                  type="button"
                  className="ds-sb-zone-aim"
                  aria-label={`Put the next unit in ${z.name}`}
                  aria-pressed={aimed}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAimZone(z.zone.id);
                  }}
                />
                <span className="ds-sb-zone-top">
                  <span className="ds-sb-zone-name">{z.name}</span>
                  <span className="ds-sb-zone-need">{z.loadKw != null ? `${z.loadKw.toFixed(1)} kW` : "No load yet"}</span>
                </span>
                {/* a unit a line: its model, and its kW at the right */}
                {z.lines.map((line) => {
                  const isSel = line.mine && selected === line.alloc.id;
                  return (
                    <span key={line.alloc.id} className="ds-sb-zone-line">
                      {line.mine ? (
                        <button
                          type="button"
                          className={`ds-sb-head-model${isSel ? " sel" : ""}`}
                          aria-label={`${line.alloc.model} in ${z.name}`}
                          aria-pressed={isSel}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(line.alloc.id);
                          }}
                        >
                          {line.alloc.model}
                        </button>
                      ) : (
                        <span className="ds-sb-head-model other" title={`${line.sys.name}, read-only here`}>
                          <span className="ds-sb-head-dot" style={{ background: line.sys.colour }} aria-hidden="true" />
                          {line.alloc.model}
                        </span>
                      )}
                      <span className="ds-sb-zone-kw">{kwText(line.kw)}</span>
                    </span>
                  );
                })}
                {/* then the zone's word, and the pipe size of its last unit at
                    the right: a split's from its pair, a multi head's its own
                    connection */}
                {z.lines.length > 0 && (
                  <span className="ds-sb-zone-line foot">
                    <span className={`ds-sb-state ${z.word.tone}${z.cant ? " wrap" : ""}`}>{z.word.text}</span>
                    {z.pipe && !z.cant && <span className="ds-sb-zone-pipe">{z.pipe}</span>}
                  </span>
                )}
                {z.lines.length === 0 && (
                  <span className="ds-sb-zone-line">
                    {/* a zone the band feeds has its unit: the one above */}
                    <span className="ds-sb-zone-none">{band ? band.model : "No unit yet"}</span>
                    {z.word.text && <span className={`ds-sb-state ${z.word.tone}`}>{z.word.text}</span>}
                  </span>
                )}
                {z.slot && (
                  <span
                    className={`ds-sb-slot${over === `slot:${z.zone.id}` ? " over" : ""}`}
                    {...targetProps(`slot:${z.zone.id}`, headOnly((m) => onDropSlot(z, m)))}
                  >
                    {z.slot === "split" ? "Add another split" : "Add another unit"}
                  </span>
                )}
                <button
                  type="button"
                  className="ds-sb-zone-x"
                  aria-label={`Clear ${z.name} from ${sys.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveZone(z.zone.id);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Add zone claims another of the plan's zones. It is not a zone, so
            no line runs into it */}
        {canAdd && (
          <div className="ds-sb-addwrap" style={{ paddingLeft: gutter }}>
            <button
              ref={addZoneBtn}
              type="button"
              className={`ds-sb-add${addZoneOpen ? " on" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={addZoneOpen}
              onClick={(e) => {
                e.stopPropagation();
                onAddZone();
              }}
            >
              <Icon name="plus" size={12} />
              Add zone
            </button>
            {addZoneOpen && (
              <div
                ref={addZoneBox}
                className="ds-sb-addzone"
                role="dialog"
                aria-label="Add zone"
                onClick={(e) => e.stopPropagation()}
              >
                {free.length > 0 && <p className="ds-sb-addzone-label">Without a system</p>}
                {free.map(({ zone }) => (
                  <button key={zone.id} type="button" className="ds-sb-addzone-opt" onClick={() => onClaim(zone.id)}>
                    <span className="ds-sb-dot unclaimed" />
                    <span className="ds-sb-addzone-name">{zoneName(zone)}</span>
                    <span className="ds-sb-addzone-load">{kwText(roomLoadKw(draft, zone))}</span>
                  </button>
                ))}
                {taken.length > 0 && <p className="ds-sb-addzone-label">On another system</p>}
                {taken.map(({ zone, sharedWith }) => (
                  <button key={zone.id} type="button" className="ds-sb-addzone-opt" onClick={() => onClaim(zone.id)}>
                    <span className="ds-sb-dot" style={{ background: sharedWith[0].colour }} />
                    <span className="ds-sb-addzone-name">
                      {zoneName(zone)}
                      <span className="ds-sb-addzone-sub">{sharedWith.map((s) => s.name).join(", ")}</span>
                    </span>
                    <span className="ds-sb-addzone-load">{kwText(roomLoadKw(draft, zone))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── a head's detail ─────────────────────────── */

function UnitDetail({
  draft,
  pack,
  basis,
  view,
  alloc,
  onChange,
  onClose,
}: {
  draft: DesignDocument;
  pack: DataPack;
  basis: SizingBasis;
  view: SystemView;
  alloc: Allocation;
  onChange: (next: DesignDocument | null, error?: string) => void;
  onClose: () => void;
}) {
  const { sys } = view;
  const zone = view.zones.find((z) => z.zone.id === alloc.roomId) ?? null;
  const current = iduRowOf(pack, alloc.model);
  const pairFlow = sys.type === "split" || sys.type === "ducted";

  /* the sizes it could be: the same series, units this system type can take */
  const candidates = useMemo((): IndoorUnit[] => {
    if (!current) return [];
    const pool = pairFlow
      ? pack.indoor_units.filter((u) => pack.pair_tables.some((p) => p.idu_model === u.model))
      : multiCapableIdus(pack);
    return pool
      .filter((u) => u.series === current.series)
      .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model));
  }, [pack, pairFlow, current]);

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
  const beforeOdu = view.odu?.model ?? "";
  const pipe = pipeSize(pack, sys, alloc, view.odu?.model ?? null);
  const kw = kwOf(pack, alloc.model, basis);

  return (
    <div className="ds-sb-side-scroll ds-sb-pane">
      <div className="ds-sb-side-head">
        <span className="ds-sb-side-kind">{alloc.serves === "system" ? "Whole system unit" : "Indoor unit"}</span>
        <div className="ds-sb-detail-head">
          <h3 className="ds-sb-side-title">{alloc.model}</h3>
          <span className="ds-sb-spring" />
          <button className="ds-sb-x" onClick={onClose} aria-label="Close unit detail">
            <Icon name="x" size={16} />
          </button>
        </div>
        <span className="ds-sb-side-sub">
          {alloc.serves === "system" ? "Whole system" : zone ? zone.name : "No zone"}, {sys.name}
        </span>
      </div>
      {(kw != null || pipe) && (
        <dl className="ds-sb-kv">
          {kw != null && (
            <>
              <dt>Capacity</dt>
              <dd>{kwText(kw)}</dd>
            </>
          )}
          {pipe && (
            <>
              <dt>Pipe</dt>
              <dd>{pipe} mm</dd>
            </>
          )}
        </dl>
      )}
      {alloc.serves !== "system" && (
        <label className="ds-sb-field">
          <span>Zone</span>
          <select
            value={zone ? zone.zone.id : ""}
            onChange={(e) => onChange(moveAllocation(draft, sys.id, alloc.id, e.target.value))}
          >
            {!zone && (
              <option value="" disabled>
                No zone
              </option>
            )}
            {view.zones.map((z) => (
              <option key={z.zone.id} value={z.zone.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.length > 1 && (
        <div className="ds-sb-sizes">
          <span className="ds-sb-label">Sizes</span>
          <ul>
            {rows.map(({ u, doc: after, ok, reason }) => {
              const isCurrent = u.model === alloc.model;
              const verdict = zone && ok ? roomVerdict(after, pack, basis, zone.zone) : null;
              const afterSys = after.systems.find((s) => s.id === sys.id);
              const afterOdu = afterSys ? (allocationsOf(afterSys).find((a) => a.role === "odu")?.model ?? "") : "";
              const afterWord = afterSys && ok ? combinationWord(after, pack, afterSys) : null;
              const word: Word | null = !verdict
                ? null
                : verdict.word === "Fits"
                  ? { text: "Fits", tone: "ok" }
                  : verdict.word === "Undersized"
                    ? { text: "Short", tone: "bad" }
                    : verdict.word === "Oversized"
                      ? { text: "Oversized", tone: "warn" }
                      : null;
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
                        {word && <span className={`ds-sb-word ${word.tone}`}>{word.text}</span>}
                        {afterWord === "Fails" && <span className="ds-sb-word bad">Combination fails</span>}
                        {afterWord === "Valid" && afterOdu !== beforeOdu && (
                          <span className="ds-sb-word quiet">Outdoor becomes {afterOdu}</span>
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
      <button
        className="ds-sb-btn ds-sb-remove"
        onClick={() => {
          onChange(removeAllocation(draft, sys.id, alloc.id, pack));
          onClose();
        }}
      >
        Remove unit
      </button>
    </div>
  );
}
