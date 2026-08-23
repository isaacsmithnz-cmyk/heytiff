import { VEHICLE_MAKES, canonicalMake } from "../makes";

/* The point of the list is that two people entering the same van reach the
   same string. These are the exact spellings that were sitting in Isaac's
   register before the picker existed — if canonicalMake can't fold them, the
   form drops real vehicles into "Not listed" and the mess survives the fix. */

it("folds the casings a free-text field left behind", () => {
  expect(canonicalMake("TOYOTA")).toBe("Toyota");
  expect(canonicalMake("Toyota")).toBe("Toyota");
  expect(canonicalMake("toyota")).toBe("Toyota");
  expect(canonicalMake("Byd")).toBe("BYD");
  expect(canonicalMake("MITSUBISHI")).toBe("Mitsubishi");
});

it("ignores spacing and punctuation, so Mercedes has one spelling", () => {
  for (const raw of ["Mercedes-Benz", "MERCEDES BENZ", "mercedes benz", "Mercedes"]) {
    expect(canonicalMake(raw)).toBe("Mercedes-Benz");
  }
});

it("folds the diacritic, because nobody types the umlaut on a phone", () => {
  expect(canonicalMake("Citroen")).toBe("Citroën");
  expect(canonicalMake("CITROËN")).toBe("Citroën");
});

it("knows the shorthand people actually use", () => {
  expect(canonicalMake("VW")).toBe("Volkswagen");
  expect(canonicalMake("Land Rover")).toBe("Land Rover");
  expect(canonicalMake("landrover")).toBe("Land Rover");
});

it("returns null for a make no list will ever carry", () => {
  // the real trailer in the register: a feed code, not a marque
  expect(canonicalMake("LG CHIV")).toBeNull();
  expect(canonicalMake("")).toBeNull();
  expect(canonicalMake("   ")).toBeNull();
});

it("is idempotent — a canonical make canonicalises to itself", () => {
  for (const make of VEHICLE_MAKES) expect(canonicalMake(make)).toBe(make);
});

it("carries no duplicate spelling of the same marque", () => {
  const folded = VEHICLE_MAKES.map((m) => m.toLowerCase().replace(/[^a-z0-9]/g, ""));
  expect(new Set(folded).size).toBe(VEHICLE_MAKES.length);
});
