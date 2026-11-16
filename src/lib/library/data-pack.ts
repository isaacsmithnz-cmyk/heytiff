import { formFactorLabel } from "@/lib/studio/form-factors";
import { checkMultiCompatibility, multiCapableIdus, tableStanding, vrfCapableIdus } from "@/lib/studio/multi";
import { indexNotation, isSpigotOpening, spigotLabel } from "@/lib/studio/packs/schema";
import type {
  AdditionalChargeRule,
  DataPack,
  FormFactor,
  IndoorUnit,
  MultiRule,
  OpeningSpec,
  OutdoorUnit,
  Provenance,
  SystemType,
} from "@/lib/studio/packs/schema";
import { FORM_FACTORS } from "@/lib/studio/packs/schema";

/* DATA PACK: EVERY UNIT IN THE DATA BOOKS, to search, filter, compare and
   combine (Isaac, 16 November 2026: "Just have a Data pack section that
   displays all units to search through, filter and combine. A bit like
   system builder"; "Yep nice" to https://claude.ai/artifact/2Jvc2mQkhQscbykt7abwhM).

   Read from the packs the Studio designs with, never typed in and never
   looked up online, so a figure here is the one a design uses. Combine asks
   the Studio's own multi-split check (studio/multi), so "in the combination
   table" here is what the system builder would say. Nothing asks Tiff. Pure:
   the packs come in, plain rows go out, for the web page and the phone alike. */

export type PackUnit = {
  /** "i:<brand>:<model>" or "o:<brand>:<model>" */
  key: string;
  side: "indoor" | "outdoor";
  /** the form factor for an indoor unit, "outdoor" for an outdoor one */
  kind: string;
  /** "Ducted", "Wall", "Outdoor" */
  kindName: string;
  brand: string;
  brandName: string;
  model: string;
  series: string;
  /** what it goes on: an indoor unit's pairs, multis and VRF; an outdoor's own type */
  systems: SystemType[];
  coolKw: number;
  heatKw: number;
  phase: "1" | "3" | null;
  /** l/s */
  airflow: number | null;
  /** Pa, the most it takes */
  staticPa: number | null;
  /** "1060 x 178", "1 × Ø400", "Open" */
  supply: string | null;
  return: string | null;
  /** "1100 x 732 x 250" mm, W x D x H */
  size: string | null;
  weightKg: number | null;
  /** "9.52 / 15.88" mm, liquid / gas */
  pipes: string;
  /** "30 to 39 dB(A)" */
  sound: string | null;
  refrigerant: string;
  /** an outdoor's ports or most heads, "4 ports", "Up to 12" */
  heads: string | null;
  breakerA: number | null;
  /** an outdoor's longest run and lift, from its pairs or its multi rule */
  run: string | null;
  /** an outdoor's extra charge, as its book says it */
  charge: string | null;
  /** an outdoor Combine can build on: a multi with its rule, a split with its pairs */
  combinable: boolean;
};

export const SYSTEM_NAMES: Record<SystemType, string> = { split: "Split", multi: "Multi", vrf: "VRF" };

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const kw = (n: number) => `${round(n, 1)} kW`;

function sourceOf(p: Provenance | undefined): string | null {
  if (!p || !p.source || p.kind === "legacy-ductr") return null;
  /* a staff-entered row carries the whole story in `source`; the book it
     names is what a reader wants */
  const source = p.source.length > 90 ? null : p.source;
  const page = p.page ? (/[,–-]| to /.test(p.page) ? `pp. ${p.page}` : `p. ${p.page}`) : null;
  const said = [source, p.edition, page].filter(Boolean).join(", ");
  return said || null;
}

function openingOf(o: OpeningSpec | undefined): string | null {
  if (o == null) return null;
  if (o === "built-in") return "Built in";
  if (o === "spigots") return "Spigots";
  if (o === "open") return "Open";
  if (isSpigotOpening(o)) return spigotLabel(o) || "Spigots";
  return `${o.w_mm} x ${o.h_mm}`;
}

function soundOf(lo?: number, hi?: number): string | null {
  if (lo != null && hi != null && lo !== hi) return `${lo} to ${hi} dB(A)`;
  const one = hi ?? lo;
  return one != null ? `${one} dB(A)` : null;
}

const sizeOf = (w?: number, d?: number, h?: number) => (w && d && h ? `${w} x ${d} x ${h}` : null);
const pipesOf = (l: number, g: number) => `${round(l)} / ${round(g)}`;

/** An extra charge as the book says it; null where the book's own sum is needed to say it. */
export function chargeOf(rule: AdditionalChargeRule | undefined): string | null {
  if (!rule) return null;
  switch (rule.method) {
    case "none_required":
      return "None";
    case "threshold_then_rate":
      return rule.g_per_m_beyond > 0
        ? `None to ${rule.free_up_to_m} m, then ${rule.g_per_m_beyond} g a metre`
        : `None to ${rule.free_up_to_m} m`;
    case "per_meter_by_liquid_size": {
      const rates = Object.entries(rule.rates)
        .map(([mm, g]) => `${g} g a metre on ${mm}`)
        .join(", ");
      return rule.precharged_allowance_m ? `None to ${rule.precharged_allowance_m} m, then ${rates}` : rates;
    }
    default:
      return null;
  }
}

const runOf = (length: number, lift: number) => `${length} m, ${lift} m lift`;

/** Every unit in the packs, indoor and outdoor, as one list: brand, then kind, then size. */
export function packUnits(packs: readonly DataPack[]): PackUnit[] {
  const out: PackUnit[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    const brandName = (id: string) => pack.brands?.find((b) => b.id === id)?.name ?? id;
    const paired = new Set(pack.pair_tables.map((p) => p.idu_model));
    const multi = new Set(multiCapableIdus(pack).map((u) => u.model));
    const vrf = new Set(vrfCapableIdus(pack).map((u) => u.model));
    for (const u of pack.indoor_units) {
      if (!(u.capacity_cool_kw > 0)) continue;
      const key = `i:${u.brand}:${u.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const systems: SystemType[] = [];
      if (paired.has(u.model) || u.system_roles?.includes("split-pair")) systems.push("split");
      if (multi.has(u.model)) systems.push("multi");
      if (vrf.has(u.model) || u.system_roles?.includes("vrf")) systems.push("vrf");
      out.push({
        key,
        side: "indoor",
        kind: u.form_factor,
        kindName: formFactorLabel(u.form_factor),
        brand: u.brand,
        brandName: brandName(u.brand),
        model: u.model,
        series: u.series,
        systems,
        coolKw: u.capacity_cool_kw,
        heatKw: u.capacity_heat_kw,
        phase: u.phase ?? null,
        airflow: u.airflow_ls ?? null,
        staticPa: u.static_pressure_pa ?? null,
        supply: openingOf(u.supply_opening),
        return: openingOf(u.return_opening),
        size: sizeOf(u.width_mm, u.depth_mm, u.height_mm),
        weightKg: u.weight_kg ?? null,
        pipes: pipesOf(u.conn_liquid_mm, u.conn_gas_mm),
        sound: soundOf(u.sound_low_dba, u.sound_high_dba),
        refrigerant: u.refrigerant,
        heads: null,
        breakerA: null,
        run: null,
        charge: null,
        combinable: false,
      });
    }
    for (const u of pack.outdoor_units) {
      if (!(u.capacity_cool_kw > 0)) continue;
      const key = `o:${u.brand}:${u.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rule = pack.multi_rules.find((r) => r.odu_model_ref === u.model);
      const pairs = pack.pair_tables.filter((p) => p.odu_model === u.model);
      const longest = pairs.length ? pairs.reduce((a, b) => (b.max_length_m > a.max_length_m ? b : a)) : null;
      out.push({
        key,
        side: "outdoor",
        kind: "outdoor",
        kindName: "Outdoor",
        brand: u.brand,
        brandName: brandName(u.brand),
        model: u.model,
        series: u.series,
        systems: [u.system_type],
        coolKw: u.capacity_cool_kw,
        heatKw: u.capacity_heat_kw,
        phase: u.phase ?? null,
        airflow: null,
        staticPa: null,
        supply: null,
        return: null,
        size: sizeOf(u.width_mm, u.depth_mm, u.height_mm),
        weightKg: u.weight_kg ?? null,
        pipes: pipesOf(u.conn_liquid_mm, u.conn_gas_mm),
        sound: soundOf(u.sound_low_dba, u.sound_high_dba),
        refrigerant: u.refrigerant,
        heads: u.ports != null ? `${u.ports} ports` : u.max_idus != null ? `Up to ${u.max_idus}` : null,
        breakerA: u.breaker_a ?? null,
        run: rule
          ? `${rule.max_total_pipe_m} m in all, ${rule.max_per_branch_m} m a branch, ${rule.max_lift_m} m lift`
          : longest
            ? runOf(longest.max_length_m, longest.max_lift_m)
            : null,
        charge: chargeOf(rule ? rule.additional_charge : longest?.additional_charge),
        combinable: (u.system_type === "multi" && !!rule) || (u.system_type === "split" && pairs.length > 0),
      });
    }
  }
  return out;
}

/* ── the filters ─────────────────────────────────────────────────────────── */

export type PackFilter = {
  /** words: a model, a brand, a kind, a size ("7.1 ducted") */
  q?: string;
  kind?: string | null;
  coolFrom?: number | null;
  coolTo?: number | null;
  /** brand ids; none is every brand */
  brands?: readonly string[];
  /** none is every system */
  systems?: readonly SystemType[];
  phase?: "1" | "3" | null;
};

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.]/g, "");

/** does one typed word fit the unit? A number is its cooling, near enough. */
function wordFits(u: PackUnit, word: string): boolean {
  if (/^\d+(\.\d+)?$/.test(word)) {
    const n = Number(word);
    // "7.1" is a size; "71" may be the model's own number, so both are tried
    if (Math.abs(u.coolKw - n) <= 0.15) return true;
    return squash(u.model).includes(squash(word));
  }
  const w = word.toLowerCase();
  if (squash(u.model).includes(squash(word)) && squash(word).length >= 2) return true;
  const said = [u.brandName, u.kindName, u.series, ...u.systems.map((s) => SYSTEM_NAMES[s])].join(" ").toLowerCase();
  return said.split(/[\s-]+/).some((part) => part.startsWith(w));
}

export function filterUnits(units: readonly PackUnit[], f: PackFilter): PackUnit[] {
  const words = (f.q ?? "").trim().split(/\s+/).filter(Boolean);
  return units.filter(
    (u) =>
      (!f.kind || u.kind === f.kind) &&
      (f.coolFrom == null || u.coolKw >= f.coolFrom - 1e-9) &&
      (f.coolTo == null || u.coolKw <= f.coolTo + 1e-9) &&
      (!f.brands?.length || f.brands.includes(u.brand)) &&
      (!f.systems?.length || u.systems.some((s) => f.systems!.includes(s))) &&
      (!f.phase || u.phase === f.phase) &&
      words.every((w) => wordFits(u, w)),
  );
}

/** The table's order: smallest first, then brand, then model. */
export function sortUnits(units: readonly PackUnit[]): PackUnit[] {
  return [...units].sort(
    (a, b) => a.coolKw - b.coolKw || a.brandName.localeCompare(b.brandName) || a.model.localeCompare(b.model),
  );
}

/** The kinds the filter offers, in the Studio's order, each with how many units it holds. */
export function packKinds(units: readonly PackUnit[]): { kind: string; name: string; count: number }[] {
  const count = new Map<string, number>();
  for (const u of units) count.set(u.kind, (count.get(u.kind) ?? 0) + 1);
  const order: string[] = [...FORM_FACTORS, "outdoor"];
  return order
    .filter((k) => count.has(k))
    .map((k) => ({ kind: k, name: k === "outdoor" ? "Outdoor" : formFactorLabel(k as FormFactor), count: count.get(k)! }));
}

/** The brands, by name, each with how many units it holds. */
export function packBrands(units: readonly PackUnit[]): { brand: string; name: string; count: number }[] {
  const by = new Map<string, { brand: string; name: string; count: number }>();
  for (const u of units) {
    const b = by.get(u.brand) ?? { brand: u.brand, name: u.brandName, count: 0 };
    b.count++;
    by.set(u.brand, b);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ── compare ─────────────────────────────────────────────────────────────── */

export type CompareRow = { label: string; values: string[]; same: boolean };

const ROWS: { label: string; of: (u: PackUnit) => string | null }[] = [
  { label: "Kind", of: (u) => u.kindName },
  { label: "System", of: (u) => u.systems.map((s) => SYSTEM_NAMES[s]).join(", ") || null },
  { label: "Cooling", of: (u) => kw(u.coolKw) },
  { label: "Heating", of: (u) => kw(u.heatKw) },
  { label: "Airflow", of: (u) => (u.airflow != null ? `${u.airflow} L/s` : null) },
  { label: "External static", of: (u) => (u.staticPa != null ? `${u.staticPa} Pa` : null) },
  { label: "Supply opening", of: (u) => (u.supply ? (/^\d/.test(u.supply) ? `${u.supply} mm` : u.supply) : null) },
  { label: "Return opening", of: (u) => (u.return ? (/^\d/.test(u.return) ? `${u.return} mm` : u.return) : null) },
  { label: "Indoor units", of: (u) => u.heads },
  { label: "Pipe run", of: (u) => u.run },
  { label: "Extra charge", of: (u) => u.charge },
  { label: "Unit (W x D x H)", of: (u) => (u.size ? `${u.size} mm` : null) },
  { label: "Weight", of: (u) => (u.weightKg != null ? `${u.weightKg} kg` : null) },
  { label: "Pipes (liquid / gas)", of: (u) => `${u.pipes} mm` },
  { label: "Sound", of: (u) => u.sound },
  { label: "Power", of: (u) => (u.phase === "3" ? "Three phase" : u.phase === "1" ? "Single phase" : null) },
  { label: "Breaker", of: (u) => (u.breakerA != null ? `${u.breakerA} A` : null) },
  { label: "Refrigerant", of: (u) => u.refrigerant },
];

/** The ticked units side by side, a row a figure; a row none of them has is left out.
    `same` is a row where every one matches, drawn quiet so what differs stands out. */
export function compareRows(units: readonly PackUnit[]): CompareRow[] {
  return ROWS.map((r) => {
    const values = units.map((u) => r.of(u) ?? "");
    return { label: r.label, values, same: units.length > 1 && new Set(values).size === 1 };
  }).filter((r) => r.values.some(Boolean));
}

/** The most Compare holds at once. */
export const COMPARE_MOST = 4;

/* ── combine ─────────────────────────────────────────────────────────────── */

export type CombineTone = "good" | "look" | "bad";

export type Combined = {
  outdoor: PackUnit;
  /** the indoor units this outdoor takes, by key: only these are offered */
  offered: string[];
  /** the most heads it takes: a split's one, a multi's ports; null where the book gives no count */
  most: number | null;
  /** each head's port, in the order given: its letter and its pipe sizes */
  ports: { port: string; pipes: string | null }[];
  /** null until a head is chosen */
  verdict: { tone: CombineTone; word: string; lines: string[] } | null;
  facts: { label: string; value: string }[];
  /** the heads it takes, said once: "MSZ-AP, MSZ-LN and PEAD-M50 to 60" */
  takes: string | null;
  source: string | null;
};

const PORT = "ABCDEFGHIJKLMNOP";

function packOf(packs: readonly DataPack[], key: string): { pack: DataPack; model: string } | null {
  const [, brand, ...rest] = key.split(":");
  const model = rest.join(":");
  const pack = packs.find((p) => p.outdoor_units.some((u) => u.brand === brand && u.model === model) || p.indoor_units.some((u) => u.brand === brand && u.model === model));
  return pack ? { pack, model } : null;
}

const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** the families a multi's heads come from, each said once: a series and its sizes */
function takesOf(heads: IndoorUnit[]): string | null {
  const by = new Map<string, number[]>();
  for (const h of heads) {
    const at = by.get(h.series) ?? [];
    if (h.capacity_code != null) at.push(h.capacity_code);
    by.set(h.series, at);
  }
  return by.size ? and([...by.keys()]) : null;
}

/** An outdoor and its heads, as the system builder checks them: the multi's
    own rule and combination table, or a split's pair. */
export function combine(packs: readonly DataPack[], units: readonly PackUnit[], outdoorKey: string, headKeys: readonly string[]): Combined | null {
  const outdoor = units.find((u) => u.key === outdoorKey && u.side === "outdoor");
  const at = packOf(packs, outdoorKey);
  if (!outdoor || !at) return null;
  const { pack, model } = at;
  const odu = pack.outdoor_units.find((u) => u.model === model) as OutdoorUnit;
  const notation = indexNotation(pack, odu.brand);
  const headModels = headKeys.map((k) => k.split(":").slice(2).join(":"));
  const heads = headModels
    .map((m) => pack.indoor_units.find((u) => u.model === m))
    .filter((u): u is IndoorUnit => !!u);
  const keyOf = (u: IndoorUnit) => `i:${u.brand}:${u.model}`;
  const power = [outdoor.phase === "3" ? "Three phase" : outdoor.phase === "1" ? "Single phase" : null, outdoor.breakerA != null ? `${outdoor.breakerA} A breaker` : null]
    .filter(Boolean)
    .join(", ");

  const rule: MultiRule | undefined = odu.system_type === "multi" ? pack.multi_rules.find((r) => r.odu_model_ref === odu.model) : undefined;
  if (rule) {
    const offeredUnits = multiCapableIdus(pack, [rule]);
    const ports = heads.map((_, i) => {
      const p = rule.port_pipe_sizes[i];
      return { port: PORT[i] ?? String(i + 1), pipes: p ? pipesOf(p.liquid_mm, p.gas_mm) : null };
    });
    const table = rule.compatibility.find((c) => c.method === "capacity_combination_table" || c.method === "explicit_combination_table");
    const source = sourceOf(table && "provenance" in table ? table.provenance : undefined) ?? sourceOf(rule.provenance) ?? sourceOf(odu.provenance);
    const total = heads.reduce((t, h) => t + h.capacity_cool_kw, 0);
    const facts: { label: string; value: string }[] = [];
    let verdict: Combined["verdict"] = null;
    if (heads.length) {
      const findings = checkMultiCompatibility(rule, odu, heads, notation);
      const red = findings.filter((f) => f.severity === "red");
      const amber = findings.filter((f) => f.severity === "amber");
      const standing = tableStanding(rule, heads);
      verdict = red.length
        ? {
            tone: "bad",
            word: red.some((f) => f.code === "not-in-combination-table") ? "Not in the combination table" : "Not a combination it takes",
            lines: red.map((f) => f.message),
          }
        : amber.length
          ? { tone: "look", word: "Not a whole combination yet", lines: amber.map((f) => f.message) }
          : { tone: "good", word: table && standing.lists ? "In the combination table" : "Within the data book's limits", lines: [] };
      const codes = heads.map((h) => h.capacity_code);
      if (codes.every((c) => c != null)) facts.push({ label: "Heads", value: codes.join(" + ") });
      facts.push({ label: "Indoor total", value: `${round(total, 1).toFixed(1)} kW on a ${kw(outdoor.coolKw)} outdoor` });
    }
    if (odu.ports != null) facts.push({ label: "Ports", value: `${heads.length} of ${odu.ports} used` });
    facts.push({ label: "Pipe", value: `${rule.max_total_pipe_m} m in all, ${rule.max_per_branch_m} m a branch, ${rule.max_lift_m} m lift` });
    const charge = chargeOf(rule.additional_charge);
    if (charge) facts.push({ label: "Extra charge", value: charge });
    if (power) facts.push({ label: "Power", value: power });
    return { outdoor, offered: offeredUnits.map(keyOf), most: odu.ports ?? null, ports, verdict, facts, takes: takesOf(offeredUnits), source };
  }

  // a split: its pairs, one head
  const pairs = pack.pair_tables.filter((p) => p.odu_model === odu.model);
  const offeredUnits = pairs
    .map((p) => pack.indoor_units.find((u) => u.model === p.idu_model))
    .filter((u): u is IndoorUnit => !!u);
  const head = heads[0];
  const pair = head ? pairs.find((p) => p.idu_model === head.model) : undefined;
  const facts: { label: string; value: string }[] = [];
  let verdict: Combined["verdict"] = null;
  if (head) {
    verdict =
      heads.length > 1
        ? { tone: "bad", word: "Not a combination it takes", lines: [`${odu.model} is a split: it takes one indoor unit`] }
        : pair
          ? { tone: "good", word: "A pair in the data book", lines: [] }
          : { tone: "bad", word: "Not a pair in the data book", lines: [`${head.model} isn't listed with ${odu.model}`] };
    if (pair) {
      facts.push({ label: "Pipes", value: `${pipesOf(pair.pipe_liquid_mm, pair.pipe_gas_mm)} mm` });
      facts.push({ label: "Pipe", value: `${pair.max_length_m} m, ${pair.max_lift_m} m lift` });
      const charge = chargeOf(pair.additional_charge);
      if (charge) facts.push({ label: "Extra charge", value: charge });
      if (pair.rated_cool_kw != null) facts.push({ label: "Rated", value: `${kw(pair.rated_cool_kw)} cooling${pair.rated_heat_kw != null ? `, ${kw(pair.rated_heat_kw)} heating` : ""}` });
    }
  }
  if (power) facts.push({ label: "Power", value: power });
  return {
    outdoor,
    offered: offeredUnits.map(keyOf),
    most: 1,
    ports: heads.map((_, i) => ({ port: i === 0 ? "A" : PORT[i], pipes: i === 0 && pair ? pipesOf(pair.pipe_liquid_mm, pair.pipe_gas_mm) : null })),
    verdict,
    facts,
    takes: null,
    source: sourceOf(pair?.provenance) ?? sourceOf(odu.provenance),
  };
}
