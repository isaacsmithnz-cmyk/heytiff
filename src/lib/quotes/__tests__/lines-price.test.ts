import type { BuildSettings } from "../buildup";
import type { QuoteLine } from "../lines";
import { priceLines, stillUnknown } from "../lines-price";

/* A quote switched to the rebuild, priced from its kept lines (slice 2.2),
   on 3377's own figures: Diamond Air's 25% on units, 40% on materials,
   $140 an hour, an 8-hour day. */

const s: BuildSettings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
let n = 0;
const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: `l${n++}`,
  version: 1,
  updatedAt: "",
  updatedBy: "isaac",
  optionIndex: 0,
  system: "Downstairs",
  group: "Units",
  position: n,
  name: "x",
  code: null,
  supplierKey: null,
  kind: "material",
  qty: 1,
  unit: "",
  costCents: 0,
  sellCents: null,
  source: "by_hand",
  why: "",
  duct: false,
  ...o,
});

const indoor = line({ name: "Ducted indoor, under the floor", code: "PEA-M125HAA", supplierKey: "mitsubishi", kind: "unit", costCents: 106750, source: "said" });
const tps = line({ group: "Pipe, power and controls", name: "TPS 6 mm²", code: "CBT6TEWH", supplierKey: "rexel", qty: 25, unit: "m", costCents: 475 });
const install = line({ group: "Labour", name: "Install, two ducted systems", kind: "labour", qty: 80, unit: "h", costCents: 11200, source: "assumed" });
const core = line({ system: "Core holes", group: "Core holes", name: "Core hole 200 mm through sandstone", qty: 1, source: "unknown", why: "“a 200 mm core hole through thick sandstone”" });

it("sells a part at the business's markup, and labour at its rate, as the old engine would", () => {
  const [o] = priceLines([indoor, tps, install], [], s, { pct: null, labourCostCents: null });
  expect(o!.build.groups.find((g) => g.name === "Units")!.sellCents).toBe(133438);
  expect(o!.build.groups.find((g) => g.name === "Pipe, power and controls")!.sellCents).toBe(16625);
  expect(o!.build.labour.sellCents).toBe(80 * 14000);
  expect(o!.build.exGstCents).toBe(133438 + 16625 + 1_120_000);
  expect(o!.labourFrom).toBe("you");
  expect(o!.profit).toBeNull();
});

it("sells at the price a person set, and keeps qty × each", () => {
  const [o] = priceLines([{ ...tps, sellCents: 495.6 }, { ...install, sellCents: 15000 }], [], s, { pct: null, labourCostCents: null });
  expect(o!.build.groups[0]!.sellCents).toBe(12390);
  expect(o!.build.labour.sellCents).toBe(80 * 15000);
});

it("a line nobody knows the price of is still to price, never a $0 line", () => {
  expect(stillUnknown(core)).toBe(true);
  const [o] = priceLines([indoor, core], [], s, { pct: null, labourCostCents: null });
  expect(o!.unpriced).toEqual([{ name: "Core hole 200 mm through sandstone", qty: "1", why: "“a 200 mm core hole through thick sandstone”" }]);
  expect(o!.build.groups.map((g) => g.name)).toEqual(["Units"]);
  expect(o!.rows).toBe(2);
  expect(o!.labourFrom).toBe("none");
  /* priced once it has one */
  expect(priceLines([indoor, { ...core, sellCents: 130000 }], [], s, { pct: null, labourCostCents: null })[0]!.unpriced).toEqual([]);
});

it("each option is its own lines, named from the proposal or counted", () => {
  const out = priceLines([indoor, { ...indoor, id: "o2", optionIndex: 1, costCents: 200000 }], ["Mitsubishi zoning"], s, { pct: null, labourCostCents: null });
  expect(out.map((o) => o.name)).toEqual(["Mitsubishi zoning", "Option 2"]);
  expect(out[1]!.build.exGstCents).toBe(250000);
});

it("its profit is the price less every line's own cost, against the target", () => {
  const [o] = priceLines([indoor, tps, install], [], s, { pct: 20, labourCostCents: null });
  const cost = 106750 + 475 * 25 + 80 * 11200;
  expect(o!.profit).toMatchObject({ costCents: cost, profitCents: o!.build.exGstCents - cost, targetPct: 20, hourCostCents: 11200 });
});

it("costs the duct contingency's share at buy and its hours at the business's hour", () => {
  const flex = line({ group: "Ductwork and grilles", name: "Flex 200", qty: 6, costCents: 2489, duct: true });
  const [o] = priceLines([flex], [], { ...s, contingency: { pct: 15, hours: 3 } }, { pct: 20, labourCostCents: null });
  expect(o!.build.contingency).toMatchObject({ buyCents: 2240, hours: 3 });
  expect(o!.profit!.costCents).toBe(2489 * 6 + 2240 + 3 * 11200);
});
