import { brandOfCode, fitsBrand, wrongBrand } from "../brand";
import { ductedLines, type DuctedFacts, type PriceOf } from "../ducted-template";
import { multiLines } from "../multi-template";
import { splitLines } from "../split-template";

const book: Record<string, [string, number, string]> = {
  "MSZ-AP25VGKD2-A2": ["aad", 90000, "MSZ-AP25 indoor"],
  "MUZ-AP25VGD2-A2": ["aad", 80000, "MUZ-AP25 outdoor"],
  FDYAN71AV1: ["aad", 93019, "DAIKIN STANDARD DUCT IND 7.1KW R32"],
  RZAC71C2V1: ["aad", 150604, "DAIKIN STANDARD OUT 7.1KW R32 1PH DRED"],
  BRC1E63: ["aad", 10101, "DAI WIRED 7 DAY PROG CONTROL"],
  "PAR-41MAAM": ["aad", 13837, "ME ACC WIRED CONTROLLER W/ BACKLIGHT"],
  "PAC-ZC80L-E": ["aad", 48704, "ME ACC 8 ZONE CONTROLLER 24V"],
  PC1438: ["aad", 12000, "PAIRED COIL 1/4+3/8X20M"],
  CMADJ: ["aad", 1372, "NEOPRENE COND MOUNT ADJUSTABLE NSW"],
  "1610375-1": ["reece", 3614, "SURF MIST METAL TRUNKING 2.4M (EA)"],
};
const priceOf: PriceOf = (code) => (book[code] ? { supplierKey: book[code]![0], buyCents: book[code]![1], name: book[code]![2] } : null);

describe("whose equipment it is", () => {
  it("reads the brand off the model code, or the item's name", () => {
    expect(brandOfCode("MSZ-AP42VGKD2-A2")).toBe("mitsubishi");
    expect(brandOfCode("PAC-ZC80L-E")).toBe("mitsubishi");
    expect(brandOfCode("NCMIT100HAA")).toBe("mitsubishi");
    expect(brandOfCode("FDYAN71AV1")).toBe("daikin");
    expect(brandOfCode("RZAC71C2V1")).toBe("daikin");
    expect(brandOfCode("BRC1E63")).toBe("daikin");
    expect(brandOfCode("XYZ1", "DAI WIRED 7 DAY PROG CONTROL")).toBe("daikin");
  });

  it("leaves ductwork, pipe, dampers and cable neutral", () => {
    for (const c of ["MB141210", "MY121010", "MDM250L", "RZCAB12", "PC1412", "PVC20", "CMADJ", "VB350", "1610375-1", "MINIAQUA", "CAB6-0TCE"]) expect(brandOfCode(c)).toBeNull();
  });

  it("only conflicts when both the system and the part have a brand", () => {
    expect(wrongBrand("daikin", "PAR-41MAAM")).toBe("mitsubishi");
    expect(wrongBrand("daikin", "BRC1E63")).toBeNull();
    expect(wrongBrand(null, "PAR-41MAAM")).toBeNull();
    expect(wrongBrand("daikin", "PC1412")).toBeNull();
    expect(fitsBrand("daikin", ["BRC1E63", "PAR-41MAAM", "PC1412"], (c) => c)).toEqual(["BRC1E63", "PC1412"]);
  });
});

describe("a template never prices another brand's part in", () => {
  const base: DuctedFacts = {
    indoor: "FDYAN71AV1",
    outdoor: "RZAC71C2V1",
    outdoorWidthMm: null,
    outdoorWeightKg: null,
    threePhase: false,
    zones: 0,
    zoneMm: 250,
    zoning: "none",
    grilles: "cone",
    airflowLs: null,
    pipeM: null,
  };

  it("a Mitsubishi outdoor behind a Daikin indoor is left out and named", () => {
    const r = ductedLines({ ...base, outdoor: "PUZ-ZM125VAA" }, (c) => priceOf(c) ?? (c === "PUZ-ZM125VAA" ? { supplierKey: "aad", buyCents: 300000, name: "PUZ outdoor" } : null));
    expect(r.lines.some((l) => l.key === "outdoor")).toBe(false);
    expect(r.missing.join()).toMatch(/PUZ-ZM125VAA is mitsubishi, this is a daikin system/);
  });

  it("a Daikin takes its own controller and none of the zone kit", () => {
    const r = ductedLines({ ...base, zoning: "me24", zones: 4 }, priceOf);
    expect(r.lines.some((l) => ["zone-kit", "zone-controller", "zone-dampers", "controller"].includes(l.key))).toBe(false);
    expect(r.missing.filter((m) => /zone kit for a Daikin/.test(m))).toHaveLength(1);
    expect(ductedLines(base, priceOf).lines.find((l) => l.key === "controller")?.code).toBe("BRC1E63");
  });

  it("a Mitsubishi never gets the Daikin controller", () => {
    const r = ductedLines({ ...base, indoor: "PEA-M125HAA", outdoor: "PUZ-ZM125VAA" }, (c) => priceOf(c) ?? { supplierKey: "aad", buyCents: 100000, name: c });
    expect(r.lines.find((l) => l.key === "controller")?.code).toBe("PAR-41MAAM");
  });

  it("a wall split and a multi drop a head or outdoor of the other brand", () => {
    const s = splitLines({ indoor: "MSZ-AP25VGKD2-A2", outdoor: "RZAC71C2V1", kw: 2.5, pipe: "1/4+3/8" }, priceOf);
    expect(s.lines.some((l) => l.key === "outdoor")).toBe(false);
    expect(s.missing.join()).toMatch(/RZAC71C2V1 is daikin/);
    const m = multiLines({ outdoor: "MUZ-AP25VGD2-A2", heads: [{ indoor: "MSZ-AP25VGKD2-A2", kw: 2.5, pipe: "1/4+3/8" }, { indoor: "FDYAN71AV1", kw: 7.1, pipe: "1/4+3/8" }] }, priceOf);
    expect(m.lines.filter((l) => l.key.startsWith("head-")).map((l) => l.code)).toEqual(["MSZ-AP25VGKD2-A2"]);
    expect(m.missing.join()).toMatch(/FDYAN71AV1 is daikin, this is a mitsubishi system/);
  });
});
