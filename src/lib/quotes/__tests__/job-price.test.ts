import { briefVisits, countOf, optionLabour, priceJobList, stillToPrice, type JobPriceDeps } from "../job-price";
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
    const visits = briefVisits({ visits: [{ stage: "Install", people: 2, days: 1, hours: 16 }], personHours: 16, personDays: 2, said: [] }, 8);
    const b = priceBuildUp(lines, visits, { ...ONE_BUSINESS, contingency: null });
    expect(b.labour).toMatchObject({ personDays: 2, sellCents: 2 * 8 * 16500 });
    expect(b.gstCents).toBe(Math.round(b.exGstCents / 10));
    expect(b.incGstCents).toBe(b.exGstCents + b.gstCents);
  });
});

describe("the labour it prices", () => {
  const brief = briefVisits({ visits: [{ stage: "Return", people: 1, days: null, hours: 4 }], personHours: 4, personDays: null, said: [] }, 8);

  it("reads the brief's visits in days, by the business's own day", () => {
    expect(brief).toEqual([{ stage: "Return", people: 1, days: 0.5 }]);
    expect(briefVisits(null, 8)).toEqual([]);
  });

  /* Isaac, 2026-10-05: labour set on an option prices it; Tiff's suggestion
     never does until a person applies it */
  it("is the option's own labour, else the brief's, else none", () => {
    const own = { visits: [{ stage: "Rough-in" as const, people: 2, days: 3 }], from: "tiff" as const };
    expect(optionLabour(own, brief)).toEqual({ visits: own.visits, from: "tiff" });
    expect(optionLabour(null, brief)).toEqual({ visits: brief, from: "brief" });
    expect(optionLabour(null, [])).toEqual({ visits: [], from: "none" });
  });

  it("says labour is still to price when nothing gives it", () => {
    expect(stillToPrice({ unpriced: [], labourFrom: "none", labourCents: 0 })).toEqual([{ name: "Labour", qty: "", why: "Not in the brief, and not set on the option" }]);
    expect(stillToPrice({ unpriced: [], labourFrom: "you", labourCents: 1000 })).toEqual([]);
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

/* Isaac, 2026-10-04: a kit's parts at the size it needs, from the
   business's own range of each (ranges.ts). */
describe("a part that comes in sizes", () => {
  const offer = (code: string, size: object, perUnitCents: number, name = code) => ({ code, size, perUnitCents, supplierKey: "reece", name });
  const isolators = [offer("2P-20", { amps: 20, poles: 2 }, 1828), offer("2P-35", { amps: 35, poles: 2 }, 2828), offer("3P-20", { amps: 20, poles: 3 }, 4436)];
  const flex = [offer("1311402-1", { mm: 250, lengthM: 6 }, 2070, "DUCT FLEXIBLE PLAIN CORE 250MM X 6M (EA)"), offer("VB350", { mm: 350, lengthM: null }, 4034, "VORTEX FLEXIBLE DUCT R1.0 350mm - 14\"")];
  const preferredIsolator = { perUnitCents: 1455, supplierKey: "aad", code: "WPS135", name: "Isolator 35A weatherproof" };
  const withRanges: JobPriceDeps = {
    ...deps,
    component: (key) => (key === "isolator" ? preferredIsolator : null),
    range: (kind) => (kind === "isolator" ? isolators : kind === "flex_duct" ? flex : []),
  };
  const priced = (rows: { name: string; sub: string; qty: string }[], d = withRanges) => priceJobList(rows, d);

  it("takes the isolator for the outdoor's current on its supply", () => {
    const { lines, unpriced } = priced([
      { name: "Isolator", sub: "for the outdoor's 16 A on single phase, Living", qty: "1" },
      { name: "Isolator", sub: "for the outdoor's 28 A on single phase, the ducted system", qty: "1" },
      { name: "Isolator", sub: "for the outdoor's 13 A on three phase, the VRF", qty: "1" },
      { name: "Isolator", sub: "for the outdoor's 40 A on single phase, the VRF", qty: "1" },
    ]);
    expect(lines.map((l) => [l.code, l.unitBuyCents, l.duct])).toEqual([
      ["2P-20", 1828, false],
      ["2P-35", 2828, false],
      ["3P-20", 4436, false],
    ]);
    expect(unpriced).toEqual([{ name: "Isolator", qty: "1", why: "No 40 A on single phase in your isolators" }]);
  });

  it("keeps the preferred isolator while there's no range, or no current to size it by", () => {
    const none = priced([{ name: "Isolator", sub: "for the outdoor's 16 A on single phase, Living", qty: "1" }], { ...withRanges, range: () => [] });
    expect(none.lines.map((l) => l.code)).toEqual(["WPS135"]);
    const unsized = priced([{ name: "Isolator", sub: "Living", qty: "1" }]);
    expect(unsized.lines.map((l) => l.code)).toEqual(["WPS135"]);
  });

  it("buys flexible duct by the bag when it's needed by the metre, and says when a bag's length isn't known", () => {
    const { lines, unpriced } = priced([
      { name: "Trunk Ø250", sub: "the ducted system", qty: "1" },
      { name: "Flexible duct Ø250", sub: "the bedrooms", qty: "14 m" },
      { name: "Flexible duct Ø350", sub: "the trunk", qty: "8 m" },
      { name: "Zone damper Ø250", sub: "a zone", qty: "4" },
      { name: "Zone damper", sub: "a zone", qty: "Size to ask" },
    ]);
    expect(lines.map((l) => [l.name, l.code, l.qty, l.duct])).toEqual([
      ["Trunk Ø250", "1311402-1", 1, true],
      ["Flexible duct Ø250", "1311402-1", 3, true],
    ]);
    expect(unpriced.map((u) => u.why)).toEqual([
      "How long one VORTEX FLEXIBLE DUCT R1.0 350mm - 14\" is isn't in its name",
      "Choose your zone dampers in Quoting",
      "Size isn't in the brief: ask",
    ]);
  });
});

it("says what a unit's order code gives it: the K is Wi-Fi built in", () => {
  const { lines } = priceJobList([{ name: "MSZ-AP71VGD2", sub: "Wall split, 7.1 kW", qty: "1" }], deps);
  expect(lines[0]).toMatchObject({ code: "MSZ-AP71VGKD2-A2", features: ["Wi-Fi built in", "Demand response (DRED) ready"] });
});

it("says what any maker's unit has, from its supplier's description", () => {
  const daikin: JobPriceDeps = {
    ...deps,
    unitOffer: (model) => (model === "RZQ71LV1" ? { buyCents: 250000, supplierKey: "aad", name: "DAIKIN PREMIUM OUT 7.1KW 3PH R32 DRED", code: "RZQ71LV1" } : null),
  };
  const { lines } = priceJobList([{ name: "RZQ71LV1", sub: "Outdoor unit", qty: "1" }], daikin);
  expect(lines[0]!.features).toEqual(["Demand response (DRED) ready"]);
});

it("says what a business's kept code letters give a unit", () => {
  const withLetters: JobPriceDeps = {
    ...deps,
    unitOffer: (model) => (model === "PUMY-P250YKMQ3-A" ? { buyCents: 500000, supplierKey: "mitsubishi", name: "Twin Fan Heat Pump VRF O/U 3 Phase", code: "PUMY-P250YKMQ3-A" } : null),
    codeLetters: [{ family: "PUMY", letter: "Q", meaning: "Quiet mode", example: { with: "PUMY-P200YKMQ3", without: "PUMY-P200YKM3" } }],
  };
  const { lines } = priceJobList([{ name: "PUMY-P250YKMQ3-A", sub: "VRF outdoor unit", qty: "1" }], withLetters);
  expect(lines[0]!.features).toEqual(["Quiet mode"]);
});
