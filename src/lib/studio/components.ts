/* Design Studio — system Components rows (Stage 4, cockpit panel).
   A pure derivation: (document, dataPack, system, basis) → the list of
   system-level parts shown on the cockpit's "Components" tab. Two kinds of row:

   - DERIVED (odu, charge) — read straight from the pack + the takeoff engines
     (systemPairKw, the additional-charge evaluator, the pipe graph). Nothing is
     invented; when the data isn't there the row degrades to "—".
   - CHOICE (electrical, mounting) — the ME pack has no isolator-rating or
     bracket data, so these are picked from a small static catalogue and stored
     on `system.settings.components` (choiceKey → optionId). Defaults stand in
     until the user overrides; the isolator's is sized to the outdoor's own
     draw and supply. When the pack later grows real fields these turn back
     into derived rows without reshaping this contract.

   Rows appear only once a pairing resolves (placed models, else the chosen
   pair) — before that the Components tab is empty, matching the room flow. */

import type { DesignDocument, DesignSystem } from "./document";
import type { AdditionalChargeRule, DataPack, OutdoorUnit, Phase } from "./packs/schema";
import { buildSystemGraph, totalPipeLengthM } from "./graph";
import { systemPairKw } from "./coverage";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { evaluateAdditionalCharge } from "./materials";
import { moduleFor } from "./modules";

/* ─────────────────────────── row shapes ─────────────────────────── */

/** icon key → the cockpit maps this to an inline glyph */
export type ComponentIcon =
  | "odu"
  | "droplet"
  | "bolt"
  | "mount"
  | "branch"
  | "controller"
  | "insulation";

export interface ComponentChoiceOption {
  id: string;
  name: string;
  sub?: string;
  /** the takeoff value shown on the right (e.g. "1 set", "—") */
  value: string;
}

/** an isolator on the takeoff: its rating and the supply it breaks */
export interface IsolatorOption extends ComponentChoiceOption {
  isolator: { amps: number; phase: Phase };
}

export interface ComponentChoiceGroup {
  key: "electrical" | "mounting" | "insulation";
  role: string;
  icon: ComponentIcon;
  /** the option a system gets until somebody picks one — fixed, or read off
      the system's outdoor where the pack can size it */
  defaultId: string | ((odu: OutdoorUnit) => string);
  options: ComponentChoiceOption[];
}

export interface ComponentRow {
  /** stable React key + choice-group key for choice rows */
  id: string;
  kind: "odu" | "charge" | "choice";
  role: string;
  name: string;
  sub?: string;
  value: string;
  icon: ComponentIcon;
  /** present on choice rows: the picker state for inline expansion */
  choice?: {
    key: ComponentChoiceGroup["key"];
    selectedId: string;
    options: ComponentChoiceOption[];
  };
  /** present on the charge row: the numbers behind the formatted value, so
      the summary sheet can decide (top-up > 0 → a picklist line) without
      parsing display text */
  charge?: { prechargeKg: number | null; topupKg: number | null };
}

/* ─────────────────────────── choice catalogue ───────────────────────────
   Static, brand-agnostic defaults. No pack data backs these yet (isolator
   ratings and outdoor brackets aren't in the ME pack), so they are sensible
   placeholders the installer can adjust — persisted per system. The isolator
   is the one the pack can still size, off its outdoor's max running current
   and supply: see defaultIsolatorId. */

/* Standard ratings, enough for every draw in the shipped pack (a test holds
   that). The supply is in the NAME, not the sub: the picklist sums a
   component by name and the job card files it by name, so a 1Ø and a 3Ø
   isolator under one name would be picked as two of whichever came first. */
const ISOLATORS: IsolatorOption[] = [
  { id: "isolator-20a-1ph", name: "Isolator, 1Ø 20 A", sub: "Weatherproof IP66", value: "1", isolator: { amps: 20, phase: "1" } },
  { id: "isolator-32a-1ph", name: "Isolator, 1Ø 32 A", sub: "Weatherproof IP66", value: "1", isolator: { amps: 32, phase: "1" } },
  { id: "isolator-20a-3ph", name: "Isolator, 3Ø 20 A", sub: "Weatherproof IP66", value: "1", isolator: { amps: 20, phase: "3" } },
  { id: "isolator-32a-3ph", name: "Isolator, 3Ø 32 A", sub: "Weatherproof IP66", value: "1", isolator: { amps: 32, phase: "3" } },
];

export const COMPONENT_CHOICES: ComponentChoiceGroup[] = [
  {
    key: "electrical",
    role: "Electrical",
    icon: "bolt",
    defaultId: defaultIsolatorId,
    options: [
      ...ISOLATORS,
      { id: "none", name: "Supplied by others", sub: "Not in this takeoff", value: "—" },
    ],
  },
  {
    key: "mounting",
    role: "Mounting",
    icon: "mount",
    defaultId: "wall-bracket",
    options: [
      { id: "wall-bracket", name: "Wall bracket", sub: "Galv. steel, anti-vib feet", value: "1 set" },
      { id: "ground-pad", name: "Ground pad", sub: "Composite, anti-vib feet", value: "1" },
      { id: "roof-mount", name: "Roof frame", sub: "Galv. steel, spring feet", value: "1 set" },
    ],
  },
  /* Hard-drawn pipe arrives as raw copper — soft coil comes pre-insulated —
     so lagging is a real line on the takeoff whenever a hard run is drawn.
     The row's VALUE is derived (the system's hard-drawn length), not the
     static "—" here; see choiceRows. Walls are the stocked standards. */
  {
    key: "insulation",
    role: "Pipe insulation",
    icon: "insulation",
    defaultId: "wall-13",
    options: [
      { id: "wall-9", name: "Lagging, 9 mm wall", sub: "Closed-cell, hard drawn runs", value: "—" },
      { id: "wall-13", name: "Lagging, 13 mm wall", sub: "Closed-cell, hard drawn runs", value: "—" },
      { id: "wall-19", name: "Lagging, 19 mm wall", sub: "Closed-cell, hard drawn runs", value: "—" },
      { id: "none", name: "Supplied by others", sub: "Not in this takeoff", value: "—" },
    ],
  },
];

/** the supply as the outdoor row labels it: anything not three phase is single */
const supplyOf = (odu: OutdoorUnit): Phase => (odu.phase === "3" ? "3" : "1");

/** The isolator a system gets until somebody picks one: the smallest rating
    at or above the outdoor's max running current, on the outdoor's own
    supply. A draw the pack doesn't carry, or one past every rating here,
    keeps the 20 A this catalogue has always started on: a size is read off
    the pack, never guessed. */
export function defaultIsolatorId(odu: OutdoorUnit): string {
  const supply = supplyOf(odu);
  const draw = odu.max_amps_a;
  const sized =
    typeof draw === "number" && Number.isFinite(draw) && draw > 0
      ? ISOLATORS.filter((o) => o.isolator.phase === supply)
          .sort((a, b) => a.isolator.amps - b.isolator.amps)
          .find((o) => o.isolator.amps >= draw)
      : undefined;
  return sized?.id ?? `isolator-20a-${supply}ph`;
}

/** Ids an older catalogue stored, read as the option each still means. The
    document is never rewritten, so a hand-picked isolator stays the one that
    was picked: the 32 A was labelled 3Ø, and the 20 A named no supply, so its
    rating is what was picked and the supply is the outdoor's. */
function currentIsolatorId(id: string, odu: OutdoorUnit): string {
  if (id === "isolator-32a") return "isolator-32a-3ph";
  if (id === "isolator-20a") return `isolator-20a-${supplyOf(odu)}ph`;
  return id;
}

/** the effective choice selection for a system: persisted overrides ∪
    defaults. A pick stands whatever the outdoor draws; only a group nobody
    has picked for takes the default. */
export function componentChoices(system: DesignSystem, odu: OutdoorUnit): Record<string, string> {
  const stored =
    system.settings.components && typeof system.settings.components === "object"
      ? (system.settings.components as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const g of COMPONENT_CHOICES) {
    const v = stored[g.key];
    const id = typeof v === "string" && g.key === "electrical" ? currentIsolatorId(v, odu) : v;
    const valid = typeof id === "string" && g.options.some((o) => o.id === id);
    out[g.key] = valid
      ? (id as string)
      : typeof g.defaultId === "function"
        ? g.defaultId(odu)
        : g.defaultId;
  }
  return out;
}

/* ─────────────────────────── derivation ─────────────────────────── */

/** the pairing that anchors the components: placed unit models win, else the
    chosen pair on settings. Returns null until BOTH sides resolve. */
function resolvePair(
  doc: DesignDocument,
  system: DesignSystem
): { iduModel: string; oduModel: string } | null {
  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
  const iduModel = String(
    mine.find((o) => o.props.role === "idu")?.props.model ?? system.settings.pairIdu ?? ""
  );
  const oduModel = String(
    mine.find((o) => o.props.role === "odu")?.props.model ?? system.settings.pairOdu ?? ""
  );
  if (!iduModel || !oduModel) return null;
  return { iduModel, oduModel };
}

/** Refrigerant line sizes for the system's resolved pairing — what a drawn
    run autosizes to (pipe-run props override per run; blank = these). Null
    until a pairing resolves or when the pack has no row for it. */
export function pairPipeSizes(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem
): { liquidMm: number; gasMm: number } | null {
  if (!pack) return null;
  const pair = resolvePair(doc, system);
  if (!pair) return null;
  const row = pack.pair_tables.find(
    (p) => p.idu_model === pair.iduModel && p.odu_model === pair.oduModel
  );
  if (!row) return null;
  return { liquidMm: row.pipe_liquid_mm, gasMm: row.pipe_gas_mm };
}

const phaseLabel = (odu: OutdoorUnit): string => (odu.phase === "3" ? "3Ø" : "1Ø");

function oduRow(
  doc: DesignDocument,
  pack: DataPack,
  system: DesignSystem,
  basis: SizingBasis,
  odu: OutdoorUnit
): ComponentRow {
  const kw = systemPairKw(doc, pack, system.id, basis) ?? sizingCapacityKw(odu, basis);
  return {
    id: "odu",
    kind: "odu",
    role: "Outdoor unit",
    name: odu.model,
    sub: `${phaseLabel(odu)}, ${odu.refrigerant} condenser`,
    value: kw != null ? `${kw.toFixed(1)} kW` : "—",
    icon: "odu",
  };
}

function chargeRow(
  doc: DesignDocument,
  system: DesignSystem,
  odu: OutdoorUnit,
  /** the applicable charge rule — pair_tables for split/ducted, multi_rules
      for a shared multi outdoor; null degrades to "factory pre-charged" */
  charge: AdditionalChargeRule | null,
  /** liquid size the rule keys off (per-port multi sizes vary → null) */
  liquidSizeMm: number | null
): ComponentRow {
  const hasRuns = doc.objects.some(
    (o) => o.systemId === system.id && o.type === "pipe-run"
  );
  const lengthM = totalPipeLengthM(buildSystemGraph(doc.objects, doc.floors, system.id));

  const precharge = odu.precharged_kg ?? null;
  let topupKg: number | null = null;
  if (charge) {
    const grams = evaluateAdditionalCharge(charge, {
      liquidLengthM: lengthM ?? 0,
      ...(liquidSizeMm != null ? { liquidSizeMm } : {}),
    });
    topupKg = grams == null ? null : grams / 1000;
  }

  // value: prefer a full charge total; else the top-up alone; else unknown
  const totalKg = precharge != null ? precharge + (topupKg ?? 0) : null;
  const value =
    totalKg != null
      ? `${totalKg.toFixed(2)} kg`
      : topupKg != null && topupKg > 0
        ? `+${topupKg.toFixed(2)} kg`
        : "—";

  // sub: describe the pre-charge / top-up situation honestly
  let sub: string;
  if (charge && hasRuns && lengthM == null) {
    sub = "Pre-charged, run length unknown";
  } else if (topupKg != null && topupKg > 0) {
    sub = `Pre-charged + ${topupKg.toFixed(2)} kg top-up`;
  } else if (topupKg === 0) {
    sub = "Pre-charged — no top-up";
  } else {
    sub = "Factory pre-charged";
  }

  return {
    id: "charge",
    kind: "charge",
    role: "Refrigerant charge",
    name: odu.refrigerant,
    sub,
    value,
    icon: "droplet",
    charge: { prechargeKg: precharge, topupKg },
  };
}

/** Metres of raw copper: the system's connected hard-drawn pipe (graph edges,
    same population as the sheet's pair-coil line) minus nothing — soft-drawn
    runs are skipped because the coil arrives pre-insulated. Riser verticals
    count: they are hard pipe. Null while a run crosses an uncalibrated floor. */
function hardDrawnLengthM(doc: DesignDocument, system: DesignSystem): number | null {
  const graph = buildSystemGraph(doc.objects, doc.floors, system.id);
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  let total = 0;
  for (const e of graph.edges) {
    const o = byId.get(e.id);
    if (o?.type === "pipe-run" && o.props.form === "soft") continue;
    if (e.lengthM == null) return null;
    total += e.lengthM;
  }
  return Math.round(total * 10) / 10;
}

const isIsolator = (o: ComponentChoiceOption): o is IsolatorOption => "isolator" in o;

/** What the picker offers: an isolator only on the outdoor's own supply —
    one on the other supply is never the right part. The option already
    picked stays listed whatever its supply, so a pick that stands still
    shows as the one chosen. */
function pickable(
  g: ComponentChoiceGroup,
  odu: OutdoorUnit,
  selectedId: string
): ComponentChoiceOption[] {
  const supply = supplyOf(odu);
  return g.options.filter(
    (o) => !isIsolator(o) || o.isolator.phase === supply || o.id === selectedId
  );
}

function choiceRows(doc: DesignDocument, system: DesignSystem, odu: OutdoorUnit): ComponentRow[] {
  const selected = componentChoices(system, odu);
  return COMPONENT_CHOICES.map((g) => {
    const selectedId = selected[g.key];
    // componentChoices only hands back ids from the group's own options
    const opt = g.options.find((o) => o.id === selectedId)!;
    // insulation's takeoff value is derived: metres of hard-drawn copper
    let value = opt.value;
    if (g.key === "insulation" && selectedId !== "none") {
      const m = hardDrawnLengthM(doc, system);
      value = m != null && m > 0 ? `${m} m` : "—";
    }
    return {
      id: g.key,
      kind: "choice" as const,
      role: g.role,
      name: opt.name,
      sub: opt.sub,
      value,
      icon: g.icon,
      choice: { key: g.key, selectedId, options: pickable(g, odu, selectedId) },
    };
  });
}

/** The system-level component list for the cockpit's Components tab. Empty
    until a pairing resolves; then ODU + refrigerant charge (derived) followed
    by the electrical + mounting choice rows. Per-room modules (multi / VRF)
    anchor on the shared outdoor alone — there is no single pairing — and take
    their charge rule from multi_rules. */
export function systemComponents(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem,
  basis: SizingBasis
): ComponentRow[] {
  if (!pack) return [];

  if (moduleFor(system.type).unitFlow === "per-room") {
    const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
    const oduModel = String(
      mine.find((o) => o.props.role === "odu")?.props.model ?? system.settings.pairOdu ?? ""
    );
    if (!oduModel) return [];
    const odu = pack.outdoor_units.find((o) => o.model === oduModel) ?? null;
    if (!odu) return [];
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model) ?? null;
    return [
      oduRow(doc, pack, system, basis, odu),
      chargeRow(doc, system, odu, rule?.additional_charge ?? null, null),
      ...choiceRows(doc, system, odu),
    ];
  }

  const resolved = resolvePair(doc, system);
  if (!resolved) return [];

  const odu = pack.outdoor_units.find((o) => o.model === resolved.oduModel) ?? null;
  if (!odu) return [];

  const pair =
    pack.pair_tables.find(
      (p) => p.idu_model === resolved.iduModel && p.odu_model === resolved.oduModel
    ) ?? null;

  return [
    oduRow(doc, pack, system, basis, odu),
    chargeRow(doc, system, odu, pair?.additional_charge ?? null, pair?.pipe_liquid_mm ?? null),
    ...choiceRows(doc, system, odu),
  ];
}
