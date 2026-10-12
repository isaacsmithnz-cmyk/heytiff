/* The build-up's rules, on a 12.5 kW Mitsubishi ducted system with five
   zones and on a wall split, each written out as the lines a quote prices,
   at one business's settings. */
import { customerBreakdown, ductTrunks, faceVelocity, priceBuildUp, recommendReturn, STANDARD_RETURNS, trunkingLengths, wallBracketCode, type BuildLine } from "../buildup";
import { ONE_BUSINESS } from "./fixtures/one-business";

const line = (l: Omit<BuildLine, "supplierKey" | "code"> & Partial<BuildLine>): BuildLine => ({ code: null, supplierKey: "aad", ...l });

/* the ducted system: its units, the ductwork and grilles the contingency
   covers, and the pipe that it doesn't */
const DUCTED: BuildLine[] = [
  line({ key: "indoor", group: "Units", name: "PEA-M125HAA", code: "PEA-M125HAA", qty: 1, unitBuyCents: 280000, kind: "unit" }),
  line({ key: "outdoor", group: "Units", name: "PUZ-ZM125YKA2", code: "PUZ-ZM125YKA2", qty: 1, unitBuyCents: 320000, kind: "unit" }),
  line({ key: "flex", group: "Ductwork and grilles", name: "Flex 250", code: "VB250", qty: 6, unitBuyCents: 4200, kind: "material", duct: true }),
  line({ key: "grilles", group: "Ductwork and grilles", name: "Bar grille 1200 × 150", code: "BG12015", qty: 5, unitBuyCents: 9000, kind: "material", duct: true }),
  line({ key: "pair-coil", group: "Pipe, power and controls", name: "Pair coil 3/8 + 5/8", code: "PC3858", qty: 1, unitBuyCents: 15747, kind: "material", assumed: "15 m, one 20 m roll" }),
];

const WALL_SPLIT: BuildLine[] = [
  line({ key: "indoor", group: "Units", name: "MSZ-AP42VGKD2-A2", code: "MSZ-AP42VGKD2-A2", qty: 1, unitBuyCents: 90000, kind: "unit" }),
  line({ key: "outdoor", group: "Units", name: "MUZ-AP42VGD2-A2", code: "MUZ-AP42VGD2-A2", qty: 1, unitBuyCents: 110000, kind: "unit" }),
  line({ key: "pair-coil", group: "Pipe, power and controls", name: "Pair coil 1/4 + 3/8", code: "PC1438", qty: 7, unitBuyCents: 15747 / 20, kind: "material" }),
  line({ key: "trunking", group: "Pipe, power and controls", name: "Trunking 2.4 m", code: "1610375-1", qty: 1.5, unitBuyCents: 3614, kind: "material" }),
];

describe("the build-up", () => {
  it("groups the lines in the order they come, each at its markup", () => {
    const b = priceBuildUp(DUCTED, [], ONE_BUSINESS);
    expect(b.groups.map((g) => [g.name, g.buyCents, g.sellCents])).toEqual([
      ["Units", 600000, 750000],
      ["Ductwork and grilles", 70200, 98280],
      ["Pipe, power and controls", 15747, 22046],
    ]);
  });

  it("prices a person-day as the working day at the charge-out rate, and the contingency's hours at that rate", () => {
    const b = priceBuildUp(DUCTED, [{ stage: "Install", people: 5, days: 1 }], ONE_BUSINESS);
    /* 15% of the $702 of ductwork and grilles, at the materials markup */
    expect(b.contingency).toEqual({ buyCents: 10530, sellCents: 14742, hours: 2 });
    /* a person-day is the business's working hours at its charge-out rate; the contingency's hours at the same rate */
    expect(b.labour).toMatchObject({ personDays: 5, hours: 2, sellCents: 5 * 8 * 16500 + 2 * 16500 });
    expect(b.incGstCents - b.exGstCents).toBe(b.gstCents);
    expect(b.gstCents).toBe(Math.round(b.exGstCents / 10));
  });

  it("a hard job's loading goes on the visits' labour, and only with a reason", () => {
    const visits = [{ stage: "Install" as const, people: 5, days: 1 }, { stage: "Fit-off" as const, people: 2, days: 1 }];
    const plain = priceBuildUp(DUCTED, visits, ONE_BUSINESS);
    const loaded = priceBuildUp(DUCTED, visits, ONE_BUSINESS, { pct: 15, reason: "scissor lift, commercial ductwork" });
    expect(loaded.loading).toEqual({ pct: 15, reason: "scissor lift, commercial ductwork", sellCents: Math.round(7 * 132000 * 0.15) });
    expect(loaded.exGstCents - plain.exGstCents).toBe(138600);
    expect(priceBuildUp(DUCTED, visits, ONE_BUSINESS, { pct: 15, reason: " " }).loading).toBeNull();
  });

  it("only ductwork carries the duct contingency: a wall split, or a swap that keeps its ductwork, has none", () => {
    expect(priceBuildUp(WALL_SPLIT, [{ stage: "Install", people: 2, days: 1 }], ONE_BUSINESS).contingency).toBeNull();
    expect(priceBuildUp(DUCTED.filter((l) => !l.duct), [{ stage: "Install", people: 3, days: 1 }], ONE_BUSINESS).contingency).toBeNull();
  });
});

describe("the layout rules", () => {
  it("steps five 250 zones down as Isaac did on 2330", () => {
    expect(ductTrunks(5)).toEqual([
      { mm: 350, zones: 3, fittings: ["MB141210", "MY121010"] },
      { mm: 350, zones: 2, fittings: ["MY141010"] },
    ]);
    expect(ductTrunks(4).map((t) => t.zones)).toEqual([2, 2]);
    expect(ductTrunks(7).map((t) => t.zones)).toEqual([3, 2, 2]);
  });

  it("recommends the smallest standard return at about 2 m/s", () => {
    expect(recommendReturn(1000, STANDARD_RETURNS)).toEqual({ wMm: 900, hMm: 550 });
    expect(recommendReturn(700, STANDARD_RETURNS)).toEqual({ wMm: 900, hMm: 400 });
    expect(faceVelocity(1000, { wMm: 900, hMm: 400 })).toBeCloseTo(2.78, 2);
  });

  it("brackets by size and trunking by the half length", () => {
    expect(wallBracketCode(1050, 114)).toBe("CWBX");
    expect(wallBracketCode(800, 60)).toBe("CWB180");
    expect(trunkingLengths(3.6)).toBe(1.5);
    expect(trunkingLengths(4.8)).toBe(2);
    expect(trunkingLengths(9.6)).toBe(4);
    expect(trunkingLengths(0)).toBe(0);
  });
});

describe("a price offered below the build-up", () => {
  const visits = [{ stage: "Install" as const, people: 4, days: 1 }];

  it("needs a reason, and shows what it gives away", () => {
    const full = priceBuildUp(DUCTED, visits, ONE_BUSINESS);
    const offered = priceBuildUp(DUCTED, visits, ONE_BUSINESS, null, { exGstCents: 990000, reason: "priced low to win it" });
    expect(offered.exGstCents).toBe(990000);
    expect(offered.buildExGstCents).toBe(full.exGstCents);
    expect(offered.offered?.discountCents).toBe(full.exGstCents - 990000);
    const bare = priceBuildUp(DUCTED, visits, ONE_BUSINESS, null, { exGstCents: 990000, reason: "" });
    expect(bare.exGstCents).toBe(full.exGstCents);
    expect(bare.offeredNeedsReason).toBe(true);
  });

  it("a loading with no reason says so rather than vanishing", () => {
    expect(priceBuildUp(DUCTED, visits, ONE_BUSINESS, { pct: 15, reason: "" }).loadingNeedsReason).toBe(true);
  });
});

describe("what the customer sees in a breakdown", () => {
  const visits = [{ stage: "Install" as const, people: 5, days: 1 }];

  it("spreads the loading, contingency and a discount across the lines, summing to the cent", () => {
    const b = priceBuildUp(DUCTED, visits, ONE_BUSINESS, { pct: 15, reason: "hard access" }, { exGstCents: 1_200_000, reason: "to win it" });
    const c = customerBreakdown(b);
    expect(c.lines.reduce((a, l) => a + l.sellCents, 0)).toBe(b.exGstCents);
    expect(c.lines.some((l) => /loading|difficulty|contingency|discount/i.test(l.name))).toBe(false);
    expect(c.hiddenCents).not.toBe(0);
  });

  it("leaves the lines as priced when nothing is hidden", () => {
    const b = priceBuildUp(DUCTED, visits, { ...ONE_BUSINESS, contingency: null });
    const c = customerBreakdown(b);
    expect(c.hiddenCents).toBe(0);
    expect(c.lines.reduce((a, l) => a + l.sellCents, 0)).toBe(b.exGstCents);
  });
});
