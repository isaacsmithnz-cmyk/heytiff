/* Units by maker, then by type (Isaac, 2026-10-05: "the unit section is
   very messy. Needs to be sorted by brand"), on names as the wholesalers
   and the maker write them. */
import { brandOf, capacityOf, unitFamilyOf, unitPartOf, unitTypeOf, withoutBrand } from "../brands";

describe("brandOf", () => {
  it("reads the maker from a wholesaler's name, its short forms too", () => {
    expect(brandOf("MITSUBISHI ELEC. DUCT OUT 16KW 1P R32")).toBe("Mitsubishi Electric");
    expect(brandOf("MHI AVANTI HWS ODU 3.5KW R32")).toBe("Mitsubishi Heavy Industries");
    expect(brandOf("DAI 4 ZONE CONTROLLER 24V")).toBe("Daikin");
    expect(brandOf("FUJ EXT INPUT/OUTPUT PCB BRACKET DUCTED")).toBe("Fujitsu");
    expect(brandOf("KADEN R32 WHS A/C KSI09 INDOOR 2.6KW V2 (EA)")).toBe("Kaden");
    expect(brandOf("Energy Recovery Lossnay 278 L/s", "LGH-100RVX3-E")).toBe("Mitsubishi Electric");
    expect(brandOf("Wired Controller with Back Light", "PAR-41MAAM", "mitsubishi")).toBe("Mitsubishi Electric");
    expect(brandOf("PAIRED COIL 1/4+1/2X20M", "PC1412", "aad")).toBeNull();
  });

  it("takes the maker's own words off a family's name under its heading", () => {
    expect(withoutBrand("DAI 4 ZONE CONTROLLER 24V", "Daikin")).toBe("4 ZONE CONTROLLER 24V");
    expect(withoutBrand("MITSUBISHI ELEC. HWS IND 4.8KW", "Mitsubishi Electric")).toBe("HWS IND 4.8KW");
  });
});

describe("a unit's type and part", () => {
  it("reads the type from the name or the maker's code", () => {
    expect(unitTypeOf("DAIKIN CORA HWS OUT 6KW R32")).toBe("Wall split");
    expect(unitTypeOf("Indoor Unit - wireless R/C", "MSZ-AP25VGD2-A1")).toBe("Wall split");
    expect(unitTypeOf("FUJITSU DUCTED OUT 12.5KW 1PH R32")).toBe("Ducted");
    expect(unitTypeOf("R32 Power Inverter Outdoor - Single Phase", "PUZ-ZM125VKA2-A.TH")).toBe("Ducted");
    expect(unitTypeOf("4-Way Cassette Indoor Unit", "PLA-M125EA2-A.TH")).toBe("Cassette");
    expect(unitTypeOf("TOSHIBA MULTI OUT 10.0KW 5-PORT R32")).toBe("Multi");
    expect(unitTypeOf("3.6kW C/M Compact Ceiling Concealed 450mmD", "PEFY-P32VMX-E1")).toBe("VRF");
    expect(unitTypeOf("Energy Recovery Lossnay 278 L/s", "LGH-100RVX3-E")).toBe("Ventilation");
    expect(unitTypeOf("DAIKIN FLOOR CONSOLE IND 7.1KW R32")).toBe("Floor console");
  });

  it("tells an indoor head from an outdoor unit from a whole system", () => {
    expect(unitPartOf("FUJITSU LIFESTYLE R/C HWS IND 2.5KW")).toBe("indoor");
    expect(unitPartOf("MHI WHS AC DXK09ZSA-WF1 AVANTI IDU 2.5KW (EA)")).toBe("indoor");
    expect(unitPartOf("MITSUBISHI ELEC. DUCT OUT 16KW 1P R32")).toBe("outdoor");
    expect(unitPartOf("R32 Outdoor", "MUZ-AP50VGD2-A2")).toBe("outdoor");
    expect(unitPartOf("FUJITSU WALL MOUNTED AC ASTG09KMTC 2.5KW (EA)")).toBe("system");
    expect(unitPartOf("MHI DUCTED KIT 1PH 12.1KW FDUA125AVNPWVH (KIT)")).toBe("system");
    expect(unitPartOf("Energy Recovery Lossnay 278 L/s")).toBeNull();
  });

  it("sizes a unit by its kW, from its name or its maker's code", () => {
    expect(capacityOf("DAIKIN CORA HWS OUT 6KW R32")).toBe(6);
    expect(capacityOf("Ducted Unit", "PEA-M100GAA.TH")).toBe(10);
    expect(capacityOf("Indoor Unit - wireless R/C", "MSZ-AP25VGD2-A1")).toBe(2.5);
  });

  it("names a unit's family by its type and part, in the types' order", () => {
    const wallIn = unitFamilyOf("FUJITSU LIFESTYLE R/C HWS IND 2.5KW");
    const ductOut = unitFamilyOf("FUJITSU DUCTED OUT 12.5KW 1PH R32");
    expect(wallIn.label).toBe("Wall split indoor");
    expect(ductOut.label).toBe("Ducted outdoor");
    expect(wallIn.order).toBeLessThan(ductOut.order);
  });
});
