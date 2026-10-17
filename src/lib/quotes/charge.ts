import type { DataPack, IndoorUnit, OutdoorUnit } from "@/lib/studio/packs/schema";
import { evaluateAdditionalCharge, evaluateVrfCharge, isVrfChargeRule, pastChargeTable } from "@/lib/studio/materials";
import { linkedModel, sameUnit, type ConfirmedLink } from "./lookups";

/* The refrigerant a system takes on top of its outdoor's own, by its maker's
   book: a split's pair rule, a multi's rule, a VRF's network rule (by the
   liquid pipe of each size, the run to the farthest head and the heads it
   carries). The Studio's own sums (materials.ts), not a second copy (3209,
   17 October: a whole 10 kg cylinder went on a PUMY-SP112 that the book puts
   at about 4 kg on the lengths she'd assumed). Pure. */

export type ChargeAsk = {
  outdoor: string;
  indoors: string[];
  /** metres of liquid pipe by its size, mm: { "6.35": 30, "9.52": 20 } */
  liquidM: Record<string, number>;
  /** VRF: outdoor to the farthest head, metres */
  farthestM?: number | null;
  /** VRF: how the heads connect; joints unless said */
  method?: "joint" | "branch-box";
};

export type Charge =
  | { found: false; reason: "no data pack" | "not in the pack"; model?: string }
  | {
      found: true;
      system: "split" | "multi" | "vrf";
      /** what to add, kg; null when the book can't give it from what's known */
      addKg: number | null;
      /** the outdoor's own charge and the most it may hold, kg */
      prechargedKg: number | null;
      maxKg: number | null;
      said: string[];
    };

const kg = (g: number) => Math.round(g / 100) / 10;

/** The charge to add to a system, every model read off `pack`, an order code
    it doesn't name through the business's confirmed links. */
export function chargeOf(pack: DataPack | null, ask: ChargeAsk, links: readonly ConfirmedLink[] = []): Charge {
  if (!pack) return { found: false, reason: "no data pack" };
  const find = <U extends { model: string }>(units: readonly U[], code: string): U | null => {
    const direct = units.find((u) => sameUnit(code, u.model));
    if (direct) return direct;
    const linked = linkedModel(links, code);
    return (linked ? units.find((u) => sameUnit(linked, u.model)) : undefined) ?? null;
  };
  const odu = find(pack.outdoor_units, ask.outdoor);
  if (!odu) return { found: false, reason: "not in the pack", model: ask.outdoor };
  const heads: IndoorUnit[] = [];
  for (const m of ask.indoors) {
    const u = find(pack.indoor_units, m);
    if (!u) return { found: false, reason: "not in the pack", model: m };
    heads.push(u);
  }
  const sizes = Object.entries(ask.liquidM).filter(([, m]) => m > 0);
  const totalM = sizes.reduce((a, [, m]) => a + m, 0);
  const base = { prechargedKg: odu.precharged_kg ?? null, maxKg: odu.max_charge_kg ?? null };
  const out = (system: "split" | "multi" | "vrf", g: number | null, said: string[]): Charge => {
    const words = [...said];
    if (g != null && odu.precharged_kg != null && odu.max_charge_kg != null && odu.precharged_kg + g / 1000 > odu.max_charge_kg + 1e-9)
      words.push(`That's ${kg(odu.precharged_kg * 1000 + g)} kg in all, over ${odu.model}'s ${odu.max_charge_kg} kg`);
    return { found: true, system, addKg: g == null ? null : kg(g), ...base, said: words };
  };

  if (odu.system_type === "vrf") return out("vrf", ...vrfCharge(pack, odu, heads, ask));

  if (odu.system_type === "multi") {
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model)?.additional_charge;
    if (!rule) return out("multi", null, [`${odu.model} has no charge rule in the book`]);
    /* a rule by size reads one size; a rule by length alone reads the whole run */
    const one = sizes.length === 1 ? Number(sizes[0]![0]) : undefined;
    const g = evaluateAdditionalCharge(rule, { liquidLengthM: totalM, ...(one != null ? { liquidSizeMm: one } : {}) });
    return out("multi", g, g == null ? [`The book's rule for ${odu.model} needs the liquid pipe's size and length`] : [`${totalM} m of liquid pipe on ${odu.model}`]);
  }

  const pair = heads.length === 1 ? pack.pair_tables.find((p) => p.odu_model === odu.model && p.idu_model === heads[0]!.model) : undefined;
  if (!pair) return out("split", null, [`${heads.length === 1 ? `${heads[0]!.model} isn't a pair for ${odu.model}` : `${odu.model} is a split outdoor: it takes one indoor`} in the book`]);
  const ctx = { liquidLengthM: totalM, liquidSizeMm: pair.pipe_liquid_mm };
  if (pastChargeTable(pair.additional_charge, ctx)) return out("split", null, [`${totalM} m is past the book's charge table for this pair`]);
  const g = evaluateAdditionalCharge(pair.additional_charge, ctx);
  return out("split", g, g == null ? ["The book's rule for this pair needs more than the run's length"] : [`${totalM} m of ${pair.pipe_liquid_mm} mm liquid pipe`]);
}

function vrfCharge(pack: DataPack, odu: OutdoorUnit, heads: IndoorUnit[], ask: ChargeAsk): [number | null, string[]] {
  const ref = ask.method === "branch-box" ? odu.branch_box_table_ref : odu.pipe_table_ref;
  const rule = ref ? pack.vrf_pipe_tables.find((t) => t.series === ref)?.additional_charge : undefined;
  if (!rule || !isVrfChargeRule(rule)) return [null, [`${odu.model} has no network charge rule in the book`]];
  if (ask.farthestM == null || !(ask.farthestM > 0)) return [null, ["The book's rule needs the run from the outdoor to the farthest head"]];
  const liquidM = Object.fromEntries(Object.entries(ask.liquidM).filter(([, m]) => m > 0));
  const g = evaluateVrfCharge(rule, {
    liquidM,
    farthestM: ask.farthestM,
    connectedIndex: heads.reduce((a, h) => a + (h.capacity_index ?? 0), 0),
    connectedKw: heads.reduce((a, h) => a + h.capacity_cool_kw, 0),
    oduModel: odu.model,
    iduModels: heads.map((h) => h.model),
    ...(odu.capacity_index != null ? { oduIndex: odu.capacity_index } : {}),
  });
  const pipe = Object.entries(liquidM).map(([s, m]) => `${m} m of ${s} mm`).join(" and ");
  return [g, g == null ? ["The book's rule has no figure for a size or a length given"] : [`${pipe} of liquid pipe, ${ask.farthestM} m to the farthest head`]];
}
