import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import { indexNotation } from "@/lib/studio/packs/schema";
import { checkMultiCompatibility, UNDER_MINIMUM } from "@/lib/studio/multi";
import { checkVrfSet } from "@/lib/studio/vrf";
import { linkedModel, sameUnit, type ConfirmedLink } from "./lookups";

/* Whether an outdoor takes the indoors on a quote, by its maker's own book:
   a split's pair from the pack's pair table, a multi's set by its
   combination rules (which models connect, and the table for capacity), a
   VRF's by its own rules: the Studio's checks, not a second copy of them
   (the bench, 15 October: a VRF ducted head went on a multi outdoor, she
   said "pairing not checked", and nothing could check it). */

export type Pairing =
  | { found: false; reason: "no data pack" | "not in the pack"; model?: string }
  | {
      found: true;
      system: "split" | "multi" | "vrf";
      /** null: the book lists no pairs for the outdoor, so nothing's checked */
      connects: boolean | null;
      /** why not, in the book's words; or what holds it, when it connects */
      said: string[];
      /** a split pair's rated capacity, from the pair table */
      rated?: { coolKw: number | null; heatKw: number | null };
      /** a split outdoor that won't take this indoor: the indoors it does */
      pairsWith?: string[];
    };

/** The outdoor's verdict on the indoors given, every model read off `pack`,
    an order code it doesn't name through the business's confirmed links. */
export function pairingOf(pack: DataPack | null, outdoor: string, indoors: string[], links: readonly ConfirmedLink[] = []): Pairing {
  if (!pack) return { found: false, reason: "no data pack" };
  const read: string[] = [];
  const find = <U extends { model: string }>(units: readonly U[], code: string): U | null => {
    const direct = units.find((u) => sameUnit(code, u.model));
    if (direct) return direct;
    const linked = linkedModel(links, code);
    const via = linked ? units.find((u) => sameUnit(linked, u.model)) : undefined;
    if (via && !read.some((r) => r.startsWith(`${code} `))) read.push(`${code} read as ${via.model}, your confirmed link`);
    return via ?? null;
  };
  const odu = find(pack.outdoor_units, outdoor);
  if (!odu) return { found: false, reason: "not in the pack", model: outdoor };
  const heads: IndoorUnit[] = [];
  for (const m of indoors) {
    const u = find(pack.indoor_units, m);
    if (!u) return { found: false, reason: "not in the pack", model: m };
    heads.push(u);
  }
  const verdict = judged(pack, odu, heads);
  return verdict.found && read.length ? { ...verdict, said: [...read, ...verdict.said] } : verdict;
}

function judged(pack: DataPack, odu: DataPack["outdoor_units"][number], heads: IndoorUnit[]): Pairing {

  if (odu.system_type === "multi") {
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
    if (!rule) return { found: true, system: "multi", connects: false, said: [`${odu.model} has no combination rule in the book`] };
    /* as the Studio holds a chosen outdoor to it (verdict.ts): its red
       findings, and a minimum the set is under */
    const red = checkMultiCompatibility(rule, odu, heads, indexNotation(pack, odu.brand)).filter((f) => f.severity === "red" || UNDER_MINIMUM.has(f.code));
    return red.length
      ? { found: true, system: "multi", connects: false, said: red.map((f) => f.message.replace(/\.$/, "")) }
      : { found: true, system: "multi", connects: true, said: [`${odu.model} takes ${heads.map((h) => h.model).join(", ")}`] };
  }

  if (odu.system_type === "vrf") {
    const red = checkVrfSet(pack, odu, heads).filter((f) => f.severity === "red");
    return red.length
      ? { found: true, system: "vrf", connects: false, said: red.map((f) => f.message.replace(/\.$/, "")) }
      : { found: true, system: "vrf", connects: true, said: [`${odu.model} takes ${heads.map((h) => h.model).join(", ")}`] };
  }

  const pairsWith = [...new Set(pack.pair_tables.filter((p) => p.odu_model === odu.model).map((p) => p.idu_model))];
  if (!pairsWith.length) return { found: true, system: "split", connects: null, said: [`The book lists no pairs for ${odu.model}: not checked`] };
  if (heads.length !== 1) return { found: true, system: "split", connects: false, said: [`${odu.model} is a split outdoor: it takes one indoor`], pairsWith };
  const pair = pack.pair_tables.find((p) => p.odu_model === odu.model && p.idu_model === heads[0]!.model);
  if (!pair) return { found: true, system: "split", connects: false, said: [`${heads[0]!.model} isn't a pair for ${odu.model} in the book`], pairsWith };
  return {
    found: true,
    system: "split",
    connects: true,
    said: [`${heads[0]!.model} with ${odu.model} is a pair in the book`],
    rated: { coolKw: pair.rated_cool_kw ?? null, heatKw: pair.rated_heat_kw ?? null },
  };
}
