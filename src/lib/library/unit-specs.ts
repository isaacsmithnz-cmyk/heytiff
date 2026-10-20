import type { DataPack, IndoorUnit, OutdoorUnit } from "@/lib/studio/packs/schema";

/* A MODEL'S SPECS, LOOKED UP IN THE LIBRARY (Isaac, 20 October: type a model
   into Manufacturer specs "and quickly check the specs"; the board
   https://claude.ai/artifact/64ih5Hjdp74pcKhzKZ6c6h, frame 3).

   Read from the data packs the Studio designs with, never typed in and never
   looked up online: every figure here is one a pack carries, with the book
   it came from. Pure: the packs come in, the cards go out. */

export type UnitSpec = {
  key: string;
  side: "outdoor" | "indoor";
  model: string;
  brand: string;
  /** what it is: "VRF outdoor, PUMY-SP series", "Ducted indoor, PEAD-M series" */
  kind: string;
  cooling: string;
  heating: string;
  power: string | null;
  breaker: string | null;
  pipes: string;
  indoorUnits: string | null;
  size: string;
  weight: string | null;
  sound: string | null;
  refrigerant: string;
  /** the book, its edition and pages, as the pack records them */
  source: string | null;
};

/** The rows a spec card shows, in its order: label and field. */
export const SPEC_ROWS: readonly { label: string; key: keyof UnitSpec }[] = [
  { label: "Cooling", key: "cooling" },
  { label: "Heating", key: "heating" },
  { label: "Power", key: "power" },
  { label: "Breaker", key: "breaker" },
  { label: "Pipes", key: "pipes" },
  { label: "Indoor units", key: "indoorUnits" },
  { label: "Size (W x D x H)", key: "size" },
  { label: "Weight", key: "weight" },
  { label: "Sound", key: "sound" },
  { label: "Refrigerant", key: "refrigerant" },
];

/** A model code with its spacing, dashes and case taken out: "pumy sp140" finds PUMY-SP140VKMD2-A. */
export const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const SYSTEM: Record<string, string> = { split: "Split", multi: "Multi", vrf: "VRF" };
const FORM: Record<string, string> = {
  wall: "Wall",
  ducted: "Ducted",
  "cassette-4way": "Cassette",
};

const kw = (n: number) => `${Math.round(n * 10) / 10} kW`;
const mm = (n: number) => `${Math.round(n * 100) / 100}`;
const phaseWord = (p: string | undefined) => (p === "3" ? "Three phase" : p === "1" ? "Single phase" : null);
const soundWord = (lo?: number, hi?: number) => (lo != null && hi != null && lo !== hi ? `${lo} to ${hi} dBA` : hi != null ? `${hi} dBA` : lo != null ? `${lo} dBA` : null);
const sourceWord = (p: { source: string; edition?: string; page?: string } | undefined) =>
  p && p.source && p.source !== "legacy-ductr" ? [p.source, p.edition, p.page ? `p. ${p.page}` : null].filter(Boolean).join(", ") : null;

function outdoor(u: OutdoorUnit, brand: string): UnitSpec {
  const ratio = u.ratio_min_pct != null && u.ratio_max_pct != null ? `, ${u.ratio_min_pct} to ${u.ratio_max_pct}%` : "";
  return {
    key: `o:${u.brand}:${u.model}`,
    side: "outdoor",
    model: u.model,
    brand,
    kind: `${SYSTEM[u.system_type] ?? "Split"} outdoor, ${u.series} series`,
    cooling: kw(u.capacity_cool_kw),
    heating: kw(u.capacity_heat_kw),
    power: phaseWord(u.phase),
    breaker: u.breaker_a != null ? `${u.breaker_a} A` : null,
    pipes: `${mm(u.conn_liquid_mm)} liquid, ${mm(u.conn_gas_mm)} gas`,
    indoorUnits: u.max_idus != null ? `Up to ${u.max_idus}${ratio}` : u.ports != null ? `${u.ports} ports` : null,
    size: `${u.width_mm} x ${u.depth_mm} x ${u.height_mm} mm`,
    weight: u.weight_kg != null ? `${u.weight_kg} kg` : null,
    sound: soundWord(u.sound_low_dba, u.sound_high_dba),
    refrigerant: u.precharged_kg != null ? `${u.refrigerant}, ${u.precharged_kg} kg in it` : u.refrigerant,
    source: sourceWord(u.provenance),
  };
}

function indoor(u: IndoorUnit, brand: string): UnitSpec {
  return {
    key: `i:${u.brand}:${u.model}`,
    side: "indoor",
    model: u.model,
    brand,
    kind: `${FORM[u.form_factor] ?? u.form_factor.charAt(0).toUpperCase() + u.form_factor.slice(1)} indoor, ${u.series} series`,
    cooling: kw(u.capacity_cool_kw),
    heating: kw(u.capacity_heat_kw),
    power: phaseWord(u.phase),
    breaker: null,
    pipes: `${mm(u.conn_liquid_mm)} liquid, ${mm(u.conn_gas_mm)} gas`,
    indoorUnits: null,
    size: `${u.width_mm} x ${u.depth_mm} x ${u.height_mm} mm`,
    weight: u.weight_kg != null ? `${u.weight_kg} kg` : null,
    sound: soundWord(u.sound_low_dba, u.sound_high_dba),
    refrigerant: u.refrigerant,
    source: sourceWord(u.provenance),
  };
}

/** The models a search names, outdoors first, closest first: one that starts
    with what was typed before one that only contains it. Three characters
    at least, so "P" never lists a catalogue. */
export function matchUnits(packs: readonly DataPack[], query: string, limit = 4): UnitSpec[] {
  const q = squash(query);
  if (q.length < 3) return [];
  const hits: { spec: UnitSpec; starts: boolean }[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    const brandName = (id: string) => pack.brands?.find((b) => b.id === id)?.name ?? id;
    for (const u of pack.outdoor_units ?? []) {
      const m = squash(u.model);
      if (!m.includes(q)) continue;
      const spec = outdoor(u, brandName(u.brand));
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      hits.push({ spec, starts: m.startsWith(q) });
    }
    for (const u of pack.indoor_units ?? []) {
      const m = squash(u.model);
      if (!m.includes(q)) continue;
      const spec = indoor(u, brandName(u.brand));
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      hits.push({ spec, starts: m.startsWith(q) });
    }
  }
  return hits
    .sort(
      (a, b) =>
        Number(b.starts) - Number(a.starts) ||
        Number(a.spec.side === "indoor") - Number(b.spec.side === "indoor") ||
        a.spec.model.localeCompare(b.spec.model),
    )
    .slice(0, limit)
    .map((h) => h.spec);
}

/** The rows that differ between the cards shown side by side: what the
    search says in amber. One card, or none, differs from nothing. */
export function differing(specs: readonly UnitSpec[]): Set<keyof UnitSpec> {
  const out = new Set<keyof UnitSpec>();
  if (specs.length < 2) return out;
  for (const { key } of SPEC_ROWS) if (new Set(specs.map((s) => s[key] ?? "")).size > 1) out.add(key);
  return out;
}

/** The letters a model code starts with, its family: "PUMY-SP140" → "PUMYSP".
    A data book names the family, not every model in it, so Manufacturer
    specs' documents match on this too. Null when it is too short to mean one. */
export function modelStem(query: string): string | null {
  const q = squash(query);
  const m = q.match(/^[A-Z]+/);
  return m && m[0].length >= 3 && /\d/.test(q) ? m[0] : null;
}
