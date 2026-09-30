/* The build-up's rules, on job 2330 — a 12.5 kW Mitsubishi HAA with five
   zones, as Isaac described it and corrected it (2026-09-30), priced from
   the frozen book the past-job tests use. */
import { ductTrunks, faceVelocity, priceBuildUp, recommendReturn, STANDARD_RETURNS, trunkingLengths, wallBracketCode } from "../buildup";
import { ductedLines, plenumRunFittings, type DuctedFacts, type PriceOf } from "../ducted-template";
import { splitLines, splitVisits } from "../split-template";
import { PAST_JOBS } from "./fixtures/past-jobs";
import { PAST_JOBS_BOOK } from "./fixtures/past-jobs-book";

const priceOf: PriceOf = (code) => {
  const b = PAST_JOBS_BOOK[code];
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
