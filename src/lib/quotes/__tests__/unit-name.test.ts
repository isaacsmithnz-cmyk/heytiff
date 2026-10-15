import { namedByRole, namedUnit, roomIn, unitLineName, unitRoleOf } from "../unit-name";

/* Isaac, 2026-10-15, on 3231's quote: "[MITSUBISHI ELEC. DUCT OUT 10KW 1P
   R32]. That's like a line code from a supplier… That needs to just be
   simplified to indoor unit, outdoor unit… indoor unit study, then model" */

describe("a unit line's name", () => {
  it("is what it is, a multi's or a VRF's head with the room it serves", () => {
    expect(unitLineName("indoor")).toBe("Indoor unit");
    expect(unitLineName("outdoor")).toBe("Outdoor unit");
    expect(unitLineName("indoor", "  Bed   1 ")).toBe("Indoor unit, Bed 1");
    /* an outdoor serves the system, never one room */
    expect(unitLineName("outdoor", "Study")).toBe("Outdoor unit");
  });

  it("reads the room back off a head's own words", () => {
    expect(roomIn("Indoor unit, Study")).toBe("Study");
    expect(roomIn("indoor unit: Bed 1")).toBe("Bed 1");
    expect(roomIn("Indoor unit (Bed 2)")).toBe("Bed 2");
    expect(roomIn("Indoor unit - Bed 1 (upstairs)")).toBe("Bed 1 (upstairs)");
    expect(roomIn("Indoor unit")).toBe("");
    expect(roomIn("High wall 3.5 kW indoor, brand to choose")).toBe("");
    expect(roomIn("MITSUBISHI ELEC. HWS IND 2.5KW")).toBe("");
  });

  it("knows a name that's already by what it is", () => {
    expect(namedByRole("Indoor unit, Study")).toBe(true);
    expect(namedByRole("Outdoor unit")).toBe(true);
    expect(namedByRole("MITSUBISHI ELEC. DUCT OUT 10KW 1P R32")).toBe(false);
  });
});

describe("which part a unit is", () => {
  it("is its maker's pack first, then the book's words and code, then the line's own", () => {
    expect(unitRoleOf("indoor", { name: "MITSUBISHI ELEC. DUCT OUT 10KW 1P R32" })).toBe("indoor");
    expect(unitRoleOf(null, { name: "MITSUBISHI ELEC. DUCT OUT 10KW 1P R32", code: "PUZ-ZM100VKA2" }, { name: "Indoor unit" })).toBe("outdoor");
    expect(unitRoleOf(null, { name: "Ducted 10 kW", code: "PEA-M100HAA" })).toBe("indoor");
    expect(unitRoleOf(null, { name: "DAI DUCTED 10KW R32", code: "FDYAN100A" }, { name: "Outdoor unit" })).toBe("outdoor");
    expect(unitRoleOf(null, { name: "Something", code: "X1" }, { name: "A unit" })).toBeNull();
  });

  it("is neither for a whole system sold as one item", () => {
    expect(unitRoleOf(null, { name: "FUJITSU WALL MOUNTED AC ASTG09KMTC 2.5KW (EA)" }, { name: "Indoor unit" })).toBeNull();
  });

  it("names the line by it, keeping the room her words give, and leaves it as said when nothing knows", () => {
    expect(namedUnit("outdoor", "MITSUBISHI ELEC. DUCT OUT 10KW 1P R32")).toBe("Outdoor unit");
    expect(namedUnit("indoor", "Indoor unit, Study")).toBe("Indoor unit, Study");
    expect(namedUnit("indoor", "Two piece ducted unit")).toBe("Indoor unit");
    expect(namedUnit(null, "Split system, Living")).toBe("Split system, Living");
    expect(namedUnit(null, "Indoor unit", "FUJITSU WALL MOUNTED AC")).toBe("FUJITSU WALL MOUNTED AC");
  });
});
