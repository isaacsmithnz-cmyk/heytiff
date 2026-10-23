import { brandOfCode } from "../brand";

describe("whose equipment it is", () => {
  it("reads the brand off the model code, or the item's name", () => {
    expect(brandOfCode("MSZ-AP42VGKD2-A2")).toBe("mitsubishi");
    expect(brandOfCode("PEA-M125HAA")).toBe("mitsubishi");
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
});
