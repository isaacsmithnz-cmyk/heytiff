/* The stepped and whole-length charge methods, pinned to the books that
   print them. Each golden cites the page it was read from; the inputs are the
   book's own columns or worked example, never a figure worked out here. */

import type { AdditionalChargeRule } from "../packs/schema";
import { chargeTableEndM, evaluateAdditionalCharge, pastChargeTable } from "../materials";

const g = (rule: AdditionalChargeRule, liquidLengthM: number, liquidSizeMm?: number) =>
  evaluateAdditionalCharge(rule, { liquidLengthM, ...(liquidSizeMm != null ? { liquidSizeMm } : {}) });

/* ── Daikin SkyAir R32: EDAU282388 p.112, 8-2 ADDING REFRIGERANT ──
   "Length for which additional charging is not required 30 m", then
   40 m or less 0.35 · 50 m or less 0.70 · 60 m or less 1.05 · 75 m or less
   1.40 kg (RZAV71·85·100·125, RZAS71–160, φ9.5 liquid). */
const RZAS: AdditionalChargeRule = {
  method: "stepped_by_length",
  precharged_up_to_m: 30,
  bands: [
    { up_to_m: 40, add_g: 350 },
    { up_to_m: 50, add_g: 700 },
    { up_to_m: 60, add_g: 1050 },
    { up_to_m: 75, add_g: 1400 },
  ],
  liquid_mm: 9.52,
};

/* the same page, the RZAC85·100·125 / RZA71–160 row: 0.35, 0.70, then
   "Impossible" past 50 m */
const RZA: AdditionalChargeRule = {
  method: "stepped_by_length",
  precharged_up_to_m: 30,
  bands: [
    { up_to_m: 40, add_g: 350 },
    { up_to_m: 50, add_g: 700 },
  ],
  liquid_mm: 9.52,
};

describe("stepped_by_length — Daikin EDAU282388 p.112", () => {
  it("nothing to the chargeless 30 m, inclusive", () => {
    expect(g(RZAS, 5, 9.52)).toBe(0);
    expect(g(RZAS, 30, 9.52)).toBe(0);
  });

  it("each band is a fixed amount, inclusive at its top ('40 m or less')", () => {
    expect(g(RZAS, 30.1, 9.52)).toBe(350);
    expect(g(RZAS, 40, 9.52)).toBe(350);
    expect(g(RZAS, 40 + 1e-12, 9.52)).toBe(350); // a measured 40 m stays in its band
    expect(g(RZAS, 40.1, 9.52)).toBe(700);
    expect(g(RZAS, 55, 9.52)).toBe(1050);
    expect(g(RZAS, 75, 9.52)).toBe(1400);
  });

  it("past the last column there is no figure — never the last band carried on", () => {
    expect(g(RZAS, 75.1, 9.52)).toBeNull();
    expect(pastChargeTable(RZAS, { liquidLengthM: 75.1, liquidSizeMm: 9.52 })).toBe(true);
    expect(pastChargeTable(RZAS, { liquidLengthM: 75, liquidSizeMm: 9.52 })).toBe(false);
    // RZA: "Impossible" past 50 m
    expect(g(RZA, 50, 9.52)).toBe(700);
    expect(g(RZA, 51, 9.52)).toBeNull();
    expect(chargeTableEndM(RZA, 9.52)).toBe(50);
  });

  it("the table is printed for φ9.5 liquid: another or an unknown size has no figure", () => {
    expect(g(RZAS, 40, 6.35)).toBeNull();
    expect(g(RZAS, 40)).toBeNull();
    expect(pastChargeTable(RZAS, { liquidLengthM: 99, liquidSizeMm: 6.35 })).toBe(false);
  });

  /* the page's second table, 8-3 COMPLETE RECHARGING: the whole charge by
     length. It is the factory charge (the ≤30 m column) plus the added
     amount, so the two tables pin each other: RZAV/RZAS71 2.60 · 2.95 · 3.30 ·
     3.65 · 4.00, RZAS160 3.90 · 4.25 · 4.60 · 4.95 · 5.30 kg at 30/40/50/60/75 m */
  it.each([
    ["RZAS71", 2600, [2600, 2950, 3300, 3650, 4000]],
    ["RZAS160", 3900, [3900, 4250, 4600, 4950, 5300]],
  ])("%s: factory charge + the added amount is the book's complete recharge", (_odu, factory, totals) => {
    [30, 40, 50, 60, 75].forEach((m, i) => expect(factory + g(RZAS, m, 9.52)!).toBe(totals[i]));
  });

  it("RZA's complete recharge stops where its added amount does (RZA71: 2.60 · 2.95 · 3.30 kg)", () => {
    [30, 40, 50].forEach((m, i) => expect(2600 + g(RZA, m, 9.52)!).toBe([2600, 2950, 3300][i]));
    expect(g(RZA, 60, 9.52)).toBeNull();
  });
});

/* EDAU282420 p.279, the smaller class 50–60 outdoors on φ6.4 liquid:
   30 m chargeless, then 0.20 / 0.40 kg to 40 / 50 m */
it("stepped_by_length — EDAU282420 p.279 RZAV50/60CAV1 on φ6.4", () => {
  const rule: AdditionalChargeRule = {
    method: "stepped_by_length",
    precharged_up_to_m: 30,
    bands: [
      { up_to_m: 40, add_g: 200 },
      { up_to_m: 50, add_g: 400 },
    ],
    liquid_mm: 6.35,
  };
  expect(g(rule, 35, 6.35)).toBe(200);
  expect(g(rule, 50, 6.35)).toBe(400);
  expect(g(rule, 35, 9.52)).toBeNull();
});

/* ── MHI FDCA160/200/250VSA-W: '24 PAC-DB-450, outdoor installation manual
   2.8) Additional refrigerant charge (the supplied extract "FDUA250VH
   FDC250VSA-W.pdf", PDF p.26). Read on the equivalent length
   Le = (length of φ12.7) + 0.52 × (length of φ9.52):
   Le ≤ 30 m 0 · 30 < Le ≤ 40 m 0.44 · ≤ 50 m 1.31 · ≤ 60 m 2.18 · ≤ 70 m 2.85 kg */
const FDCA: AdditionalChargeRule = {
  method: "stepped_by_length",
  precharged_up_to_m: 30,
  bands: [
    { up_to_m: 40, add_g: 440 },
    { up_to_m: 50, add_g: 1310 },
    { up_to_m: 60, add_g: 2180 },
    { up_to_m: 70, add_g: 2850 },
  ],
  length_weights: { "12.7": 1, "9.52": 0.52 },
};

describe("stepped_by_length — MHI PAC-DB-450 (equivalent length Le)", () => {
  it("the book's worked example: FDCA160VSA-W, L(φ12.7) = 35 m → Le 35 m → 0.44 kg", () => {
    expect(g(FDCA, 35, 12.7)).toBe(440);
  });

  it("each band, and nothing past Le 70 m", () => {
    expect(g(FDCA, 30, 12.7)).toBe(0);
    expect(g(FDCA, 45, 12.7)).toBe(1310);
    expect(g(FDCA, 60, 12.7)).toBe(2180);
    expect(g(FDCA, 70, 12.7)).toBe(2850);
    expect(g(FDCA, 70.5, 12.7)).toBeNull();
  });

  it("φ9.52 metres count 0.52 each: 70 m of 9.52 is Le 36.4 m", () => {
    expect(g(FDCA, 57, 9.52)).toBe(0); // Le 29.64
    expect(g(FDCA, 70, 9.52)).toBe(440); // Le 36.4
    expect(chargeTableEndM(FDCA, 9.52)).toBeCloseTo(134.6, 1);
    expect(chargeTableEndM(FDCA, 12.7)).toBe(70);
  });

  it("a size the formula doesn't weigh has no figure", () => {
    expect(g(FDCA, 35, 6.35)).toBeNull();
    expect(g(FDCA, 35)).toBeNull();
    expect(chargeTableEndM(FDCA, 6.35)).toBeNull();
  });
});

/* ── Daikin SkyAir R410A ── */

/* EDAU282226 p.128 (RZQ): "In case of the liquid piping lengths over
   chargeless piping length [30 m], calculate the additional charging
   amount" = L(φ12.7) × 0.12 + L(φ9.5) × 0.059 kg — on the WHOLE length,
   "rounded off in units of 0.1 kg" (p.111) */
const RZQ: AdditionalChargeRule = {
  method: "whole_length_by_liquid_size",
  rates: { "12.7": 120, "9.52": 59 },
  chargeless_up_to_m: 30,
  round_g: 100,
};

/* EDAU282301 p.88 (RZYQ 7–8 HP): R = Σ L × rate per size + A, A = 0.7 kg once
   the piping is over 30 m; rounded off in units of 0.1 kg */
const RZYQ8: AdditionalChargeRule = {
  method: "whole_length_by_liquid_size",
  rates: { "6.35": 22, "9.52": 57, "12.7": 110, "15.88": 170, "19.05": 260, "22.22": 360 },
  plus_past: { over_m: 30, add_g: 700 },
  round_g: 100,
};

describe("whole_length_by_liquid_size — Daikin R410A", () => {
  it("RZQ: nothing to 30 m, then the rate on every metre, not the metres past 30", () => {
    expect(g(RZQ, 30, 12.7)).toBe(0);
    expect(g(RZQ, 40, 12.7)).toBe(4800); // 40 × 0.12 kg
    expect(g(RZQ, 31, 9.52)).toBe(1800); // 1.829 kg → 1.8
    expect(g(RZQ, 50, 9.52)).toBe(3000); // 2.95 kg → 3.0
  });

  it("RZYQ: the rate from the first metre, plus A once over 30 m", () => {
    expect(g(RZYQ8, 20, 9.52)).toBe(1100); // 1.14 kg → 1.1
    expect(g(RZYQ8, 30, 9.52)).toBe(1700); // 1.71, A not yet
    expect(g(RZYQ8, 35, 9.52)).toBe(2700); // 1.995 + 0.7 = 2.695 → 2.7
  });

  it("a size with no rate, or an unknown size, has no figure", () => {
    expect(g(RZQ, 40, 6.35)).toBeNull();
    expect(g(RZQ, 40)).toBeNull();
  });

  it("has no table end", () => {
    expect(pastChargeTable(RZQ, { liquidLengthM: 500, liquidSizeMm: 12.7 })).toBe(false);
    expect(chargeTableEndM(RZQ, 12.7)).toBeNull();
  });
});
