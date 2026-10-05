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
      { name: "ø9.52 / ø15.88 pair coil", qty: "10 m", why: "Choose your pair coil 3/8 + 5/8 in Quoting" },
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

describe("a kit's rows", () => {
  const kitDeps: JobPriceDeps = {
    ...deps,
    component: (key) =>
      key === "pipe_cover"
        ? { perUnitCents: 3614, supplierKey: "x", code: "COVER-2.4", name: "PIPE COVER 2.4M", lengthM: 2.4 }
        : key === "ground_mount"
          ? { perUnitCents: 1372, supplierKey: "x", code: "PAD", name: "GROUND PAD" }
          : null,
    allowance: (k) => (k === "consumables" ? 3182 : null),
  };
  const { lines, unpriced } = priceJobList(
    [
      { name: "Ground mount", sub: "for the outdoor's 840 mm, 53 kg, Living", qty: "1" },
      { name: "Pipe cover", sub: "along the run, Living", qty: "6 m" },
      { name: "Consumables", sub: "a head, Living", qty: "1" },
      { name: "New circuit", sub: "Living", qty: "1" },
      { name: "Drain hose", sub: "along the run, Living", qty: "6 m" },
      { name: "Outdoor mount", sub: "Bed 2", qty: "Where it sits: ask" },
    ],
    kitDeps
  );

  it("prices each part by the business's own item, pipe cover in its whole lengths, and an allowance at its own figure", () => {
    expect(lines.map((l) => [l.name, l.code, l.qty, l.unitBuyCents])).toEqual([
      ["Ground mount", "PAD", 1, 1372],
      ["Pipe cover", "COVER-2.4", 3, 3614],
      ["Consumables", null, 1, 3182],
    ]);
  });

  it("says what to set, and what to ask — never a figure of its own", () => {
    expect(unpriced).toEqual([
      { name: "New circuit", qty: "1", why: "Set your new circuit allowance in Quoting" },
      { name: "Drain hose", qty: "6 m", why: "Choose your drain hose in Quoting" },
      { name: "Outdoor mount", qty: "Where it sits: ask", why: "Where the outdoor sits isn't known yet: ask" },
    ]);
  });
});

/* Isaac, 2026-10-05: "Anything that's a pair should come from one
   supplier, not mix and match" — a system's indoor and outdoor are bought
   together, never the head from one wholesaler and the outdoor from another. */
describe("a system's units", () => {
  type Offers = Record<string, { supplierKey: string; supplierName: string; buyCents: number; code: string }[]>;
  const depsFor = (offers: Offers, pick: Record<string, string> = {}): JobPriceDeps => ({
    priceOf: () => null,
    component: () => null,
    unitOffers: (model) => (offers[model] ?? []).map((o) => ({ ...o, name: model })),
    /* the business's own pick for a model, else its cheapest */
    unitOffer: (model) => {
      const list = (offers[model] ?? []).map((o) => ({ ...o, name: model })).sort((a, b) => a.buyCents - b.buyCents);
      const own = list.find((o) => o.supplierKey === pick[model]);
      return own ? { ...own, chosen: true } : (list[0] ?? null);
    },
  });
  const pair = [
    { name: "MSZ-AP50VGD", sub: "wall indoor unit, Lounge", qty: "1", system: 1 },
    { name: "MUZ-AP50VG", sub: "Outdoor unit, Lounge", qty: "1", system: 1 },
  ];
  const fromOf = (lines: ReturnType<typeof priceJobList>["lines"]) => lines.map((l) => [l.name, l.supplierKey, l.unitBuyCents, l.because ?? null]);

  it("come from the one supplier with them all at the lowest total, though another is cheaper for one", () => {
    const { lines } = priceJobList(
      pair,
      depsFor({
        /* AAD's head is cheaper, Mitsubishi's outdoor is: together Mitsubishi's pair is $1,410, AAD's $1,450 */
        "MSZ-AP50VGD": [
          { supplierKey: "aad", supplierName: "AAD", buyCents: 50000, code: "MSZ-AP50VGD" },
          { supplierKey: "mitsubishi", supplierName: "Mitsubishi Electric", buyCents: 52000, code: "MSZ-AP50VGD-A1" },
        ],
        "MUZ-AP50VG": [
          { supplierKey: "aad", supplierName: "AAD", buyCents: 95000, code: "MUZ-AP50VG" },
          { supplierKey: "mitsubishi", supplierName: "Mitsubishi Electric", buyCents: 89000, code: "MUZ-AP50VG-A1" },
        ],
      })
    );
    expect(fromOf(lines)).toEqual([
      ["MSZ-AP50VGD", "mitsubishi", 52000, null],
      ["MUZ-AP50VG", "mitsubishi", 89000, null],
    ]);
    expect(lines[0]!.supplierName).toBe("Mitsubishi Electric");
  });

  it("follow the business's own pick for one of them when that supplier has both", () => {
    const offers: Offers = {
      "MSZ-AP50VGD": [
        { supplierKey: "aad", supplierName: "AAD", buyCents: 50000, code: "A1" },
        { supplierKey: "reece", supplierName: "Reece", buyCents: 60000, code: "R1" },
      ],
      "MUZ-AP50VG": [
        { supplierKey: "aad", supplierName: "AAD", buyCents: 90000, code: "A2" },
        { supplierKey: "reece", supplierName: "Reece", buyCents: 99000, code: "R2" },
      ],
    };
    const { lines } = priceJobList(pair, depsFor(offers, { "MUZ-AP50VG": "reece" }));
    expect(fromOf(lines)).toEqual([
      ["MSZ-AP50VGD", "reece", 60000, null],
      ["MUZ-AP50VG", "reece", 99000, null],
    ]);
  });

  it("come from the supplier that has them all, never one that has only the head", () => {
    const { lines } = priceJobList(
      pair,
      depsFor({
        "MSZ-AP50VGD": [
          { supplierKey: "reece", supplierName: "Reece", buyCents: 40000, code: "R1" },
          { supplierKey: "aad", supplierName: "AAD", buyCents: 50000, code: "A1" },
        ],
        "MUZ-AP50VG": [{ supplierKey: "aad", supplierName: "AAD", buyCents: 90000, code: "A2" }],
      })
    );
    expect(fromOf(lines)).toEqual([
      ["MSZ-AP50VGD", "aad", 50000, null],
      ["MUZ-AP50VG", "aad", 90000, null],
    ]);
  });

  it("say so when no one supplier has them all, each then at its own price", () => {
    const { lines } = priceJobList(
      pair,
      depsFor({
        "MSZ-AP50VGD": [{ supplierKey: "reece", supplierName: "Reece", buyCents: 40000, code: "R1" }],
        "MUZ-AP50VG": [{ supplierKey: "aad", supplierName: "AAD", buyCents: 90000, code: "A2" }],
      })
    );
    expect(fromOf(lines)).toEqual([
      ["MSZ-AP50VGD", "reece", 40000, "no one supplier has the whole system"],
      ["MUZ-AP50VG", "aad", 90000, "no one supplier has the whole system"],
    ]);
  });

  it("are two systems' own: each system has its own one supplier", () => {
    const offers: Offers = {
      A: [{ supplierKey: "aad", supplierName: "AAD", buyCents: 100, code: "A" }],
      B: [{ supplierKey: "aad", supplierName: "AAD", buyCents: 100, code: "B" }],
      C: [{ supplierKey: "reece", supplierName: "Reece", buyCents: 100, code: "C" }],
      D: [{ supplierKey: "reece", supplierName: "Reece", buyCents: 100, code: "D" }],
    };
    const rows = [
      { name: "A", sub: "wall indoor unit, Bed 1", qty: "1", system: 1 },
      { name: "B", sub: "Outdoor unit, Bed 1", qty: "1", system: 1 },
      { name: "C", sub: "wall indoor unit, Bed 2", qty: "1", system: 2 },
      { name: "D", sub: "Outdoor unit, Bed 2", qty: "1", system: 2 },
    ];
    expect(priceJobList(rows, depsFor(offers)).lines.map((l) => [l.name, l.supplierKey, l.because ?? null])).toEqual([
      ["A", "aad", null],
      ["B", "aad", null],
      ["C", "reece", null],
      ["D", "reece", null],
    ]);
  });
});
