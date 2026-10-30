import { coverName, modelName, shelvesOf, type ShelfDoc } from "../shelves";
import type { KbTagRef } from "../tags";

const tag = (id: string, label: string, kind: KbTagRef["kind"], color = "#2563eb"): KbTagRef => ({ id, label, slug: label.toLowerCase().replace(/\s+/g, "-"), color, kind });
const ME = tag("me", "Mitsubishi Electric", "brand");
const DAIKIN = tag("dk", "Daikin", "brand", "#db2777");
const VRF = tag("vrf", "VRF", "system");
const DUCTED = tag("duct", "Ducted", "system");
const ZONING = tag("zone", "Zoning", "system");
const PIPING = tag("pipe", "Refrigerant Piping", "topic");
const ORG = [ME, DAIKIN, VRF, DUCTED, ZONING, PIPING];
const doc = (id: string, title: string, category = "install", more: Partial<ShelfDoc> = {}): ShelfDoc => ({ id, title, category, source: null, fileName: null, ...more });

describe("a cover's name is the title less its maker and what kind of document it is", () => {
  test.each([
    ["PUMY-SP80-140VYKMD2-A SM UL2023", "Mitsubishi Electric", "PUMY\nSP80–140"],
    ["PUMY-SP80-140VYKMD2-A IM", "Mitsubishi Electric", "PUMY\nSP80–140"],
    ["PEA-M100-160HAA Jan2023", "Mitsubishi Electric", "PEA\nM100–160"],
    ["PUHY-EP-YNW-A IM Jun2020", "Mitsubishi Electric", "PUHY\nEP"],
    ["ME - Zone Wireless Sensor", "Mitsubishi Electric", "Zone Wireless Sensor"],
    ["ME- Zone Wireless Receiver", "Mitsubishi Electric", "Zone Wireless Receiver"],
    ["ME Zone Controller Brochure 2026", "Mitsubishi Electric", "Zone Controller"],
    ["Large Capacity Ducted Systems Flyer 2023-12", "Mitsubishi Electric", "Large Capacity Ducted Systems"],
    ["PAC-MK34BC / PAC-MK54BC branch box installation manual", "Mitsubishi Electric", "PAC\nMK34 / MK54\nbranch box"],
    ["Daikin RZA R32 Ducted", "Daikin", "RZA R32 Ducted"],
    ["Daikin VRV Diagnosis Manual", "Daikin", "VRV"],
  ])("%s", (title, maker, name) => {
    expect(coverName(title, maker)).toBe(name);
  });

  test("nothing left keeps the whole title, and a maker-less title keeps its first word", () => {
    expect(coverName("Service Manual 2024", null)).toBe("Service Manual 2024");
    expect(coverName("Medium wall install SOP", null)).toBe("Medium wall install SOP");
  });
});

describe("shelves", () => {
  const docs = [
    doc("pumy", "PUMY-P200YKMD2-A IM"),
    doc("bbox", "PAC-MK34BC branch box installation manual"),
    doc("zone", "ME - Main Zone Controller"),
    doc("pea", "PEA-M100-160HAA Jan2023", "specs"),
    doc("rza", "Daikin RZA R32 Ducted", "faults"),
    doc("vrv", "Daikin VRV Diagnosis Manual", "faults"),
    doc("sop", "Pump-down before a changeover", "sops"),
  ];
  const tagsOf = { pumy: [ME, VRF], bbox: [ME, VRF, PIPING], zone: [ME, DUCTED, ZONING], pea: [ME, DUCTED], rza: [DAIKIN, DUCTED] };
  const s = shelvesOf(docs, tagsOf, ORG);

  test("a maker's systems that share a document share a shelf, the most used first", () => {
    expect(s.get("pumy")!.shelfName).toBe("Mitsubishi Electric · VRF");
    expect(s.get("pumy")!.systems).toBe("VRF");
    expect(s.get("bbox")!.shelf).toBe(s.get("pumy")!.shelf);
    expect(s.get("zone")!.shelfName).toBe("Mitsubishi Electric · Ducted and zoning");
    expect(s.get("zone")!.systems).toBe("Ducted and zoning");
    expect(s.get("pea")!.shelf).toBe(s.get("zone")!.shelf);
    expect(s.get("pea")!.shelf).not.toBe(s.get("pumy")!.shelf);
  });

  test("one maker's shelf is never another's, though the system is the same", () => {
    expect(s.get("rza")!.shelfName).toBe("Daikin · Ducted");
    expect(s.get("rza")!.shelf).not.toBe(s.get("pea")!.shelf);
  });

  test("a cover is coloured by its maker's tag", () => {
    expect(s.get("pumy")).toMatchObject({ maker: "Mitsubishi Electric", color: "#2563eb", name: "PUMY\nP200" });
    expect(s.get("rza")).toMatchObject({ maker: "Daikin", color: "#db2777", name: "RZA R32 Ducted" });
  });

  test("a document nobody tagged is shelved by the maker its name says", () => {
    expect(s.get("vrv")).toMatchObject({ maker: "Daikin", shelfName: "Daikin", name: "VRV" });
  });

  test("a document with no maker sits on its kind's shelf, in plain", () => {
    expect(s.get("sop")).toMatchObject({ shelf: "kind:sops", shelfName: "Company SOPs", systems: "Company SOPs", maker: null, color: null });
  });
});

describe("modelName", () => {
  it("reads a model code as its series over its size range", () => {
    expect(modelName("PUMY-SP80-140VYKMD2-A")).toBe("PUMY\nSP80–140");
    expect(modelName("PUMY-P250-300YBMD")).toBe("PUMY\nP250–300");
    expect(modelName("PUMY-P200YKMD2-A")).toBe("PUMY\nP200");
  });

  it("is null for a name that isn't one", () => {
    expect(modelName("RZA R32 Ducted")).toBeNull();
    expect(modelName("Zone Wireless Sensor")).toBeNull();
    expect(modelName("VRV")).toBeNull();
  });
});
