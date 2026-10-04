import { countOf, labourVisits, priceJobList, type JobPriceDeps } from "../job-price";
import { priceBuildUp } from "../buildup";
import { ONE_BUSINESS } from "./fixtures/one-business";

/* Isaac, 2026-10-04: "Switch it on now" — the job's own list at the
   business's own prices; nothing priced on a guess. */

const book: Record<string, { buyCents: number; supplierKey: string; name: string }> = {
  WPS135: { buyCents: 1455, supplierKey: "aad", name: "Isolator 35A weatherproof" },
  "FLEXI-200": { buyCents: 4200, supplierKey: "reece", name: "Flexible duct 200mm x 6m" },
};
const deps: JobPriceDeps = {
  priceOf: (code) => book[code] ?? null,
  unitOffer: (model) => (model === "MSZ-AP71VGD2" ? { buyCents: 40927, supplierKey: "aad", name: "Mitsubishi 7.1 kW head", code: "MSZ-AP71VGKD2-A2" } : null),
  unitProposed: (model) => (model === "MUZ-AP71VG2" ? ["MUZ-AP71VGD2-A2"] : []),
  component: (key) => (key === "pair_coil_14_12" ? { perUnitCents: 955, supplierKey: "aad", code: "PC1412", name: "Pair coil 1/4 + 1/2" } : null),
};

describe("a quantity", () => {
  it("is counted when it can be, and refrigerant isn't", () => {
    expect(countOf("18 m")).toEqual({ n: 18, unit: "m" });
    expect(countOf("3")).toEqual({ n: 3, unit: "each" });
    expect(countOf("1 set")).toEqual({ n: 1, unit: "each" });
    expect(countOf("")).toEqual({ n: 1, unit: "each" });
    expect(countOf("820 g")).toBeNull();
    expect(countOf("—")).toBeNull();
  });
});

describe("the job's list, priced", () => {
  const { lines, unpriced } = priceJobList(
    [
      { name: "MSZ-AP71VGD2", sub: "Wall split, 7.1 kW", qty: "2" },
      { name: "ø6.35 / ø12.7 pair coil", sub: "liquid / gas mm", qty: "18 m" },
      { name: "Isolator", sub: "WPS135, AAD", qty: "2" },
      { name: "Flexi duct", sub: "FLEXI-200, Reece", qty: "4" },
      { name: "ø9.52 / ø15.88 pair coil", sub: "liquid / gas mm", qty: "10 m" },
      { name: "Additional refrigerant", sub: "System 1, beyond pre-charge", qty: "820 g" },
      { name: "Mystery bracket", sub: "", qty: "1" },
      { name: "MUZ-AP71VG2", sub: "outdoor unit, 7.1/8 kW", qty: "1" },
      { name: "ø6.35 / ø12.7 pair coil", sub: "liquid / gas mm, Bed 2", qty: "Run to ask" },
    ],
    deps
  );

  it("prices a unit through its link, a coil by its size, and a part by the code it was added with", () => {
    expect(lines.map((l) => [l.group, l.code, l.qty, l.unitBuyCents, l.kind])).toEqual([
      ["Units", "MSZ-AP71VGKD2-A2", 2, 40927, "unit"],
      ["Materials", "PC1412", 18, 955, "material"],
      ["Materials", "WPS135", 2, 1455, "material"],
      ["Materials", "FLEXI-200", 4, 4200, "material"],
    ]);
    expect(lines.find((l) => l.code === "FLEXI-200")?.duct).toBe(true);
  });

  it("lists what it couldn't price, with why — never a guess", () => {
    expect(unpriced).toEqual([
      { name: "ø9.52 / ø15.88 pair coil", qty: "10 m", why: "No preferred item for it in Quoting" },
      { name: "Additional refrigerant", qty: "820 g", why: "Bought by the bottle, not the gram" },
      { name: "Mystery bracket", qty: "1", why: "Not in your price book" },
      { name: "MUZ-AP71VG2", qty: "1", why: "Confirm its order code (MUZ-AP71VGD2-A2) in Quoting" },
      { name: "ø6.35 / ø12.7 pair coil", qty: "Run to ask", why: "Its length isn't known yet: ask" },
    ]);
  });

  it("adds up at the business's own markups and day, with GST", () => {
    const { visits } = labourVisits(
      { from: "brief", labour: { visits: [{ stage: "Install", people: 2, days: 1, hours: 16 }], personHours: 16, personDays: 2, said: [] } },
      8
    );
    const b = priceBuildUp(lines, visits, { ...ONE_BUSINESS, contingency: null });
    expect(b.labour).toMatchObject({ personDays: 2, sellCents: 2 * 8 * 16500 });
    expect(b.gstCents).toBe(Math.round(b.exGstCents / 10));
    expect(b.incGstCents).toBe(b.exGstCents + b.gstCents);
  });
});

describe("the labour it prices", () => {
  it("is the brief's visits, else the typical hours as one visit at the business's day, else none", () => {
    expect(labourVisits({ from: "brief", labour: { visits: [{ stage: "Return", people: 1, days: null, hours: 4 }], personHours: 4, personDays: null, said: [] } }, 8).visits).toEqual([
      { stage: "Return", people: 1, days: 0.5 },
    ]);
    expect(labourVisits({ from: "history", typical: { kind: "maintenance", hours: 6, jobs: 37, words: "" } }, 7.5).visits).toEqual([
      { stage: "Install", people: 1, days: 0.8 },
    ]);
    expect(labourVisits({ from: "none" }, 8)).toEqual({ visits: [], from: "none" });
  });
});
