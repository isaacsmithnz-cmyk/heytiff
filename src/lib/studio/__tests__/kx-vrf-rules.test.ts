/* Two VRF rules the MHI KX Micro books print and the engine couldn't hold:
   the charge's heads term (KX-T-374 p.21, P + I) and a connection-ratio top
   that falls with the head count (R32 VRF brochure, Mar 2026, folio 25).
   KX's own rows arrive with its pack (#1103); these pin the rule kinds to the
   books' figures, and Mitsubishi Electric's City Multi to what it was. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type AdditionalChargeRule, type DataPack, type IndoorUnit, type OutdoorUnit, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { evaluateAdditionalCharge, evaluateVrfCharge } from "../materials";
import { sizeVrfTree, type VrfTree } from "../vrf-tree";
import { checkVrfSet, ratioTier, vrfBand, vrfLoadCeilingKw } from "../vrf";
import { validatePack } from "../packs/validate";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/* ═══════════ the charge: P + I, KX-T-374 p.21 ═══════════
   P = standard 3.2 kg + L(φ9.52) × 0.050 + L(φ6.35) × 0.020 − factory 4.2 kg
   ("When an additional charge volume calculation result is negative, it is
   not necessary"); I = D × 0.005, D = total indoor capacity − outdoor
   capacity, I = 0 when D ≤ 0; "rounding to the nearest 0.1kg". */
const KX: AdditionalChargeRule = {
  method: "formula_coefficients",
  terms: [
    { liquid_mm: 9.52, coeff_g_per_m: 50 },
    { liquid_mm: 6.35, coeff_g_per_m: 20 },
  ],
  deduction_g: 1000,
  min_charge_g: 0,
  plus_per_index_over_odu_g: 5,
  round_g: 100,
};
const net = (liquidM: Record<string, number>, connectedIndex: number, oduIndex?: number) =>
  evaluateVrfCharge(KX as Extract<AdditionalChargeRule, { method: "formula_coefficients" }>, {
    liquidM,
    farthestM: 0,
    connectedIndex,
    oduModel: "FDC140KXZEN1-W",
    iduModels: [],
    ...(oduIndex != null ? { oduIndex } : {}),
  });

describe("formula_coefficients on a VRF network — MHI KX Micro", () => {
  it("the book's example: FDC140 with FDT45 × 4, D = 45 × 4 − 140 = 40, I = 0.2 kg", () => {
    // pipe inside the factory charge's 20 m: P is nothing, the charge is I alone
    expect(net({ "9.52": 20 }, 4 * 45, 140)).toBe(200);
  });

  it("P on every size's metres, less the factory charge's 1.0 kg, plus I", () => {
    // 3.2 + 30 × 0.050 + 20 × 0.020 − 4.2 = 0.9; + 0.2 = 1.1 kg
    expect(net({ "9.52": 30, "6.35": 20 }, 180, 140)).toBe(1100);
  });

  it("a negative P is nothing, and I still adds", () => {
    // 3.2 + 0.5 + 0.2 − 4.2 = −0.3 → 0
    expect(net({ "9.52": 10, "6.35": 10 }, 180, 140)).toBe(200);
  });

  it("no I when the heads don't exceed the outdoor", () => {
    expect(net({ "9.52": 30 }, 140, 140)).toBe(500);
    expect(net({ "9.52": 30 }, 112, 140)).toBe(500);
  });

  it("rounds to the NEAREST 0.1 kg", () => {
    expect(net({ "9.52": 23 }, 140, 140)).toBe(200); // 0.15 → 0.2
    expect(net({ "9.52": 22.5 }, 140, 140)).toBe(100); // 0.125 → 0.1
  });

  it("no figure for a size it has no coefficient for, or without the outdoor's index", () => {
    expect(net({ "12.7": 5, "9.52": 30 }, 180, 140)).toBeNull();
    expect(net({ "9.52": 30 }, 180)).toBeNull();
  });

  it("a pair has no connected index: a rule with the heads term gives no one-run figure", () => {
    expect(evaluateAdditionalCharge(KX, { liquidLengthM: 30, liquidSizeMm: 9.52 })).toBeNull();
    const { plus_per_index_over_odu_g: _i, ...pOnly } = KX as Extract<AdditionalChargeRule, { method: "formula_coefficients" }>;
    void _i;
    expect(evaluateAdditionalCharge(pOnly, { liquidLengthM: 30, liquidSizeMm: 9.52 })).toBe(500);
  });
});

describe("the VRF tree evaluates a formula charge with the outdoor's index", () => {
  const odu = pack.outdoor_units.find((o) => o.model === "PUHY-P350YNW-A1")!;
  const head = (i: number) => pack.indoor_units.find((u) => u.capacity_index === i && u.system_roles?.includes("vrf"))!.model;
  /* two heads straight off one joint, drawn */
  const tree: VrfTree = {
    provisional: false,
    nodes: [
      { id: "OU", kind: "odu" },
      { id: "J1", kind: "joint" },
      { id: "I1", kind: "idu", model: head(250) },
      { id: "I2", kind: "idu", model: head(125) },
    ],
    sections: [
      { id: "A", from: "OU", to: "J1", lengthM: 20 },
      { id: "a", from: "J1", to: "I1", lengthM: 10 },
      { id: "b", from: "J1", to: "I2", lengthM: 10 },
    ],
  };

  it("City Multi's own charge is unchanged by the new method", () => {
    const sized = sizeVrfTree(pack, odu, tree);
    expect(sized.chargeG).not.toBeNull();
    // the shipped table is still the City Multi method
    expect(pack.vrf_pipe_tables.every((t) => t.additional_charge.method === "per_meter_by_liquid_size_by_farthest")).toBe(true);
  });

  it("a table charging by formula: Σ metres × coefficient, and the heads' index past the outdoor's", () => {
    const sized = sizeVrfTree(pack, odu, tree);
    const terms = Object.keys(sized.liquidM).map((mm) => ({ liquid_mm: Number(mm), coeff_g_per_m: 50 }));
    const formula: DataPack = {
      ...pack,
      vrf_pipe_tables: pack.vrf_pipe_tables.map((t) =>
        t.series === odu.pipe_table_ref
          ? { ...t, additional_charge: { method: "formula_coefficients" as const, terms, plus_per_index_over_odu_g: 5 } }
          : t
      ),
    };
    // 40 m × 50 g + (250 + 125 − 350) × 5 g = 2000 + 125
    expect(sizeVrfTree(formula, odu, tree).chargeG).toBe(2125);
  });
});

/* ═══════════ the ratio's top by head count: R32 VRF brochure folio 25 ═══════════
   KX Micro 100–150%, "*When connecting 9 units or more, set the total
   capacity as follows: 5HP : 110% or less, 6HP : 100% or less" (FDC140 = 5HP,
   FDCA155 = 6HP, both 1–10 heads). KX-T-374 p.2: "Capacity from 80% to 150%
   is possible (In only FDC90KXZEN1-W, capacity from 100% to 150%)". */
function kxOdu(model: string, index: number, kw: number, tier?: number): OutdoorUnit {
  return {
    model,
    brand: "mitsubishi-heavy-industries",
    series: "KX Micro",
    system_type: "vrf",
    capacity_cool_kw: kw,
    capacity_heat_kw: kw + 1,
    capacity_index: index,
    phase: "1",
    conn_liquid_mm: 9.52,
    conn_gas_mm: 15.88,
    refrigerant: "R32",
    ratio_min_pct: 80,
    ratio_max_pct: 150,
    ...(tier != null ? { ratio_max_pct_by_heads: [{ min_heads: 9, max_pct: tier }] } : {}),
    max_idus: 10,
    idu_index_min: 15,
    idu_index_max: 160,
    width_mm: 950,
    depth_mm: 370,
    height_mm: 1300,
    provenance: { kind: "extracted", source: "test" },
  };
}
/* City Multi rows stand in for KX heads: the envelope reads only the index */
const vrfHead = (index: number): IndoorUnit => ({
  ...pack.indoor_units.find((u) => u.system_roles?.includes("vrf") && u.capacity_index != null)!,
  capacity_index: index,
});
const heads = (...idx: number[]) => idx.map(vrfHead);

describe("ratio_max_pct_by_heads — KX Micro FDC140 (5HP) and FDCA155 (6HP)", () => {
  const fdc140 = kxOdu("FDC140KXZEN1-W", 140, 14, 110);
  const fdca155 = kxOdu("FDCA155KXZEN1-W", 155, 15.2, 100);

  it("8 heads take up to 150%: 8 × 25 = 200 of 140 is 143%", () => {
    expect(checkVrfSet(pack, fdc140, heads(25, 25, 25, 25, 25, 25, 25, 25))).toEqual([]);
  });

  it("9 heads take up to 110% on the 5HP: 9 × 20 = 180 of 140 is 129%, red", () => {
    expect(checkVrfSet(pack, fdc140, heads(20, 20, 20, 20, 20, 20, 20, 20, 20))).toEqual([
      {
        severity: "red",
        code: "ratio-over",
        message: "The heads come to 129% of FDC140KXZEN1-W, over its 110% with 9 or more heads (150% with fewer)",
      },
    ]);
    // 9 × 17 = 153 of 140 is 109%
    expect(checkVrfSet(pack, fdc140, heads(17, 17, 17, 17, 17, 17, 17, 17, 17))).toEqual([]);
  });

  it("and 100% on the 6HP", () => {
    expect(vrfBand(fdca155, 10)!.ratio_max_pct).toBe(100);
    expect(vrfBand(fdca155, 8)!.ratio_max_pct).toBe(150);
    expect(checkVrfSet(pack, fdca155, heads(16, 16, 16, 16, 16, 16, 16, 16, 16, 16)).map((f) => f.code)).toEqual(["ratio-over"]); // 103%
  });

  it("absent changes nothing, and the load ceiling stays the outdoor's own top", () => {
    const plain = kxOdu("FDC140KXZEN1-W", 140, 14);
    expect(ratioTier(plain, 10)).toBeNull();
    expect(checkVrfSet(pack, plain, heads(20, 20, 20, 20, 20, 20, 20, 20, 20))).toEqual([]);
    // fewer, bigger heads still reach 150%, so that is the most it can carry
    expect(vrfLoadCeilingKw(fdc140, "cooling")).toBe(vrfLoadCeilingKw(plain, "cooling"));
    for (const o of pack.outdoor_units) expect(o.ratio_max_pct_by_heads).toBeUndefined();
  });

  it("an 80% bottom is the outdoor's own: 79% is under it, 80% is in", () => {
    // 112 of 140 is 80%; 110 is 79%
    expect(checkVrfSet(pack, fdc140, heads(56, 56))).toEqual([]);
    expect(checkVrfSet(pack, fdc140, heads(55, 55)).map((f) => f.code)).toEqual(["ratio-under"]);
    expect(checkVrfSet(pack, fdc140, heads(55, 55))[0].message).toContain("needs at least 80%");
  });

  it("validates: a tier must lower the top and be reachable", () => {
    const p: DataPack = { ...pack, outdoor_units: [...pack.outdoor_units, { ...fdc140, ratio_max_pct_by_heads: [{ min_heads: 11, max_pct: 160 }] }] };
    const msgs = validatePack(p).errors.map((e) => e.message);
    expect(msgs).toContain("ratio_max_pct_by_heads[0].max_pct 160 doesn't lower ratio_max_pct 150");
    expect(msgs).toContain("ratio_max_pct_by_heads[0].min_heads 11 over max_idus 10");
  });
});
