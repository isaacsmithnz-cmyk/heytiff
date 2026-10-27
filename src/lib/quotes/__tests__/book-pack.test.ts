import { packBook, unpackBook } from "../book-pack";
import { productsFrom } from "../families";
import type { Supplier } from "../price-book";

/* The book over the wire (27 October 2026): packed, and unpacked in the
   browser as exactly what productsFrom made. */

const offer = (supplierKey: string, supplierName: string, code: string, name: string, netCents: number, extra = {}) => ({
  supplierKey, supplierName, code, name, netCents, ...extra,
});

it("unpacks to exactly what was packed", () => {
  const book = [
    {
      key: "aad|PC1412",
      name: "ARDENT PR CU 1/4 X 1/2 20M",
      category: "pipe" as const,
      offers: [
        offer("reece", "Reece", "9800006-1", "ARDENT PR CU 1/4 X 1/2 20M", 18000, { pricedOn: "2026-10-05" }),
        offer("aad", "AAD", "PC1412", "PAIRED COIL 1/4+1/2X20M", 19100, { other: { netCents: 18500, on: "2026-09-01", from: "invoice" as const } }),
        offer("voltex", "Voltex", "PC-1412", "Paired coil", 0),
      ],
      cheapest: null as unknown as ReturnType<typeof offer>,
      preferred: null as unknown as ReturnType<typeof offer> | null,
      brand: "Ardent",
      quotes: 37,
    },
    {
      key: "aad|CMP",
      name: "CENTRE MOUNTING PLATE M10",
      category: "mounting" as const,
      offers: [offer("aad", "AAD", "CMP", "CENTRE MOUNTING PLATE M10", 128)],
      cheapest: null as unknown as ReturnType<typeof offer>,
      preferred: null,
      brand: null,
      quotes: 0,
    },
  ];
  book[0]!.cheapest = book[0]!.offers[0]!;
  book[0]!.preferred = book[0]!.offers[1]!;
  book[1]!.cheapest = book[1]!.offers[0]!;
  const wire = JSON.parse(JSON.stringify(packBook(book as never)));
  expect(unpackBook(wire)).toEqual(book);
});

it("round-trips a book made by productsFrom", () => {
  const suppliers = [
    { key: "aad", name: "AAD", pricing: "net", discountPct: 0, rules: [] },
    { key: "reece", name: "Reece", pricing: "net", discountPct: 0, rules: [] },
  ] as unknown as Supplier[];
  const items = [
    { supplierKey: "aad", code: "PC1412", name: "PAIRED COIL 1/4+1/2X20M", cents: 19100, net: true },
    { supplierKey: "reece", code: "9800006-1", name: "ARDENT PR CU 1/4 X 1/2 20M", cents: 18000, net: true, pricedOn: "2026-10-05" },
    { supplierKey: "aad", code: "CMP", name: "CENTRE MOUNTING PLATE M10", cents: 128, net: true },
    { supplierKey: "aad", code: "NOPRICE", name: "SOMETHING UNPRICED", cents: 0, net: true },
  ];
  const book = productsFrom(items as never, suppliers, [["aad|PC1412", "reece|9800006-1"]], new Set(["aad|PC1412"]), new Map([["PC1412", 12]]));
  expect(book.length).toBe(3);
  expect(unpackBook(JSON.parse(JSON.stringify(packBook(book))))).toEqual(book);
});

it("is a fraction of the objects' size", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    key: `aad|C${i}`,
    name: `ITEM NUMBER ${i} WITH A LONG SUPPLIER NAME`,
    category: "electrical" as const,
    offers: [offer("aad", "AAD Air Conditioning Distributors", `C${i}`, `ITEM NUMBER ${i} WITH A LONG SUPPLIER NAME`, 1000 + i)],
    cheapest: null as unknown,
    preferred: null,
    brand: null,
    quotes: 0,
  }));
  for (const p of many) p.cheapest = p.offers[0];
  const objects = JSON.stringify(many).length;
  const packed = JSON.stringify(packBook(many as never)).length;
  expect(packed).toBeLessThan(objects * 0.45);
});
