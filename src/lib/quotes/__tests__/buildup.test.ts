/* The build-up against a real job: 2330, a 12.5 kW Mitsubishi HAA with five
   zones, as Isaac described it and corrected it (2026-09-30), priced at the
   price book's figures that day. */
import { ductTrunks, faceVelocity, priceBuildUp, recommendReturn, STANDARD_RETURNS, trunkingLengths, wallBracketCode } from "../buildup";
import { ductedLines, type DuctedFacts, type PriceOf } from "../ducted-template";

const BOOK: Record<string, [string, number]> = {
  "PEA-M125HAA": ["mitsubishi", 106750],
  "PUZ-ZM125VKA2-A.TH": ["mitsubishi", 247730],
  "PAC-ZC80L-E": ["aad", 48704],
  "PAC-ZC10L240C-A": ["mitsubishi", 57820],
  "PAC-ZC04L240C-A": ["mitsubishi", 40880],
  "PAR-ZM01A-A": ["mitsubishi", 25200],
  "PAR-ZR01R-A": ["mitsubishi", 6860],
  "PAR-ZR01S-A": ["mitsubishi", 5530],
  MDM250L: ["aad", 6296],
  RZCAB12: ["aad", 1185],
  NCMIT100HAA: ["aad", 16254],
  MB141210: ["aad", 2759],
  MY121010: ["aad", 2275],
  MY141010: ["aad", 2568],
  VB350: ["aad", 4034],
  VB300: ["aad", 3564],
  VB250: ["aad", 3045],
  VB400: ["aad", 4596],
  BG10514: ["aad", 6512],
  CHB10514: ["aad", 6313],
  "AFLBG-1.5": ["airfoil", 17857],
  "JH-LBOX-1.5": ["sheet_metal_fabricator", 13000],
  NECF9055: ["aad", 7966],
  "MRA9055-40X2": ["aad", 5446],
  "9800008-1": ["reece", 27387],
  "CAB6-0TCE": ["aad", 47802],
  "2706201-2": ["reece", 303],
  "3209006-1": ["reece", 2828],
  "3421175-1": ["reece", 3137],
  CWBX: ["aad", 4865],
  CWB180: ["aad", 3079],
  "1610375-1": ["reece", 3614],
  "8002396-1": ["reece", 1500],
};
const priceOf: PriceOf = (code) => (BOOK[code] ? { supplierKey: BOOK[code]![0], buyCents: BOOK[code]![1], name: code } : null);

const job2330: DuctedFacts = {
  indoor: "PEA-M125HAA",
  outdoor: "PUZ-ZM125VKA2-A.TH",
  outdoorWidthMm: 1050,
  outdoorWeightKg: 114,
  threePhase: false,
  noseCone: "NCMIT100HAA",
  zones: 5,
  zoneMm: 250,
  zoning: "me24",
  grilles: "stock",
  airflowLs: 1000,
  pipeM: null,
  pairCoil: { code: "9800008-1", perMetreCents: 27387 / 20 },
  powerM: null,
  interconnectM: null,
  trunkingM: 9.6,
};

describe("job 2330", () => {
  it("builds every line from the price book, nothing missing", () => {
    const r = ductedLines(job2330, priceOf);
    expect(r.missing).toEqual([]);
    expect(r.returnSize).toEqual({ wMm: 900, hMm: 550 });
    expect(r.returnMs).toBe(2);
    expect(r.lines.find((l) => l.key === "bracket")?.code).toBe("CWBX");
    expect(r.lines.some((l) => /drip tray/i.test(l.name))).toBe(false);
    expect(r.lines.find((l) => l.key === "pair-coil")?.assumed).toBe("15 m");
  });

  it("prices to $15,185 ex GST with one 5-person, 9-hour install day and the duct contingency", () => {
    const b = priceBuildUp(ductedLines(job2330, priceOf).lines, [{ stage: "Install", people: 5, hours: 9 }]);
    expect(b.contingency).toEqual({ buyCents: 20011, sellCents: 28015, hours: 2 });
    expect(b.labour.hours).toBe(47);
    expect(b.labour.sellCents).toBe(658000);
    expect(Math.abs(b.exGstCents - 1518527)).toBeLessThanOrEqual(3);
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

  it("brackets by size and trunking by whole lengths", () => {
    expect(wallBracketCode(1050, 114)).toBe("CWBX");
    expect(wallBracketCode(800, 60)).toBe("CWB180");
    expect(trunkingLengths(3.6)).toBe(2);
    expect(trunkingLengths(9.6)).toBe(4);
  });
});
