/* Compare (slice 10.2): units like the one on the quote from the business's
   own book, each with the outdoor that pairs with it, and a unit asked for
   in the person's words found with no judgement where it can be. */
import type { Product } from "../families";
import { askedPair, pairOutdoor, suggestions } from "../compare";

const unit = (name: string, code: string, cents: number, brand: string, o: Partial<Product> = {}): Product => {
  const offer = { supplierKey: "aad", supplierName: "AAD", code, name, netCents: cents };
  return { key: `aad|${code}`, name, category: "units", offers: [offer], cheapest: offer, preferred: null, brand, quotes: 0, ...o } as Product;
};
const BOOK = [
  unit("Daikin Cora 7.1kW high wall indoor", "FTXV71WVMA", 45604, "Daikin"),
  unit("Daikin Cora 7.1kW outdoor", "RXV71WVMA", 106410, "Daikin"),
  unit("Daikin XL Premium 8.5kW high wall indoor", "FTXM85WVMA", 70000, "Daikin"),
  unit("Daikin XL Premium 8.5kW outdoor", "RXM85WVMA", 150000, "Daikin"),
  unit("Daikin Lite 8.5kW outdoor", "RXF85CVMA", 120000, "Daikin"),
  unit("Daikin 9.5kW high wall indoor", "FTXM95WVMA", 76007, "Daikin"),
  unit("MITSUBISHI ELEC. HWS IND 8.0KW R32 WI-FI", "MSZ-AP80VGKD2", 60000, "Mitsubishi Electric", { quotes: 4 }),
  unit("MITSUBISHI ELEC. HWS OUT 8.0KW R32", "MUZ-AP80VGD2", 130000, "Mitsubishi Electric"),
  unit("Daikin 2.5kW high wall indoor", "FTXM25WVMA", 30000, "Daikin"),
  unit("Daikin 7.1kW ducted indoor", "FDYAN71AV1", 90000, "Daikin"),
];

it("pairs an indoor with the book's outdoor of its brand, type and size, the closest code first", () => {
  expect(pairOutdoor(BOOK, BOOK[2]!)!.offers[0]!.code).toBe("RXM85WVMA");
  expect(pairOutdoor(BOOK, BOOK[6]!)!.offers[0]!.code).toBe("MUZ-AP80VGD2");
  /* a 9.5 with no 9.5 outdoor in the book has none */
  expect(pairOutdoor(BOOK, BOOK[5]!)).toBeNull();
});

it("suggests indoors of the same type within a quarter of the capacity, the most used first", () => {
  const s = suggestions(BOOK, "FTXV71WVMA");
  expect(s.map((p) => [p.indoor.code, p.outdoor?.code ?? null])).toEqual([
    ["MSZ-AP80VGKD2", "MUZ-AP80VGD2"],
    ["FTXM85WVMA", "RXM85WVMA"],
  ]);
});

it("finds what's asked by a code, or a brand and a size, and leaves judgement to Tiff", () => {
  expect(askedPair(BOOK, "the FTXM95WVMA", "Wall split")!.indoor.code).toBe("FTXM95WVMA");
  expect(askedPair(BOOK, "a Daikin around 9.5 kW", "Wall split")!.indoor.code).toBe("FTXM95WVMA");
  expect(askedPair(BOOK, "something quieter that still covers the open plan", "Wall split")).toBeNull();
  expect(askedPair(BOOK, "a Fujitsu around 9 kW", "Wall split")).toBeNull();
});
