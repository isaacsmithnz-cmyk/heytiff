/* Which price a quote line takes: every supplier selling the code or a
   confirmed same part, at what the business pays, the business's own choice
   first, else the lowest real price. */
import { DEFAULT_SUPPLIERS } from "../price-book";
import { makePriceOf, type BookRow } from "../price-resolver";

const items: BookRow[] = [
  { supplierKey: "aad", code: "PEA-M100HAA", name: "MITSUBISHI ELEC. 2PCE DUCTED IND 10KW", cents: 103439 },
  { supplierKey: "mitsubishi", code: "PEA-M100HAA", name: "2-Piece Ducted Unit", cents: 133800 },
  { supplierKey: "aad", code: "PC1412", name: "PAIRED COIL 1/4+1/2X20M", cents: 19100 },
  { supplierKey: "reece", code: "9800006-1", name: "ARDENT PR CU 1/4 X 1/2 R410A 20M (COIL)", cents: 18000 },
  { supplierKey: "reece", code: "9502294-1", name: "DRAIN HOSE 50MT (COIL)", cents: 6110 },
  { supplierKey: "reece", code: "9502294-2", name: "DRAIN HOSE 50MT (MTR)", cents: 305 },
  { supplierKey: "aad", code: "HAX1", name: "BONAIRE SPIGOT", cents: 0 },
];
const priceOf = (chosen?: Map<string, string>) =>
  makePriceOf({ items, suppliers: DEFAULT_SUPPLIERS, confirmed: [["aad|PC1412", "reece|9800006-1"]], chosenSupplier: chosen });

it("takes the lowest of what the business pays across suppliers (Mitsubishi list less 30%)", () => {
  expect(priceOf()("PEA-M100HAA")).toEqual({ buyCents: 93660, supplierKey: "mitsubishi", name: "2-Piece Ducted Unit" });
});

it("counts a part confirmed as the same under another code", () => {
  expect(priceOf()("PC1412")).toMatchObject({ buyCents: 18000, supplierKey: "reece" });
});

it("never prices a coil from the same hose sold by the metre", () => {
  expect(priceOf()("9502294-1")).toMatchObject({ buyCents: 6110 });
});

it("follows the business's choice of supplier, and skips $0.00", () => {
  expect(priceOf(new Map([["PEA-M100HAA", "aad"]]))("PEA-M100HAA")).toMatchObject({ supplierKey: "aad", buyCents: 103439 });
  expect(priceOf()("HAX1")).toBeNull();
  expect(priceOf()("NOPE")).toBeNull();
});
