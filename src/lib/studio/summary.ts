/* Design Studio — Summary derivations. Pure functions, zero deps, same
   discipline as loads.ts/materials.ts: the Summary screen renders, never
   computes, so everything it shows is derived here where jest can reach it.

   Grows with the summary redesign: Stage 1 ships the design-basis line (the
   climate/building/sizing settings, read-only — they're EDITED in the studio
   menu, because they re-load every room in the engine); later stages add the
   design snapshot and the per-floor rooms & loads tables. */

import type { DesignDocument, DesignSettings, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import {
  CLIMATE_ZONES,
  DEFAULT_CLIMATE_ZONE,
  sizingCapacityKw,
  type BuildingType,
  type SizingBasis,
} from "./loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "./loads-room";
import { roomCoverage, type CoverageStatus } from "./coverage";
import { buildSystemGraph, totalPipeLengthM } from "./graph";
import { systemComponents } from "./components";
import { describeUnit } from "./materials";

/** The zone number the engine actually uses — settings store a stringified
    zone ("5") or null; anything unparsable falls back like loads-room.ts.
    Settings-scoped (not doc) so the studio menu's selects share it. */
export function effectiveClimateZone(settings: DesignSettings): number {
  const z = parseInt(settings.climateZone ?? "", 10);
  return Number.isFinite(z) && CLIMATE_ZONES[z] ? z : DEFAULT_CLIMATE_ZONE;
}

export function effectiveBuildingType(settings: DesignSettings): BuildingType {
  const t = settings.buildingType;
  return t === "light_commercial" || t === "commercial" ? t : "residential";
}

const BUILDING_LABELS: Record<BuildingType, string> = {
  residential: "Residential",
  light_commercial: "Light commercial",
  commercial: "Commercial",
};

const BASIS_LABELS: Record<SizingBasis, string> = {
  cooling: "Sized on cooling",
  heating: "Sized on heating",
  "worst-of-both": "Sized on worst of both",
};

/* ── Design basis — what the loads were computed FROM, for the summary chips
      and the printed pack header. One object so screen and print agree. ── */
export interface DesignBasis {
  zone: number;
  /** full table label, e.g. "Zone 5 — Warm temperate" */
  zoneLabel: string;
  /** first listed city, e.g. "Sydney" — enough to anchor the zone */
  zoneCity: string;
  buildingType: BuildingType;
  buildingLabel: string;
  basis: SizingBasis;
  basisLabel: string;
}

export function designBasis(doc: DesignDocument): DesignBasis {
  const zone = effectiveClimateZone(doc.settings);
  const info = CLIMATE_ZONES[zone];
  const buildingType = effectiveBuildingType(doc.settings);
  return {
    zone,
    zoneLabel: info.label,
    zoneCity: info.cities.split(",")[0].trim(),
    buildingType,
    buildingLabel: BUILDING_LABELS[buildingType],
    basis: doc.settings.sizingBasis,
    basisLabel: BASIS_LABELS[doc.settings.sizingBasis],
  };
}

const isRoom = (o: DesignDocument["objects"][number]): o is RoomObj =>
  o.type === "room" && o.geometry.kind === "polygon";

/* ── Design snapshot — the stat strip. Areas/loads sum what's measurable
      (uncalibrated floors have no scale → no area); the unmeasured count is
      surfaced so a partial total never reads as the whole job. ── */
export interface DesignSnapshot {
  floorCount: number;
  roomCount: number;
  /** summed area of the measurable rooms; null when none are measurable */
  areaM2: number | null;
  /** summed design load of the measurable rooms; null when none */
  totalLoadKw: number | null;
  /** rooms on uncalibrated floors — excluded from the totals above */
  unmeasuredRoomCount: number;
  uncalibratedFloorCount: number;
  systemCount: number;
  iduCount: number;
  oduCount: number;
}

export function buildDesignSnapshot(doc: DesignDocument): DesignSnapshot {
  let roomCount = 0;
  let unmeasured = 0;
  let area: number | null = null;
  let load: number | null = null;
  for (const o of doc.objects) {
    if (!isRoom(o)) continue;
    roomCount++;
    const a = roomAreaM2(doc, o);
    const l = roomLoadKw(doc, o);
    if (a == null || l == null) {
      unmeasured++;
      continue;
    }
    area = (area ?? 0) + a;
    load = (load ?? 0) + l;
  }
  let idu = 0;
  let odu = 0;
  for (const o of doc.objects) {
    if (o.type !== "unit") continue;
    if (o.props.role === "idu") idu++;
    else if (o.props.role === "odu") odu++;
  }
  return {
    floorCount: doc.floors.length,
    roomCount,
    areaM2: area == null ? null : Math.round(area * 10) / 10,
    totalLoadKw: load == null ? null : Math.round(load * 10) / 10,
    unmeasuredRoomCount: unmeasured,
    uncalibratedFloorCount: doc.floors.filter((f) => f.scaleMmPerUnit == null)
      .length,
    systemCount: doc.systems.length,
    iduCount: idu,
    oduCount: odu,
  };
}

/* ── Rooms & loads — one table row per room, grouped by floor, with the
      units serving it (coverage contributors, so multi/VRF attribute their
      per-room IDUs and splits their pair). ── */
export interface RoomRow {
  roomId: string;
  name: string;
  areaM2: number | null;
  loadKw: number | null;
  serving: { model: string; systemName: string; colour: string }[];
}

export interface FloorRooms {
  floorId: string;
  name: string;
  level: number;
  calibrated: boolean;
  rooms: RoomRow[];
}

export function roomsByFloor(
  doc: DesignDocument,
  pack: DataPack | null
): FloorRooms[] {
  const out: FloorRooms[] = [];
  for (const floor of doc.floors) {
    const rooms: RoomRow[] = [];
    for (const o of doc.objects) {
      if (o.floorId !== floor.id || !isRoom(o)) continue;
      const cov = roomCoverage(doc, pack, o, doc.settings.sizingBasis);
      rooms.push({
        roomId: o.id,
        name: String(o.props.name ?? "Room"),
        areaM2: roomAreaM2(doc, o),
        loadKw: roomLoadKw(doc, o),
        serving: cov.contributors.map((c) => ({
          model: c.model,
          systemName: c.systemName,
          colour: c.colour,
        })),
      });
    }
    out.push({
      floorId: floor.id,
      name: floor.name,
      level: floor.level,
      calibrated: floor.scaleMmPerUnit != null,
      rooms,
    });
  }
  return out;
}

/* ── Per-system summary — the shape the redesigned sheet renders ──
      The room is the unit of the sheet, because that is how the document
      stores it: an indoor unit carries `props.roomId`, while the outdoor
      unit, the pipe run and the components belong to the system. So each
      system reports the rooms it serves (each with its own capacity and
      coverage) plus the things those rooms SHARE.

      Same discipline as everything above: the view renders, never computes. */

export interface SummaryRoomRow {
  roomId: string;
  name: string;
  /** floor display name, e.g. "Ground" */
  level: string;
  areaM2: number | null;
  loadKw: number | null;
  /** placed capacity attributed to this room; null when nothing serves it */
  capacityKw: number | null;
  /** covered/load percent, null when either is unknown */
  pct: number | null;
  status: CoverageStatus;
  /** the indoor unit in THIS room (multi/VRF give one per room) */
  indoorModel: string | null;
}

/** One takeoff line — a pipe coil, a component choice, a refrigerant top-up.
    Never a unit: units live in the rooms table (indoors) and the outdoor
    block, and repeating them here would double-handle the sheet. */
export interface SheetLine {
  /** what it is, e.g. "ø6.35 / ø9.52 pair coil", "Isolator · 20 A" */
  name: string;
  /** qualifier, e.g. "liquid / gas mm", "Weatherproof IP66" */
  sub: string;
  /** the takeoff quantity as shown, e.g. "18 m", "1 set", "820 g", "—" */
  qty: string;
}

export interface SummarySystem {
  systemId: string;
  name: string;
  colour: string;
  type: DesignSystem["type"];
  /** what the system IS, e.g. "Multi-split · 4 heads on one outdoor" */
  kindLabel: string;
  /** the brand's display name from the pack, never the slug */
  brandLabel: string;
  /** indoor form factor, e.g. "cassette-4way" → "Cassette (4 way)" */
  styleLabel: string | null;
  outdoorModel: string | null;
  /** the outdoor machine's own sizing capacity — NOT the summed placed
      capacity below; this is what the nameplate says, that is the verdict */
  outdoorCapacityKw: number | null;
  /** true when more than one room shares the outdoor — multi and VRF */
  sharedOutdoor: boolean;
  pipeLiquidMm: number | null;
  pipeGasMm: number | null;
  refrigerant: string | null;
  prechargedKg: number | null;
  totalPipeM: number | null;
  rooms: SummaryRoomRow[];
  /** summed load of the rooms it serves */
  loadKw: number | null;
  /** summed placed capacity */
  capacityKw: number | null;
  pct: number | null;
  status: CoverageStatus;
  /** the system's consumables/accessories takeoff — see SheetLine */
  lines: SheetLine[];
}

/** One Material picklist row — the combined pick for the whole job. */
export interface PicklistRow {
  name: string;
  sub: string;
  qty: string;
}

export interface SummaryModel {
  systems: SummarySystem[];
  /** rooms no system serves — the gap in the design, stated plainly */
  unserved: SummaryRoomRow[];
  /** the whole job's combined pick: units for EVERY system type (the split-
      only materials schedule under-counted a multi), pipe summed by size,
      components summed where countable, refrigerant top-ups per system.
      "Supplied by others" rows are excluded — not in this takeoff is not
      in this pick. */
  picklist: PicklistRow[];
}

const FORM_LABELS: Record<string, string> = {
  "cassette-4way": "Cassette (4 way)",
  "cassette-1way": "Cassette (1 way)",
  ducted: "Ducted",
  "under-ceiling": "Under ceiling",
  wall: "Wall mounted",
  "floor-console": "Floor console",
  "floor-concealed": "Floor concealed",
};

/** "Cassette (4 way)" for a known form factor; the raw value otherwise, so a
    new one in a future pack shows up rather than vanishing. */
export function formFactorLabel(form: string | null | undefined): string | null {
  if (!form) return null;
  return FORM_LABELS[form] ?? form;
}

/* `satisfies`, not `Record<SystemType, …>` as an annotation — the annotation
   widens keyof and a typo'd lookup would type-check into the fallback. */
const KIND_BASE = {
  split: "Split",
  "multi-split": "Multi-split",
  ducted: "Ducted",
  vrf: "VRF",
  ventilation: "Ventilation",
  "sheet-metal": "Sheet metal",
} satisfies Record<DesignSystem["type"], string>;

/** "Multi-split · 4 heads on one outdoor" — the head count is stated only
    when the outdoor is genuinely shared, which is what the count is FOR. */
export function systemKindLabel(
  type: DesignSystem["type"],
  headCount: number
): string {
  const base = KIND_BASE[type];
  return headCount > 1 && (type === "multi-split" || type === "vrf")
    ? `${base} · ${headCount} heads on one outdoor`
    : base;
}

/** "1", "1 set", "18 m" → the number and its unit, separately — so counts
    can be summed across systems without parsing display text twice. */
const parseQty = (q: string): { n: number; unit: string } | null => {
  const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(q.trim());
  return m ? { n: Number(m[1]), unit: m[2] } : null;
};

export function buildSummaryModel(
  doc: DesignDocument,
  pack: DataPack | null
): SummaryModel {
  const floorName = new Map(
    doc.floors.map((f) => [f.id, f.name || `Level ${f.level}`])
  );
  const basis = doc.settings.sizingBasis;

  /* one pass over the rooms: who serves them, and how well */
  const rows = new Map<string, SummaryRoomRow & { systemIds: string[] }>();
  for (const o of doc.objects) {
    if (!isRoom(o)) continue;
    const cov = roomCoverage(doc, pack, o, basis);
    const first = cov.contributors[0] ?? null;
    rows.set(o.id, {
      roomId: o.id,
      name: String(o.props.name ?? "Room"),
      level: floorName.get(o.floorId) ?? "",
      areaM2: roomAreaM2(doc, o),
      loadKw: cov.loadKw,
      capacityKw: cov.contributors.length ? cov.coveredKw : null,
      pct: cov.pct,
      status: cov.status,
      indoorModel: first ? first.model : null,
      systemIds: [...new Set(cov.contributors.map((c) => c.systemId))],
    });
  }

  const strip = ({
    systemIds: _ignored,
    ...row
  }: SummaryRoomRow & { systemIds: string[] }): SummaryRoomRow => row;

  const systems: SummarySystem[] = doc.systems.map((sys) => {
    const mine = [...rows.values()].filter((r) => r.systemIds.includes(sys.id));
    const odu = doc.objects.find(
      (o) =>
        o.systemId === sys.id && o.type === "unit" && o.props.role === "odu"
    );
    const outdoorModel = odu ? String(odu.props.model ?? "") || null : null;
    const oduRow = outdoorModel
      ? pack?.outdoor_units.find((u) => u.model === outdoorModel) ?? null
      : null;
    const iduModel = mine.find((r) => r.indoorModel)?.indoorModel ?? null;
    const iduRow = iduModel
      ? pack?.indoor_units.find((u) => u.model === iduModel) ?? null
      : null;

    const load = mine.reduce<number | null>(
      (a, r) => (r.loadKw == null ? a : (a ?? 0) + r.loadKw),
      null
    );
    const cap = mine.reduce<number | null>(
      (a, r) => (r.capacityKw == null ? a : (a ?? 0) + r.capacityKw),
      null
    );
    const pct =
      load != null && load > 0 && cap != null
        ? Math.round((cap / load) * 100)
        : null;

    const compRows = systemComponents(doc, pack, sys, basis);
    const chargeRow = compRows.find((c) => c.kind === "charge") ?? null;
    const topupKg = chargeRow?.charge?.topupKg ?? null;

    const pipeLiquidMm = oduRow?.conn_liquid_mm ?? null;
    const pipeGasMm = oduRow?.conn_gas_mm ?? null;
    /* ROUNDED HERE, once. The graph returns the raw drawn length — a real run
       measured 3.1494563728466076 m — and the model must expose ONE canonical
       figure or the sheet prints the same pipe two ways: the picklist rounded
       it while the system's own materials line interpolated the float, both
       visible on one page. Same discipline as the old materials.ts, which
       rounded at exactly this point. */
    const rawPipeM = totalPipeLengthM(
      buildSystemGraph(doc.objects, doc.floors, sys.id)
    );
    const totalPipeM = rawPipeM == null ? null : Math.round(rawPipeM * 10) / 10;
    const hasRuns = doc.objects.some(
      (o) => o.systemId === sys.id && o.type === "pipe-run"
    );

    /* the takeoff: pipe, then the component choices, then any top-up. Units
       are NOT lines — indoors live in the rooms table, the outdoor in its
       block; a unit repeated here would double-handle the sheet. */
    const lines: SheetLine[] = [
      ...(totalPipeM != null && totalPipeM > 0 && pipeLiquidMm != null && pipeGasMm != null
        ? [
            {
              name: `ø${pipeLiquidMm} / ø${pipeGasMm} pair coil`,
              sub: "liquid / gas mm",
              qty: `${totalPipeM} m`,
            },
          ]
        : hasRuns
          ? [
              /* a drawn run the sheet can't measure is stated, not omitted —
                 silence would read as "no pipe on this job" */
              {
                name: "Pair coil",
                sub: "run drawn — calibrate the floor to quantify",
                qty: "—",
              },
            ]
          : []),
      ...compRows
        .filter((c) => c.kind === "choice")
        .map((c) => ({ name: c.name, sub: c.sub ?? "", qty: c.value })),
      ...(topupKg != null && topupKg > 0
        ? [
            {
              name: "Additional refrigerant",
              sub: "beyond pre-charge",
              qty: `${Math.round(topupKg * 1000)} g`,
            },
          ]
        : []),
    ];

    return {
      systemId: sys.id,
      name: sys.name,
      colour: sys.colour,
      type: sys.type,
      kindLabel: systemKindLabel(sys.type, mine.length),
      brandLabel:
        pack?.brands.find((b) => b.id === sys.brand)?.name ?? sys.brand,
      styleLabel: formFactorLabel(iduRow?.form_factor),
      outdoorModel,
      outdoorCapacityKw: oduRow ? sizingCapacityKw(oduRow, basis) : null,
      /* the outdoor is SHARED when more than one room hangs off it — that is
         what makes a multi read as three heads rather than one unit doing
         three rooms */
      sharedOutdoor: mine.length > 1,
      pipeLiquidMm,
      pipeGasMm,
      refrigerant: oduRow?.refrigerant ?? null,
      prechargedKg: oduRow?.precharged_kg ?? null,
      totalPipeM,
      rooms: mine.map(strip),
      loadKw: load == null ? null : Math.round(load * 10) / 10,
      capacityKw: cap == null ? null : Math.round(cap * 10) / 10,
      pct,
      status: load == null ? "unknown" : pct != null && pct >= 100 ? "covered" : "under",
      lines,
    };
  });

  return {
    systems,
    unserved: [...rows.values()]
      .filter((r) => r.systemIds.length === 0)
      .map(strip),
    picklist: buildPicklist(doc, pack, systems),
  };
}

/* ── the Material picklist — the whole job's combined pick ──
      Units are counted from what is PLACED, for every system type: the
      materials schedule is still split-only, and the old print rollup fed
      from it silently omitted a multi's units. Pipe sums by size; countable
      components sum by name; a refrigerant top-up stays per system (you pick
      a bottle against a system, not a job-wide sum of grams). */
function buildPicklist(
  doc: DesignDocument,
  pack: DataPack | null,
  systems: SummarySystem[]
): PicklistRow[] {
  // units, whole job, counted from the placed objects
  const unitCounts = new Map<string, number>();
  for (const o of doc.objects) {
    if (o.type !== "unit") continue;
    const m = String(o.props.model ?? "");
    if (m) unitCounts.set(m, (unitCounts.get(m) ?? 0) + 1);
  }
  const units: PicklistRow[] = [...unitCounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, qty]) => ({
      name: model,
      sub: pack ? describeUnit(pack, model) : "unit",
      qty: String(qty),
    }));

  // pipe, summed by size pair
  const pipe = new Map<string, { name: string; m: number }>();
  for (const s of systems) {
    if (s.totalPipeM == null || s.totalPipeM <= 0) continue;
    if (s.pipeLiquidMm == null || s.pipeGasMm == null) continue;
    const key = `${s.pipeLiquidMm}/${s.pipeGasMm}`;
    const cur = pipe.get(key);
    if (cur) cur.m += s.totalPipeM;
    else
      pipe.set(key, {
        name: `ø${s.pipeLiquidMm} / ø${s.pipeGasMm} pair coil`,
        m: s.totalPipeM,
      });
  }
  const pipes: PicklistRow[] = [...pipe.values()].map((p) => ({
    name: p.name,
    sub: "liquid / gas mm",
    qty: `${Math.round(p.m * 10) / 10} m`,
  }));

  /* components summed by name where the quantity counts; "—" rows excluded —
     "not in this takeoff" is not in this pick. An unparseable quantity keeps
     its own row rather than silently dropping. */
  const comps = new Map<string, { name: string; sub: string; n: number; unit: string }>();
  const oddComps: PicklistRow[] = [];
  const topups: PicklistRow[] = [];
  for (const s of systems) {
    for (const l of s.lines) {
      if (l.qty === "—" || l.name.endsWith("pair coil") || l.name === "Pair coil")
        continue;
      if (l.name === "Additional refrigerant") {
        topups.push({ name: l.name, sub: `${s.name} · ${l.sub}`, qty: l.qty });
        continue;
      }
      const parsed = parseQty(l.qty);
      if (!parsed) {
        oddComps.push({ name: l.name, sub: l.sub, qty: l.qty });
        continue;
      }
      const key = `${l.name}|${parsed.unit}`;
      const cur = comps.get(key);
      if (cur) cur.n += parsed.n;
      else comps.set(key, { name: l.name, sub: l.sub, n: parsed.n, unit: parsed.unit });
    }
  }
  const summed: PicklistRow[] = [...comps.values()].map((c) => ({
    name: c.name,
    sub: c.sub,
    qty: c.unit ? `${c.n} ${c.unit}` : String(c.n),
  }));

  return [...units, ...pipes, ...summed, ...oddComps, ...topups];
}
