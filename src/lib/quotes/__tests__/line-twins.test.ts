import type { QuoteLine } from "../lines";
import { alsoWords, optionsWords, twinsOf } from "../line-twins";

/* 3054 (Isaac, 6 November 2026): the same Return plenum on both options */
const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "a",
  version: 1,
  updatedAt: "",
  updatedBy: "",
  optionIndex: 0,
  system: "Underfloor",
  group: "Ductwork and grilles",
  position: 9,
  name: "Return plenum",
  code: null,
  supplierKey: null,
  kind: "material",
  qty: 1,
  unit: "",
  costCents: 0,
  sellCents: null,
  source: "unknown",
  why: "",
  duct: false,
  ...o,
});

it("finds the same line on each other option, once, and never on a variation's", () => {
  const a = line({});
  const b = line({ id: "b", optionIndex: 1 });
  const b2 = line({ id: "b2", optionIndex: 1, position: 12 });
  const c = line({ id: "c", optionIndex: 2 });
  const other = line({ id: "d", optionIndex: 1, name: "Supply plenum" });
  expect(twinsOf(a, [a, b, b2, c, other]).map((l) => l.id)).toEqual(["b", "c"]);
  expect(twinsOf(a, [a, b, c], new Set([2])).map((l) => l.id)).toEqual(["b"]);
  expect(twinsOf(a, [a, line({ id: "e", optionIndex: 1, code: "RP400" })])).toEqual([]);
});

it("says where a change went", () => {
  expect(optionsWords([{ optionIndex: 0 }])).toBe("Option 1");
  expect(optionsWords([{ optionIndex: 0 }, { optionIndex: 1 }])).toBe("both options");
  expect(optionsWords([{ optionIndex: 0 }, { optionIndex: 1 }, { optionIndex: 2 }])).toBe("all 3 options");
  expect(alsoWords([{ optionIndex: 1 }])).toBe("On Option 2 as well");
  expect(alsoWords([{ optionIndex: 1 }, { optionIndex: 2 }])).toBe("On Options 2 and 3 as well");
});
