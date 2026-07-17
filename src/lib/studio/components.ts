/* Design Studio — system Components rows (Stage 4, cockpit panel).
   A pure derivation: (document, dataPack, system, basis) → the list of
   system-level parts shown on the cockpit's "Components" tab. Every row is
   DERIVED from the pack + the takeoff engines; two of them additionally accept
   a persisted OVERRIDE:

   - odu, charge — read straight from the pack + engines (systemPairKw, the
     additional-charge evaluator, the pipe graph). Nothing is invented; when the
     data isn't there the row degrades to "—".
   - electrical, mounting — a DERIVED default the installer can still override.
     The default comes from real pack data: the ODU's recommended breaker
     (OutdoorUnit.breaker_a / mca_a) sizes the isolator, and the ODU's form
     (weight/height) picks a compatible outdoor-mount accessory (wall vs
     ground). The override is a per-system pick stored on
     `system.settings.components` (choiceKey → optionId). When the pack lacks the
     data a row degrades to "—" rather than inventing a value — the same
     contract the odu/charge rows use.

   Rows appear only once a pairing resolves (placed models, else the chosen
   pair) — before that the Components tab is empty, matching the room flow. */

import type { DesignDocument, DesignSystem } from "./document";
import type {
  Accessory,
  AdditionalChargeRule,
  DataPack,
  OutdoorUnit,
  PairTable,
} from "./packs/schema";
import { buildSystemGraph, totalPipeLengthM } from "./graph";
import { systemPairKw } from "./coverage";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { evaluateAdditionalCharge } from "./materials";
import { moduleFor } from "./modules";

/* ─────────────────────────── row shapes ─────────────────────────── */

/** icon key → the cockpit maps this to an inline glyph */
export type ComponentIcon = "odu" | "droplet" | "bolt" | "mount" | "branch" | "controller";

export interface ComponentChoiceOption {
  id: string;
  name: string;
  sub?: string;
  /** the takeoff value shown on the right (e.g. "1 set", "—") */
  value: string;
}

export interface ComponentChoiceGroup {
  key: "electrical" | "mounting";
  role: string;
  icon: ComponentIcon;
  defaultId: string;
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
}

const phaseLabel = (odu: OutdoorUnit): string => (odu.phase === "3" ? "3Ø" : "1Ø");

/* ─────────────── choice groups — derived from pack, override-able ───────────────
   Built per resolved ODU: the default option reflects real pack data, and a
   small set of alternatives lets the installer override. The selected option's
   `id` is what persists on settings.components; an override that no longer fits
   (e.g. after a unit swap) falls back to the derived default. */

/** Electrical: the outdoor isolator is sized to the ODU's recommended breaker
    (MOP). Default = the pack rating; the only override is "supplied by others".
    Degrades to an "—" rating when the ODU carries no `breaker_a`. */
export function electricalGroup(odu: OutdoorUnit): ComponentChoiceGroup {
  const hasRating = typeof odu.breaker_a === "number" && odu.breaker_a > 0;
  const hasMca = typeof odu.mca_a === "number" && odu.mca_a > 0;
  const packOpt: ComponentChoiceOption = hasRating
    ? {
        id: "pack",
        name: `Isolator · ${odu.breaker_a} A`,
        sub: hasMca
          ? `${phaseLabel(odu)} · sized to ${odu.breaker_a} A breaker (MCA ${odu.mca_a} A)`
          : `${phaseLabel(odu)} · sized to ${odu.breaker_a} A breaker`,
        value: "1",
      }
    : {
        id: "pack",
        name: "Isolator",
        sub: `${phaseLabel(odu)} · rating not in pack`,
        value: "—",
      };
  return {
    key: "electrical",
    role: "Electrical",
    icon: "bolt",
    defaultId: "pack",
    options: [
      packOpt,
      { id: "others", name: "Supplied by others", sub: "Not in this takeoff", value: "—" },
    ],
  };
}

type MountKind = "wall" | "ground" | "roof";

const MOUNT_LABEL: Record<MountKind, string> = {
  wall: "Wall bracket",
  ground: "Ground pad",
  roof: "Roof frame",
};

/** classify an outdoor-mount accessory by its model id (OM-WALL-* / -GROUND-* /
    -ROOF-*). Unknown ids keep their model as the label. */
function mountKind(model: string): MountKind | null {
  const m = model.toUpperCase();
  if (m.includes("WALL")) return "wall";
  if (m.includes("GROUND")) return "ground";
  if (m.includes("ROOF")) return "roof";
  return null;
}

/** family-pattern match, mirroring the pack's `compatible_with` convention: a
    trailing "*" is a prefix wildcard, anything else is an exact model. */
function accessoryFitsUnit(a: Accessory, model: string): boolean {
  return a.compatible_with.some((p) =>
    p.endsWith("*") ? model.startsWith(p.slice(0, -1)) : p === model
  );
}

/** Mounting: options are the outdoor-mount accessories the pack marks compatible
    with this ODU; the default reflects the ODU's form — heavy / floor-standing
    → a ground pad, otherwise a wall bracket. Override = any other compatible
    support. Degrades to a single "—" option when the pack ships no outdoor-mount
    accessory for this ODU. */
export function mountingGroup(pack: DataPack, odu: OutdoorUnit): ComponentChoiceGroup {
  const compat = pack.accessories.filter(
    (a) => a.category === "outdoor-mount" && accessoryFitsUnit(a, odu.model)
  );
  const options: ComponentChoiceOption[] = compat.map((a) => {
    const kind = mountKind(a.model);
    return {
      id: a.model,
      name: kind ? MOUNT_LABEL[kind] : a.model,
      sub: a.description,
      value: "1 set",
    };
  });

  const floorStanding =
    (typeof odu.weight_kg === "number" && odu.weight_kg >= 70) ||
    (typeof odu.height_mm === "number" && odu.height_mm >= 1200);
  const preferKind: MountKind = floorStanding ? "ground" : "wall";
  const preferred = compat.find((a) => mountKind(a.model) === preferKind) ?? compat[0];

  if (options.length === 0) {
    options.push({ id: "none", name: "Mounting", sub: "No support in pack", value: "—" });
  }

  return {
    key: "mounting",
    role: "Mounting",
    icon: "mount",
    defaultId: preferred?.model ?? "none",
    options,
  };
}

/** the two choice groups for a resolved ODU, in display order. */
export function componentChoiceGroups(pack: DataPack, odu: OutdoorUnit): ComponentChoiceGroup[] {
  return [electricalGroup(odu), mountingGroup(pack, odu)];
}

/** the effective choice selection for a system: persisted overrides ∪ each
    group's derived default. Missing/invalid keys fall back to the default. */
export function componentChoices(
  system: DesignSystem,
  groups: ComponentChoiceGroup[]
): Record<string, string> {
  const stored =
    system.settings.components && typeof system.settings.components === "object"
      ? (system.settings.components as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const g of groups) {
    const v = stored[g.key];
    const valid = typeof v === "string" && g.options.some((o) => o.id === v);
    out[g.key] = valid ? (v as string) : g.defaultId;
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
    sub: `${phaseLabel(odu)} · ${odu.refrigerant} condenser`,
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
    sub = "Pre-charged · run length unknown";
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
  };
}

function choiceRows(system: DesignSystem, groups: ComponentChoiceGroup[]): ComponentRow[] {
  const selected = componentChoices(system, groups);
  return groups.map((g) => {
    const selectedId = selected[g.key];
    const opt =
      g.options.find((o) => o.id === selectedId) ??
      g.options.find((o) => o.id === g.defaultId) ??
      g.options[0];
    return {
      id: g.key,
      kind: "choice" as const,
      role: g.role,
      name: opt.name,
      sub: opt.sub,
      value: opt.value,
      icon: g.icon,
      choice: { key: g.key, selectedId, options: g.options },
    };
  });
}

/** The system-level component list for the cockpit's Components tab. Empty
    until a pairing resolves; then ODU + refrigerant charge (derived) followed
    by the electrical + mounting rows (derived default, override-able).
    Per-room modules (multi / VRF) anchor on the shared outdoor alone — there
    is no single pairing — and take their charge rule from multi_rules. */
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
      ...choiceRows(system, componentChoiceGroups(pack, odu)),
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
    ...choiceRows(system, componentChoiceGroups(pack, odu)),
  ];
}
