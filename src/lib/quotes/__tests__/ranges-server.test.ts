/**
 * @jest-environment node
 */
/* The business's ranges, stored: what a quote prices from, and what goes
   into a range — only the business's own current items of the kind, at a
   sane size. */
jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let removing = false;
      const rows = () => (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const q = {
        select: () => q,
        delete: () => ((removing = true), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        upsert: async (rs: Row[]) => {
          for (const row of rs) {
            const same = (r: Row) => r.org_id === row.org_id && r.kind === row.kind && r.supplier_key === row.supplier_key && r.code === row.code;
            TABLES[table] = [...(TABLES[table] ?? []).filter((r) => !same(r)), row];
          }
          return { error: null };
        },
        then: (resolve: (v: { data: Row[]; error: null }) => void) => {
          if (removing) {
            const gone = new Set(rows());
            TABLES[table] = (TABLES[table] ?? []).filter((r) => !gone.has(r));
            return resolve({ data: [], error: null });
          }
          return resolve({ data: rows(), error: null });
        },
      };
      return q;
    },
  },
}));

jest.mock("../price-book-server", () => ({
  readSuppliers: async () => [
    { key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] },
    { key: "mitsubishi", name: "Mitsubishi Electric", pricing: "list_less", file: "pdf", format: "me_pdf", discountPct: 30, rules: [] },
  ],
  currentItems: async () => [],
  currentItemsByCode: async (_org: string, codes: string[]) =>
    [
      { supplierKey: "aad", code: "MAD10", name: "MANUAL DAMPER 250mm", cents: 3557, net: true },
      { supplierKey: "aad", code: "QZD1024V", name: "DAI ACC 250 DIA ZONE DAMPER 24V", cents: 4521, net: true },
      { supplierKey: "aad", code: "CWBX", name: "CON WALL BRACKET 250KG W:550 H:450 L:850", cents: 4865, net: true },
    ].filter((i) => codes.includes(i.code)),
}));
jest.mock("../book-view-server", () => ({ quotesByCode: async () => new Map() }));

import { rangeOffersFrom, readRanges, saveRange } from "../ranges-server";

beforeEach(() => {
  TABLES.quote_range_items = [];
});

it("prices a range's items as a quote takes them: net, less the business's discount off a list price", () => {
  const offers = rangeOffersFrom(
    [
      { kind: "zone_damper", supplierKey: "aad", code: "QZD1024V", size: { mm: 250 } },
      { kind: "isolator", supplierKey: "mitsubishi", code: "ISO-32", size: { amps: 32, poles: 2 } },
      { kind: "zone_damper", supplierKey: "aad", code: "GONE", size: { mm: 300 } },
    ],
    [
      { supplierKey: "aad", code: "QZD1024V", name: "DAI ACC 250 DIA ZONE DAMPER 24V", cents: 4521, net: true, pricedOn: null, other: null, timesBought: null, uom: null },
      { supplierKey: "mitsubishi", code: "ISO-32", name: "ISOLATOR 32A 2P", cents: 10000, net: false, pricedOn: null, other: null, timesBought: null, uom: null },
    ],
    [
      { key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] },
      { key: "mitsubishi", name: "Mitsubishi Electric", pricing: "list_less", file: "pdf", format: "me_pdf", discountPct: 30, rules: [] },
    ]
  );
  expect(offers.get("zone_damper")).toEqual([{ size: { mm: 250 }, perUnitCents: 4521, supplierKey: "aad", code: "QZD1024V", name: "DAI ACC 250 DIA ZONE DAMPER 24V" }]);
  expect(offers.get("isolator")?.[0]?.perUnitCents).toBe(7000);
});

it("reads back only rows of a kind it knows, at a size that holds up", async () => {
  TABLES.quote_range_items = [
    { org_id: "org-1", kind: "zone_damper", supplier_key: "aad", code: "QZD1024V", size: { mm: 250 } },
    { org_id: "org-1", kind: "toaster", supplier_key: "aad", code: "T1", size: { mm: 250 } },
    { org_id: "org-1", kind: "zone_damper", supplier_key: "aad", code: "BAD", size: { mm: 251 } },
    { org_id: "org-2", kind: "zone_damper", supplier_key: "aad", code: "THEIRS", size: { mm: 250 } },
  ];
  expect(await readRanges("org-1")).toEqual([{ kind: "zone_damper", supplierKey: "aad", code: "QZD1024V", size: { mm: 250 } }]);
});

it("puts into a range only the business's current items of the kind, at a sane size, and takes items out", async () => {
  const view = await saveRange(
    "org-1",
    "u1",
    "zone_damper",
    [
      { supplierKey: "aad", code: "QZD1024V", size: { mm: 250, poles: 9 } },
      /* a manual damper is not a zone damper */
      { supplierKey: "aad", code: "MAD10", size: { mm: 250 } },
      /* not in the book */
      { supplierKey: "aad", code: "NOPE", size: { mm: 250 } },
      /* a supplier the business doesn't have */
      { supplierKey: "reece", code: "QZD1024V", size: { mm: 250 } },
    ],
    []
  );
  expect(TABLES.quote_range_items!.map((r) => [r.kind, r.code, r.size, r.added_by])).toEqual([["zone_damper", "QZD1024V", { mm: 250 }, "u1"]]);
  expect(view).toEqual({
    kind: "zone_damper",
    items: [{ supplierKey: "aad", supplierName: "AAD", code: "QZD1024V", name: "DAI ACC 250 DIA ZONE DAMPER 24V", size: { mm: 250 }, words: "Ø250", buyCents: 4521 }],
  });

  await saveRange("org-1", "u1", "wall_bracket", [{ supplierKey: "aad", code: "CWBX", size: { kg: 250, maxWidthMm: 1200 } }], []);
  expect((await saveRange("org-1", "u1", "zone_damper", [], [{ supplierKey: "aad", code: "QZD1024V" }]))?.items).toEqual([]);
  expect(TABLES.quote_range_items!.map((r) => [r.kind, r.code, r.size])).toEqual([["wall_bracket", "CWBX", { kg: 250, maxWidthMm: 1200 }]]);
});
