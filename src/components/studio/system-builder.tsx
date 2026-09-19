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

/* How much of the window the picker takes, the schematic the rest — dragged
   on the edge between them and kept for next time on this device. */
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
  lines: number;
  verdict: RoomVerdict;
}): { word: Word; short: boolean } {
  const { cant, oduModel, bandKw, zonesLoadKw, lines, verdict } = args;
  if (cant) return { word: { text: `Can't join ${oduModel}`, tone: "bad" }, short: false };
  /* a unit on the band serves every zone: each zone reads the unit against
     the load of all of them together */
  if (bandKw != null) {
    if (zonesLoadKw == null || zonesLoadKw <= 0) return { word: { text: kwText(bandKw), tone: "quiet" }, short: false };
    const p = pct(bandKw, zonesLoadKw);
    return p >= 100
      ? { word: { text: `Fits, ${p}%`, tone: "ok" }, short: false }
      : { word: { text: `Short, ${p}%`, tone: "bad" }, short: true };
  }
  if (lines === 0) return { word: { text: "No unit yet", tone: "quiet" }, short: false };
  const p = verdict.loadKw ? pct(verdict.coverKw, verdict.loadKw) : null;
  switch (verdict.word) {
    case "Fits":
      return { word: { text: `Fits, ${p}%`, tone: "ok" }, short: false };
    case "Undersized":
      return { word: { text: `Short, ${p}%`, tone: "bad" }, short: true };
    case "Oversized":
      return { word: { text: `Oversized, ${p}%`, tone: "warn" }, short: false };
    case "Calibrate":
      return { word: { text: kwText(verdict.coverKw), tone: "quiet" }, short: false };
    default:
      return { word: { text: "No unit yet", tone: "quiet" }, short: false };
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

/* ─────────────────────────── schematic layout ─────────────────────────── */

const PAD = 24;
const CARD_W = 248;
const CARD_GAP = 48;
const COLS = 4;
const ROW_GAP = 28;
const OUT_W = 260;
const OUT_H = 70;
const OUT_Y = 10;
const BAND_W = 280;
const BAND_H = 56;
const TOP_GAP = 80;
const STRAY_W = 200;
const STRAY_H = 40;
const BUS_DROP = 28;
const GUTTER = 16;
const LINE = 18;
const TEXT_X = 18;
const SLOT_H = 58;
const FIRST_LINE = 65;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface CardBox extends Box {
  row: number;
}

/** balanced rows of at most four: five cards sit three and two, seven four
    and three */
function gridRows(count: number): number[] {
  if (count <= 0) return [];
  const rows = Math.ceil(count / COLS);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
}

/** how tall a zone card is: its lines of text, then the slot if it has one */
function cardHeight(textRows: number, slot: boolean): number {
  const lastLine = FIRST_LINE + LINE * (textRows - 1);
  return slot ? lastLine + 15 + SLOT_H + 18 : Math.max(82, lastLine + 13);
}

function layout(cards: number, cardH: number, strays: number) {
  const rows = gridRows(cards);
  const wide = rows.length ? rows[0] : 1;
  const gridW = wide * CARD_W + (wide - 1) * CARD_GAP;
  const topW = OUT_W + TOP_GAP + BAND_W;
  const width = Math.max(gridW, topW) + 2 * PAD;
  const topLeft = (width - topW) / 2;
  const out: Box = { x: topLeft, y: OUT_Y, w: OUT_W, h: OUT_H };
  const band: Box = { x: topLeft + OUT_W + TOP_GAP, y: OUT_Y + (OUT_H - BAND_H) / 2, w: BAND_W, h: BAND_H };
  const strayY = OUT_Y + OUT_H + 12;
  const strayBoxes: Box[] = Array.from({ length: strays }, (_, i) => ({
    x: PAD + i * (STRAY_W + 12),
    y: strayY,
    w: STRAY_W,
    h: STRAY_H,
  }));
  const busY = OUT_Y + OUT_H + (strays ? STRAY_H + 12 : 0) + 20;
  const firstTop = busY + BUS_DROP;
  const boxes: CardBox[] = [];
  rows.forEach((n, r) => {
    const rowW = n * CARD_W + (n - 1) * CARD_GAP;
    const x0 = (width - rowW) / 2;
    const y = firstTop + r * (cardH + ROW_GAP);
    for (let c = 0; c < n; c++) boxes.push({ x: x0 + c * (CARD_W + CARD_GAP), y, w: CARD_W, h: cardH, row: r });
  });
  const height = (rows.length ? firstTop + rows.length * cardH + (rows.length - 1) * ROW_GAP : busY) + PAD;
  const gridRight = (width + gridW) / 2;
  return { width, height, out, band, strayBoxes, busY, boxes, rows, gridRight };
}
type Layout = ReturnType<typeof layout>;

/** one trunk from the source, a bus over the first row, a rail down the
    right into a gutter above each later row, and one drop per card: all
    orthogonal, none across a card's words */
function busPath(l: Layout, fromX: number, fromY: number): string {
  const parts: string[] = [`M${fromX} ${fromY} V${l.busY}`];
  if (!l.boxes.length) return parts.join(" ");
  const centre = (b: Box) => b.x + b.w / 2;
  const rowsOf = (r: number) => l.boxes.filter((b) => b.row === r);
  const row0 = rowsOf(0);
  const left0 = centre(row0[0]);
  const right0 = centre(row0[row0.length - 1]);
  const railX = l.gridRight + 20;
  const later = l.rows.length > 1;
  parts.push(`M${Math.min(left0, fromX)} ${l.busY} H${later ? Math.max(railX, fromX) : Math.max(right0, fromX)}`);
  let prevY = l.busY;
  for (let r = 1; r < l.rows.length; r++) {
    const row = rowsOf(r);
    const gutterY = row[0].y - GUTTER;
    parts.push(`M${Math.max(railX, fromX)} ${prevY} V${gutterY} H${centre(row[0])}`);
    prevY = gutterY;
  }
  for (const b of l.boxes) parts.push(`M${centre(b)} ${b.row === 0 ? l.busY : b.y - GUTTER} V${b.y}`);
  return parts.join(" ");
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
  const addTarget = view ? (view.zones.find((z) => !z.lines.some((l) => l.mine)) ?? view.zones[0]) : null;

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
                  <>
                    <div className="ds-sb-stat">
                      <dt>Brand</dt>
                      <dd>{brandName(pack, view.sys.brand)}</dd>
                    </div>
                    <div className="ds-sb-stat">
                      <dt>Type</dt>
                      <dd>{KIND_WORD[view.kind]}</dd>
                    </div>
                  </>
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
                  <>
                    <div className="ds-sb-stat">
                      <dt>Cover</dt>
                      <dd className={view.anyShort ? "bad" : view.coverKw == null ? "quiet" : ""}>{kwText(view.coverKw)}</dd>
                    </div>
                    <div className="ds-sb-stat">
                      <dt>Combination</dt>
                      <dd className={view.combination === "Valid" ? "ok" : view.combination === "Fails" ? "bad" : "quiet"}>
                        {view.combination ?? "—"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </>
          )}
          <span className="ds-sb-spring" />
          <button className="ds-sb-x" onClick={onClose} aria-label="Close builder">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-sb-panes" ref={panesRef}>
          <div className="ds-sb-top" style={{ flexBasis: `${split}%` }}>
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
                      onClick={() => setSide("outdoor")}
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

            {view && (
              <aside className="ds-sb-summary" aria-label={selectedAlloc ? "Selected unit" : "Summary"}>
                {selectedAlloc ? (
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
                ) : (
                  <Summary view={view} basis={basis} />
                )}
              </aside>
            )}
          </div>

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

          <section className={`ds-sb-work${dragging ? ` dragging ${dragging}` : ""}`} aria-label="Schematic">
            {view && (
              <Schematic
                draft={draft}
                pack={pack}
                view={view}
                selected={selected}
                addZoneOpen={addZoneOpen}
                onSelect={setSelected}
                onDropHead={dropHead}
                onDropBand={dropBand}
                onDropOutdoor={dropOutdoor}
                onDropSlot={dropSlot}
                onRemoveZone={(zoneId) => write(removeZone(draft, pack, view.sys.id, zoneId))}
                onOutdoor={() => setSide("outdoor")}
                onAddZone={() => setAddZoneOpen((o) => !o)}
                onCloseAddZone={() => setAddZoneOpen(false)}
                onClaim={(zoneId) => {
                  write(claimZone(draft, view.sys.id, zoneId));
                  setAddZoneOpen(false);
                }}
              />
            )}
          </section>
        </div>

        <footer className="ds-sb-foot">
          {view && (
            <button
              className="ds-sb-btn"
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

/* ─────────────────────────── the summary ─────────────────────────── */

function Summary({ view, basis }: { view: SystemView; basis: SizingBasis }) {
  const band = view.bandUnits[0] ?? null;
  return (
    <>
      <table className="ds-sb-sum-zones">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Unit</th>
            <th className="num">Cover</th>
          </tr>
        </thead>
        <tbody>
          {view.zones.map((z) => {
            const mine = z.lines.filter((l) => l.mine).map((l) => l.alloc.model);
            const unit = band ? band.model : mine.length ? mine.join(", ") : "No unit yet";
            const p = band
              ? view.zonesLoadKw
                ? pct(view.coverKw ?? 0, view.zonesLoadKw)
                : null
              : z.verdict.loadKw
                ? pct(z.verdict.coverKw, z.verdict.loadKw)
                : null;
            const cover = z.cant
              ? { text: "Can't join", tone: "bad" as Tone }
              : !band && z.lines.length === 0
                ? { text: z.loadKw != null ? `${z.loadKw.toFixed(1)} kW short` : "—", tone: "quiet" as Tone }
                : { text: p == null ? kwText(z.verdict.coverKw) : `${p}%`, tone: z.word.tone };
            return (
              <tr key={z.zone.id}>
                <td>{z.name}</td>
                <td className="quiet">{unit}</td>
                <td className={`num ${cover.tone}`}>{cover.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.oduRow && (
        <section className="ds-sb-sum-sec">
          <h3>Outdoor</h3>
          <dl className="ds-sb-kv">
            <dt>Model</dt>
            <dd>{view.oduRow.model}</dd>
            <dt>Capacity</dt>
            <dd>{kwText(sizingCapacityKw(view.oduRow, basis))}</dd>
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
          </dl>
        </section>
      )}
      {(view.pipeText || view.oduRow) && (
        <section className="ds-sb-sum-sec">
          <h3>Pipework</h3>
          <dl className="ds-sb-kv">
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
        </section>
      )}
    </>
  );
}

/* ─────────────────────────── the schematic ─────────────────────────── */

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

function Schematic({
  draft,
  pack,
  view,
  selected,
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
  const textRows = Math.max(1, ...view.zones.map((z) => (z.lines.length ? z.lines.length + 1 : 1)));
  const cardH = cardHeight(textRows, view.zones.some((z) => z.slot != null));
  const l = layout(view.zones.length + 1, cardH, view.strays.length);
  const addBox = l.boxes[l.boxes.length - 1];
  const source = band ? l.band : l.out;
  const trunk = busPath(l, source.x + source.w / 2, source.y + source.h);
  const oduModel = view.odu?.model ?? "";
  const valid = view.combination === "Valid";

  const addZoneBox = useRef<HTMLDivElement>(null);
  const addZoneCard = useRef<SVGGElement>(null);
  useEffect(() => {
    if (!addZoneOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addZoneBox.current?.contains(t) || addZoneCard.current?.contains(t)) return;
      onCloseAddZone();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [addZoneOpen, onCloseAddZone]);
  const toAdd = addZoneOpen ? zonesToAdd(draft, sys.id) : [];
  const free = toAdd.filter((z) => z.sharedWith.length === 0);
  const taken = toAdd.filter((z) => z.sharedWith.length > 0);

  const describe = `Schematic of ${sys.name}: ${
    view.odu ? `${oduModel} above` : "no outdoor yet, above"
  } ${view.zones.length} ${view.zones.length === 1 ? "zone" : "zones"}${band ? `, ${band.model} on the band` : ""}`;

  return (
    <div className="ds-sb-schematic" onClick={() => onSelect(null)}>
      <svg
        className="ds-sb-svg"
        width={l.width}
        height={l.height}
        viewBox={`0 0 ${l.width} ${l.height}`}
        role="img"
        aria-label={describe}
        style={{ "--sys": sys.colour } as React.CSSProperties}
      >
        {/* lines first, under everything: in the system's colour once it has
            an outdoor, quiet and dashed until then, air lines dashed */}
        <path
          className={`ds-sb-line${view.odu ? "" : " quiet"}${!view.odu || band ? " dashed" : ""}`}
          d={trunk}
        />
        {view.zones.map((z, i) => {
          const b = l.boxes[i];
          if (!z.cant) return null;
          return (
            <path
              key={z.zone.id}
              className="ds-sb-line dashed bad"
              d={`M${b.x + b.w / 2} ${b.row === 0 ? l.busY : b.y - GUTTER} V${b.y}`}
            />
          );
        })}
        {band && (
          <>
            <path className="ds-sb-line" d={`M${l.out.x + l.out.w} ${l.out.y + l.out.h / 2} H${l.band.x}`} />
            {view.bandPipe && (
              <text className="ds-sb-fact" x={l.out.x + l.out.w + TOP_GAP / 2} y={l.out.y + l.out.h / 2 - 8} textAnchor="middle">
                {view.bandPipe}
              </text>
            )}
          </>
        )}

        {/* the outdoor box: dashed with the word until something lands */}
        <g
          className={`ds-sb-out${view.odu ? "" : " empty"}${over === "outdoor" ? " over" : ""}${
            view.odu && !valid ? " fails" : ""
          }`}
          role="button"
          tabIndex={0}
          aria-label={view.odu ? `Outdoor ${oduModel}` : "Outdoor"}
          onClick={(e) => {
            e.stopPropagation();
            onOutdoor();
          }}
          onKeyDown={pressKeys(onOutdoor)}
          {...targetProps("outdoor", (p) => {
            if ("oduModel" in p) onDropOutdoor(p.oduModel);
          })}
        >
          <rect
            className="ds-sb-out-box"
            x={l.out.x}
            y={l.out.y}
            width={l.out.w}
            height={l.out.h}
            rx={10}
          />
          {view.odu ? (
            <>
              <text className="ds-sb-out-model" x={l.out.x + l.out.w / 2} y={l.out.y + 22} textAnchor="middle">
                {oduModel}
              </text>
              <text className="ds-sb-fact" x={l.out.x + l.out.w / 2} y={l.out.y + 40} textAnchor="middle">
                {view.outFacts}
              </text>
              <text
                className={`ds-sb-state ${valid ? "ok" : "bad"}`}
                x={l.out.x + l.out.w / 2}
                y={l.out.y + 58}
                textAnchor="middle"
              >
                {view.oduByHand ? "Picked" : "Proposed"}, combination {valid ? "valid" : "fails"}
              </text>
            </>
          ) : (
            <text className="ds-sb-out-model" x={l.out.x + l.out.w / 2} y={l.out.y + l.out.h / 2 + 5} textAnchor="middle">
              Outdoor
            </text>
          )}
        </g>

        {/* the band: a unit dropped here serves the whole system */}
        <g
          className={`ds-sb-band${band ? "" : " empty"}${over === "band" ? " over" : ""}${
            band && selected === band.id ? " sel" : ""
          }`}
          role={band ? "button" : undefined}
          tabIndex={band ? 0 : undefined}
          aria-label={band ? `${band.model}, serves the whole system` : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (band) onSelect(band.id);
          }}
          onKeyDown={band ? pressKeys(() => onSelect(band.id)) : undefined}
          {...targetProps("band", headOnly(onDropBand))}
        >
          <rect
            className="ds-sb-band-box"
            x={l.band.x}
            y={l.band.y}
            width={l.band.w}
            height={l.band.h}
            rx={10}
          />
          {band ? (
            <>
              <text className="ds-sb-out-model" x={l.band.x + l.band.w / 2} y={l.band.y + 22} textAnchor="middle">
                {band.model}
              </text>
              <text className="ds-sb-fact" x={l.band.x + l.band.w / 2} y={l.band.y + 40} textAnchor="middle">
                {[
                  kwText(kwOf(pack, band.model, draft.settings.sizingBasis)),
                  iduRowOf(pack, band.model)?.airflow_ls != null ? `${iduRowOf(pack, band.model)!.airflow_ls} L/s` : null,
                  "serves the whole system",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </text>
            </>
          ) : (
            <text className="ds-sb-out-model" x={l.band.x + l.band.w / 2} y={l.band.y + l.band.h / 2 + 5} textAnchor="middle">
              Whole system
            </text>
          )}
        </g>

        {/* heads with no zone of this system: waiting under the band */}
        {view.strays.map((a, i) => {
          const b = l.strayBoxes[i];
          return (
            <g
              key={a.id}
              className={`ds-sb-stray${selected === a.id ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${a.model}, no zone`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(a.id);
              }}
              onKeyDown={pressKeys(() => onSelect(a.id))}
            >
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} />
              <text className="ds-sb-head-model" x={b.x + 12} y={b.y + 17}>
                {a.model}
              </text>
              <text className="ds-sb-fact" x={b.x + 12} y={b.y + 32}>
                No zone
              </text>
            </g>
          );
        })}

        {view.zones.map((z, i) => {
          const b = l.boxes[i];
          const key = `zone:${z.zone.id}`;
          const hasMine = z.lines.some((x) => x.mine);
          const lastLine = FIRST_LINE + LINE * Math.max(0, z.lines.length);
          const wordY = b.y + lastLine;
          const dotX = z.shared ? TEXT_X + 18 : TEXT_X;
          return (
            <g
              key={z.zone.id}
              className={`ds-sb-zone${hasMine ? " mine" : ""}${over === key ? " over" : ""}${z.cant ? " cant" : ""}${
                z.short ? " short" : ""
              }`}
              {...targetProps(key, headOnly((m) => onDropHead(z.zone.id, m)))}
            >
              <rect
                className="ds-sb-zone-box"
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={10}
              />
              <text className="ds-sb-zone-name" x={b.x + TEXT_X} y={b.y + 24}>
                {z.name}
              </text>
              <text className="ds-sb-fact" x={b.x + TEXT_X} y={b.y + 42}>
                {z.loadKw != null ? `Needs ${z.loadKw.toFixed(1)} kW` : "No heat load yet"}
                {z.shared ? `, shared with ${[...new Set(z.lines.filter((x) => !x.mine).map((x) => x.sys.name))].join(", ")}` : ""}
              </text>
              {z.lines.map((line, k) => {
                const y = b.y + FIRST_LINE + LINE * k;
                const right = line.mine ? kwText(line.kw) : `${line.sys.name}, ${kwText(line.kw)}`;
                const isSel = line.mine && selected === line.alloc.id;
                return (
                  <g
                    key={line.alloc.id}
                    className={`ds-sb-head-line${line.mine ? "" : " other"}${isSel ? " sel" : ""}`}
                    role={line.mine ? "button" : undefined}
                    tabIndex={line.mine ? 0 : undefined}
                    aria-label={line.mine ? `${line.alloc.model} in ${z.name}` : undefined}
                    onClick={
                      line.mine
                        ? (e) => {
                            e.stopPropagation();
                            onSelect(line.alloc.id);
                          }
                        : undefined
                    }
                    onKeyDown={line.mine ? pressKeys(() => onSelect(line.alloc.id)) : undefined}
                  >
                    <rect x={b.x + 8} y={y - 13} width={b.w - 16} height={LINE} rx={6} />
                    {z.shared && <circle cx={b.x + TEXT_X + 5} cy={y - 4} r={5} fill={line.sys.colour} />}
                    <text className={`ds-sb-head-model${line.mine ? "" : " other"}`} x={b.x + dotX} y={y}>
                      {line.alloc.model}
                    </text>
                    <text className="ds-sb-fact" x={b.x + b.w - TEXT_X} y={y} textAnchor="end">
                      {right}
                    </text>
                  </g>
                );
              })}
              <text className={`ds-sb-state ${z.word.tone}`} x={b.x + TEXT_X} y={wordY}>
                {z.word.text}
              </text>
              {z.pipe && z.lines.length > 0 && (
                <text className="ds-sb-fact" x={b.x + b.w - TEXT_X} y={wordY} textAnchor="end">
                  {z.pipe}
                </text>
              )}
              {z.slot && (
                <g
                  className={`ds-sb-slot${over === `slot:${z.zone.id}` ? " over" : ""}`}
                  {...targetProps(`slot:${z.zone.id}`, headOnly((m) => onDropSlot(z, m)))}
                >
                  <rect x={b.x + TEXT_X} y={wordY + 15} width={b.w - 2 * TEXT_X} height={SLOT_H} rx={10} />
                  <text x={b.x + b.w / 2} y={wordY + 15 + SLOT_H / 2 + 5} textAnchor="middle">
                    {z.slot === "split" ? "Add another split" : "Add another unit"}
                  </text>
                </g>
              )}
              <g
                className="ds-sb-zone-x"
                role="button"
                tabIndex={0}
                aria-label={`Clear ${z.name} from ${sys.name}`}
                transform={`translate(${b.x + b.w - 30}, ${b.y + 10})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveZone(z.zone.id);
                }}
                onKeyDown={pressKeys(() => onRemoveZone(z.zone.id))}
              >
                <rect width={20} height={20} rx={6} />
                <path d="M6 6 L14 14 M14 6 L6 14" />
              </g>
            </g>
          );
        })}

        {/* the last card claims another of the plan's zones */}
        <g
          ref={addZoneCard}
          className={`ds-sb-add${addZoneOpen ? " on" : ""}`}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={addZoneOpen}
          onClick={(e) => {
            e.stopPropagation();
            onAddZone();
          }}
          onKeyDown={pressKeys(onAddZone)}
        >
          <rect x={addBox.x} y={addBox.y} width={addBox.w} height={addBox.h} rx={10} />
          <text x={addBox.x + addBox.w / 2} y={addBox.y + addBox.h / 2 + 5} textAnchor="middle">
            Add zone
          </text>
        </g>
      </svg>

      {addZoneOpen && (
        <div
          ref={addZoneBox}
          className="ds-sb-addzone"
          role="dialog"
          aria-label="Add zone"
          style={{ left: addBox.x, top: addBox.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {toAdd.length === 0 && <p className="ds-sb-addzone-none">Every zone on the plan is on this system.</p>}
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

  return (
    <div className="ds-sb-pane">
      <div className="ds-sb-detail-head">
        <h3 className="ds-sb-pane-title">{alloc.model}</h3>
        <span className="ds-sb-spring" />
        <button className="ds-sb-x" onClick={onClose} aria-label="Close unit detail">
          <Icon name="x" size={16} />
        </button>
      </div>
      <p className="ds-sb-facts">
        {alloc.serves === "system" ? "Whole system" : zone ? zone.name : "No zone"}, {sys.name}
      </p>
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
      <button
        className="ds-sb-btn"
        onClick={() => {
          onChange(removeAllocation(draft, sys.id, alloc.id, pack));
          onClose();
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
    </div>
  );
}
