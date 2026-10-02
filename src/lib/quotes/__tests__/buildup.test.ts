/* The build-up's rules, on job 2330 — a 12.5 kW Mitsubishi HAA with five
   zones, as Isaac described it and corrected it (2026-09-30), priced from
   the frozen book the past-job tests use. */
import { customerBreakdown, DEFAULT_BUILD_SETTINGS, ductTrunks, faceVelocity, priceBuildUp, recommendReturn, STANDARD_RETURNS, trunkingLengths, wallBracketCode } from "../buildup";
import { brandOf, ductedLines, ductedVisits, plenumRunFittings, suggestedCrew, type DuctedFacts, type PriceOf } from "../ducted-template";
import { multiLines, multiVisits } from "../multi-template";
import { splitLines, splitVisits } from "../split-template";
import { PAST_JOBS } from "./fixtures/past-jobs";
import { BLIND_JOBS_BOOK } from "./fixtures/blind-jobs-book";
import { PAST_JOBS_BOOK } from "./fixtures/past-jobs-book";

const priceOf: PriceOf = (code) => {
  const b = PAST_JOBS_BOOK[code] ?? BLIND_JOBS_BOOK[code];
  return b ? { supplierKey: b[0], buyCents: b[1], name: b[2] } : null;
};
const job2330 = PAST_JOBS.find((j) => j.job === "2330")!.facts as DuctedFacts;

describe("job 2330", () => {
  it("builds every line from the price book, nothing missing", () => {
    const r = ductedLines(job2330, priceOf);
    expect(r.missing).toEqual([]);
    expect(r.returnSize).toEqual({ wMm: 900, hMm: 550 });
    expect(r.returnMs).toBe(2);
    expect(r.lines.find((l) => l.key === "bracket")?.code).toBe("CWBX");
    expect(r.lines.some((l) => /drip tray/i.test(l.name))).toBe(false);
    expect(r.lines.find((l) => l.key === "pair-coil")).toMatchObject({ code: "PC3858", qty: 1, assumed: "15 m, one 20 m roll" });
  });

  it("prices labour by the person-day, and the contingency's hours by the hour", () => {
    const b = priceBuildUp(ductedLines(job2330, priceOf).lines, [{ stage: "Install", people: 5, days: 1 }]);
    expect(b.contingency).toEqual({ buyCents: 20011, sellCents: 28015, hours: 2 });
    expect(b.labour).toMatchObject({ personDays: 5, hours: 2, sellCents: 5 * 132000 + 2 * 14000 });
    expect(b.incGstCents - b.exGstCents).toBe(b.gstCents);
  });

  it("a hard job's loading goes on the visits' labour, and only with a reason", () => {
    const lines = ductedLines(job2330, priceOf).lines;
    const visits = [{ stage: "Install" as const, people: 5, days: 1 }, { stage: "Fit-off" as const, people: 2, days: 1 }];
    const plain = priceBuildUp(lines, visits);
    const loaded = priceBuildUp(lines, visits, undefined, { pct: 15, reason: "scissor lift, commercial ductwork" });
    expect(loaded.loading).toEqual({ pct: 15, reason: "scissor lift, commercial ductwork", sellCents: Math.round(7 * 132000 * 0.15) });
    expect(loaded.exGstCents - plain.exGstCents).toBe(138600);
    expect(priceBuildUp(lines, visits, undefined, { pct: 15, reason: " " }).loading).toBeNull();
  });

  it("the linear kit brings its receiver, a sensor and batteries per zone", () => {
    const r = ductedLines({ ...job2330, zoning: "meLinear" }, priceOf);
    const codes = r.lines.map((l) => [l.code ?? l.key, l.qty]);
    expect(codes).toEqual(expect.arrayContaining([["PAC-ZC10L240C-A", 1], ["PAR-ZM01A-A", 1], ["PAR-ZR01R-A", 1], ["PAR-ZR01S-A", 5], ["zone-batteries", 5]]));
  });

  it("custom grilles bring their JH box, and three phase brings the 4-pole isolator", () => {
    const r = ductedLines({ ...job2330, grilles: "custom", threePhase: true }, priceOf);
    expect(r.lines.find((l) => l.key === "grille-boxes")?.code).toBe("JH-LBOX-1.5");
    expect(r.lines.find((l) => l.key === "isolator")?.code).toBe("3421175-1");
  });

  it("with no zone kit the unit gets its own wall controller", () => {
    const r = ductedLines({ ...job2330, zoning: "none" }, priceOf);
    expect(r.lines.find((l) => l.key === "controller")?.code).toBe("PAR-41MAAM");
    expect(r.lines.some((l) => l.key === "zone-dampers")).toBe(false);
  });
});

describe("Isaac's standard ducted kit", () => {
  it("feeds six cone diffusers from two plenums, three BTOs a run", () => {
    const r = ductedLines({ ...job2330, supply: "plenums", grilles: "cone", outlets: 6, mount: "ground" }, priceOf);
    const qty = (code: string) => r.lines.filter((l) => l.code === code).reduce((a, l) => a + l.qty, 0);
    expect(r.lines.find((l) => l.key === "plenums")?.qty).toBe(2);
    expect([qty("MB141412"), qty("MB141410"), qty("MB141010")]).toEqual([2, 2, 2]);
    expect([qty("VB400"), qty("VB350"), qty("VB300"), qty("VB250")]).toEqual([2, 2, 2, 6]);
    expect(qty("CD250")).toBe(6);
    expect(qty("CMADJ")).toBe(1);
    expect(r.lines.some((l) => l.code === "BG10514" || l.code === "NCMIT100HAA")).toBe(false);
  });

  it("splits the outlets across the runs, three at most on each", () => {
    expect(plenumRunFittings(3)).toEqual(["MB141412", "MB141410", "MB141010"]);
    expect(plenumRunFittings(2)).toEqual(["MB141410", "MB141010"]);
    const r = ductedLines({ ...job2330, supply: "plenums", outlets: 8 }, priceOf);
    expect(r.lines.find((l) => l.key === "plenums")?.qty).toBe(3);
  });
});

describe("a swap into the old system", () => {
  it("keeps what the scope keeps, recovers the old refrigerant, and has no duct contingency", () => {
    const r = ductedLines({ ...job2330, trunkingM: null, reuse: { pipe: true, ductwork: true }, replacing: true }, priceOf);
    const keys = r.lines.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["reconnect", "flush", "recovery"]));
    expect(keys.some((k) => /^(fitting|flex|grilles|return|nose-cone|pair-coil|trunking)/.test(k))).toBe(false);
    expect(priceBuildUp(r.lines, ductedVisits({ reuse: { ductwork: true } })).contingency).toBeNull();
    const unflushed = ductedLines({ ...job2330, reuse: { pipe: true, flush: false, ductwork: true } }, priceOf);
    expect(unflushed.lines.some((l) => l.key === "flush")).toBe(false);
  });

  it("takes three for the day, a fourth for new zone motors, and a rough-in or second floor adds a pair", () => {
    const pd = (f: Parameters<typeof ductedVisits>[0]) => ductedVisits(f).reduce((a, v) => a + v.people * v.days, 0);
    expect(pd({})).toBe(4);
    expect(pd({ reuse: { ductwork: true } })).toBe(3);
    expect(pd({ reuse: { ductwork: true }, zoning: "me24" })).toBe(4);
    expect(pd({ newBuild: true })).toBe(6);
    expect(pd({ storeys: 2 })).toBe(6);
  });
});

describe("a multi-split", () => {
  const head = (indoor: string, kw: number) => ({ indoor, kw, pipe: "1/4+3/8" as const });
  it("runs a pipe, trunking and consumables to each head, the outdoor's kit once", () => {
    const r = multiLines({ outdoor: "MXZ-3F54VGD-A2", heads: [head("MSZ-AP25VGKD2-A2", 2.5), head("MSZ-AP42VGKD2-A2", 4.2)], newCircuit: true }, priceOf);
    expect(r.lines.filter((l) => l.key.startsWith("pair-coil")).map((l) => l.qty)).toEqual([10, 10]);
    expect(r.lines.find((l) => l.key === "trunking")?.qty).toBe(3);
    expect(r.lines.find((l) => l.key === "consumables")?.qty).toBe(2);
    expect(r.lines.filter((l) => l.key === "isolator" || l.key === "mount").length).toBe(2);
    expect(r.lines.find((l) => l.key === "circuit")).toBeTruthy();
  });

  it("takes a day for the outdoor and half a day a head", () => {
    const pd = (n: number) => multiVisits({ heads: Array.from({ length: n }, () => head("x", 2.5)) }).reduce((a, v) => a + v.people * v.days, 0);
    expect([pd(2), pd(3), pd(4), pd(5)]).toEqual([2, 2.5, 3, 3.5]);
  });
});

describe("the wall-split kit", () => {
  const f = { indoor: "MSZ-AP42VGKD2-A2", outdoor: "MUZ-AP42VGD2-A2", kw: 4.2, pipe: "1/4+3/8" as const };
  it("carries what every one of Isaac's split quotes carries", () => {
    const r = splitLines(f, priceOf);
    expect(r.missing).toEqual([]);
    expect(r.lines.map((l) => [l.key, l.qty])).toEqual([
      ["indoor", 1],
      ["outdoor", 1],
      ["pair-coil", 7],
      ["isolator", 1],
      ["mount", 1],
      ["trunking", 1.5],
      ["consumables", 1],
    ]);
    expect(r.lines.find((l) => l.key === "pair-coil")?.unitBuyCents).toBeCloseTo(15747 / 20);
  });

  it("goes on the wall bracket by size, and brings a pump only when asked", () => {
    const r = splitLines({ ...f, mount: "wall", outdoorWidthMm: 800, outdoorWeightKg: 40, pump: true }, priceOf);
    expect(r.lines.find((l) => l.key === "bracket")?.code).toBe("CWB180");
    expect(r.lines.find((l) => l.key === "pump")?.code).toBe("MINIAQUA");
  });

  it("takes 1.5 person-days up to a 3.5 kW, 2 above, half a day less back to back", () => {
    const days = (kw: number, backToBack = false) => splitVisits({ kw, backToBack }).reduce((a, v) => a + v.people * v.days, 0);
    expect([days(2.5), days(3.5), days(4.2), days(7.1)]).toEqual([1.5, 1.5, 2, 2]);
    expect([days(2.5, true), days(4.8, true)]).toEqual([1, 1.5]);
  });

  it("goes by the crew the brief names: one installer puts a 4.2 kW at about $3,600, two higher", () => {
    const days = (crew: 1 | 2) => splitVisits({ kw: 4.2, crew }).reduce((a, v) => a + v.people * v.days, 0);
    expect([days(1), days(2)]).toEqual([1.5, 2]);
    const price = (crew: 1 | 2) => priceBuildUp(splitLines(f, priceOf).lines, splitVisits({ kw: 4.2, crew })).exGstCents;
    expect(Math.round(price(1) / 100)).toBe(3697);
    expect(Math.round(price(2) / 100)).toBe(4357);
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

describe("2749, a Daikin apartment changeover", () => {
  const daikin: PriceOf = (code) =>
    ({ BRC1E63: { supplierKey: "aad", buyCents: 10101, name: "DAI WIRED 7 DAY PROG CONTROL" }, "JH-ACCESS": { supplierKey: "jh", buyCents: 4500, name: "ACCESS PANEL" } })[code] ?? priceOf(code);
  const swap = { ...job2330, indoor: "FDYAN71AV1", outdoor: "RZAC71C2V1", zoning: "none" as const, zones: 0, reuse: { ductwork: true }, replacing: true };

  it("tells a Daikin from a Mitsubishi by the indoor's code", () => {
    expect(brandOf("FDYAN71AV1")).toBe("daikin");
    expect(brandOf("PEA-M125HAA")).toBe("mitsubishi");
  });

  it("gives a Daikin its own wall controller, and flags a zone kit it hasn't got", () => {
    expect(ductedLines(swap, daikin).lines.find((l) => l.key === "controller")?.code).toBe("BRC1E63");
    expect(ductedLines(job2330, daikin).lines.find((l) => l.key === "controller")).toBeUndefined();
    expect(ductedLines({ ...swap, zoning: "me24", zones: 4 }, daikin).missing.join()).toMatch(/Daikin/);
  });

  it("takes the crew the brief names, over the suggestion", () => {
    expect(suggestedCrew({ reuse: { ductwork: true } })).toBe(3);
    const pd = (f: Parameters<typeof ductedVisits>[0]) => ductedVisits(f).reduce((a, v) => a + v.people * v.days, 0);
    expect(pd({ reuse: { ductwork: true }, crew: 5 })).toBe(5);
    expect(pd({ crew: 5 })).toBe(5);
  });

  it("adds a return visit only when the job needs one", () => {
    expect(ductedVisits({ reuse: { ductwork: true } }).some((v) => v.stage === "Return")).toBe(false);
    expect(ductedVisits({ reuse: { ductwork: true }, returnDays: 0.5 }).at(-1)).toEqual({ stage: "Return", people: 1, days: 0.5 });
  });

  it("a swap can still take a new plenum and an access panel", () => {
    const keys = ductedLines({ ...swap, swapNew: { plenum: true, accessPanel: true } }, daikin).lines.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["reconnect", "plenum", "access-panel"]));
  });
});

describe("a price offered below the build-up", () => {
  const lines = () => ductedLines(job2330, priceOf).lines;
  const visits = [{ stage: "Install" as const, people: 4, days: 1 }];

  it("needs a reason, and shows what it gives away", () => {
    const full = priceBuildUp(lines(), visits);
    const offered = priceBuildUp(lines(), visits, undefined, null, { exGstCents: 990000, reason: "priced low to win it" });
    expect(offered.exGstCents).toBe(990000);
    expect(offered.buildExGstCents).toBe(full.exGstCents);
    expect(offered.offered?.discountCents).toBe(full.exGstCents - 990000);
    const bare = priceBuildUp(lines(), visits, undefined, null, { exGstCents: 990000, reason: "" });
    expect(bare.exGstCents).toBe(full.exGstCents);
    expect(bare.offeredNeedsReason).toBe(true);
  });

  it("a loading with no reason says so rather than vanishing", () => {
    expect(priceBuildUp(lines(), visits, undefined, { pct: 15, reason: "" }).loadingNeedsReason).toBe(true);
  });
});

describe("what the customer sees in a breakdown", () => {
  const lines = ductedLines(job2330, priceOf).lines;
  const visits = [{ stage: "Install" as const, people: 5, days: 1 }];

  it("spreads the loading, contingency and a discount across the lines, summing to the cent", () => {
    const b = priceBuildUp(lines, visits, undefined, { pct: 15, reason: "hard access" }, { exGstCents: 1_200_000, reason: "to win it" });
    const c = customerBreakdown(b);
    expect(c.lines.reduce((a, l) => a + l.sellCents, 0)).toBe(b.exGstCents);
    expect(c.lines.some((l) => /loading|difficulty|contingency|discount/i.test(l.name))).toBe(false);
    expect(c.hiddenCents).not.toBe(0);
  });

  it("leaves the lines as priced when nothing is hidden", () => {
    const b = priceBuildUp(lines, visits, { ...DEFAULT_BUILD_SETTINGS, contingencyOn: false });
    const c = customerBreakdown(b);
    expect(c.hiddenCents).toBe(0);
    expect(c.lines.reduce((a, l) => a + l.sellCents, 0)).toBe(b.exGstCents);
  });

  it("a wall split carries no contingency row", () => {
    const split = priceBuildUp(splitLines({ indoor: "MSZ-AP42VGKD2-A2", outdoor: "MUZ-AP42VGD2-A2", kw: 4.2, pipe: "1/4+3/8" }, priceOf).lines, splitVisits({ kw: 4.2 }));
    expect(split.contingency).toBeNull();
  });
});
