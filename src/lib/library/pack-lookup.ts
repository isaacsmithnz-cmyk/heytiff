import type { DataPack } from "@/lib/studio/packs/schema";
import { chargeOf } from "./data-pack";
import { matchUnits, squash, type UnitSpec } from "./unit-specs";

/* WHAT THE DATA BOOKS SAY ABOUT A MODEL, FOR TIFF (bug 74, Isaac, 23 November
   2026: asked the pre-charged pipe length of a Daikin RZA60C2V1 from its
   label, Tiff searched the Library twice and said she couldn't find it. The
   Daikin pack had it all along, FDYAN60AV1 + RZA60C2V1 "None to 30 m, then
   350 g to 40 m, 700 g to 50 m", from the book and page, but Tiff had no way
   to read a pack.)

   The same packs and the same words as Data pack, so a figure she gives is
   the one the Library's own page shows. Pure: the packs and what was asked
   come in, plain rows go out. The rule as the pack stores it rides along
   beside the words, so a charge the words can't say still reaches her as
   the book's own table. */

export type PackPair = {
  indoor: string;
  outdoor: string;
  brand: string;
  /** "6.35 liquid, 12.7 gas" */
  pipes: string;
  longestRun: string;
  mostLift: string;
  /** the extra refrigerant as the book says it; null where the words can't */
  extraCharge: string | null;
  /** the pack's own rule, for when the words are null */
  chargeRule: unknown;
  cooling: string | null;
  heating: string | null;
  source: string | null;
};

export type PackMulti = {
  outdoor: string;
  brand: string;
  portPipes: string;
  mostPipeInAll: string;
  mostPerBranch: string;
  mostLift: string;
  extraCharge: string | null;
  chargeRule: unknown;
  source: string | null;
};

export type PackLookup = {
  units: UnitSpec[];
  pairs: PackPair[];
  multis: PackMulti[];
  /** pairs found but not listed */
  morePairs: number;
};

/** The most pairs one answer carries. An outdoor alone can pair with a dozen heads. */
export const PAIRS_MOST = 10;

/* WHAT WAS ASKED, AS MODEL CODES. A word with a digit in it and four
   characters at least is a model ("RZA60C2V1", "FDYAN60", "PUMY-SP140");
   "Daikin" and "pipe" are not, and would match nothing useful. With no such
   word, the whole query is tried as one, as the Library's own search does. */
export function modelWords(query: string): string[] {
  const words = query
    .split(/[\s,;/+&]+|\band\b|\bwith\b/i)
    .map((w) => w.trim())
    .filter((w) => /\d/.test(w) && squash(w).length >= 4);
  const out = [...new Set(words.map(squash))];
  return out.length ? out : squash(query).length >= 3 ? [query] : [];
}

const mm = (n: number) => `${Math.round(n * 100) / 100}`;
const kw = (n: number | undefined) => (n != null ? `${Math.round(n * 10) / 10} kW` : null);
function sourceOf(p: { kind?: string; source?: string; edition?: string; page?: string } | undefined): string | null {
  if (!p || !p.source || p.kind === "legacy-ductr") return null;
  return [p.source, p.edition, p.page ? `p. ${p.page}` : null].filter(Boolean).join(", ");
}

export function lookUpModels(packs: readonly DataPack[], query: string): PackLookup {
  const asked = modelWords(query);
  const units: UnitSpec[] = [];
  const seen = new Set<string>();
  for (const word of asked) {
    for (const u of matchUnits(packs, word, 4)) {
      if (seen.has(u.key)) continue;
      seen.add(u.key);
      units.push(u);
    }
  }
  const indoors = new Set(units.filter((u) => u.side === "indoor").map((u) => squash(u.model)));
  const outdoors = new Set(units.filter((u) => u.side === "outdoor").map((u) => squash(u.model)));

  const pairs: PackPair[] = [];
  const multis: PackMulti[] = [];
  for (const pack of packs) {
    const brandName = (id: string) => pack.brands?.find((b) => b.id === id)?.name ?? id;
    for (const p of pack.pair_tables ?? []) {
      const i = indoors.has(squash(p.idu_model));
      const o = outdoors.has(squash(p.odu_model));
      /* both sides named: that pair alone. One side named: its pairs. */
      const wanted = indoors.size && outdoors.size ? i && o : i || o;
      if (!wanted) continue;
      const brand = pack.outdoor_units?.find((u) => u.model === p.odu_model)?.brand ?? pack.brands?.[0]?.id ?? "";
      pairs.push({
        indoor: p.idu_model,
        outdoor: p.odu_model,
        brand: brandName(brand),
        pipes: `${mm(p.pipe_liquid_mm)} liquid, ${mm(p.pipe_gas_mm)} gas`,
        longestRun: `${p.max_length_m} m${p.max_length_basis === "equivalent" ? " equivalent" : ""}`,
        mostLift: `${p.max_lift_m} m`,
        extraCharge: chargeOf(p.additional_charge),
        chargeRule: p.additional_charge,
        cooling: kw(p.rated_cool_kw),
        heating: kw(p.rated_heat_kw),
        source: sourceOf(p.provenance),
      });
    }
    for (const r of pack.multi_rules ?? []) {
      if (!outdoors.has(squash(r.odu_model_ref))) continue;
      const brand = pack.outdoor_units?.find((u) => u.model === r.odu_model_ref)?.brand ?? pack.brands?.[0]?.id ?? "";
      multis.push({
        outdoor: r.odu_model_ref,
        brand: brandName(brand),
        portPipes: r.port_pipe_sizes.map((s) => `${mm(s.liquid_mm)} / ${mm(s.gas_mm)}`).join(", "),
        mostPipeInAll: `${r.max_total_pipe_m} m`,
        mostPerBranch: `${r.max_per_branch_m} m`,
        mostLift: `${r.max_lift_m} m`,
        extraCharge: chargeOf(r.additional_charge),
        chargeRule: r.additional_charge,
        source: sourceOf(r.provenance),
      });
    }
  }
  return { units, pairs: pairs.slice(0, PAIRS_MOST), multis, morePairs: Math.max(0, pairs.length - PAIRS_MOST) };
}
