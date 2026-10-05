/**
 * @jest-environment node
 */
/* How many of the business's job lines were each code — one count for the
   price book's Most used and the Quoting page's preferred items alike
   (2026-10-05): ServiceM8's job lines through the catalogue item each one
   names, a Reece item counted under Reece's own code too. */
jest.mock("server-only", () => ({}));

type Row = Record<string, string | number | boolean | null>;
const TABLES: Record<string, Row[]> = {};
const asked: { table: string; in?: [string, unknown[]]; order?: string }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      const log: (typeof asked)[number] = { table };
      asked.push(log);
      let order: string | null = null;
      let removing = false;
      const rows = () => {
        const out = (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return order ? [...out].sort((a, b) => String(a[order!]).localeCompare(String(b[order!]))) : out;
      };
      const q = {
        select: () => q,
        delete: () => ((removing = true), q),
        upsert: async (row: Row) => {
          TABLES[table] = [...(TABLES[table] ?? []).filter((r) => !(r.org_id === row.org_id && r.supplier_key === row.supplier_key && r.code === row.code)), row];
          return { error: null };
        },
        match: (o: Row) => (Object.entries(o).forEach(([c, v]) => filters.push((r) => r[c] === v)), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        not: (c: string) => (filters.push((r) => r[c] != null), q),
        in: (c: string, vs: unknown[]) => ((log.in = [c, vs]), filters.push((r) => vs.includes(r[c])), q),
        order: (c: string) => ((log.order = c), (order = c), q),
        range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), error: null }),
        then: (ok: (v: { data: Row[]; error: null }) => unknown) => {
          const found = rows();
          if (removing) TABLES[table] = (TABLES[table] ?? []).filter((r) => !found.includes(r));
          return Promise.resolve({ data: found, error: null }).then(ok);
        },
      };
      return q;
    },
  },
}));

import { jobLinesByCode, setPreferred } from "../book-view-server";

const line = (i: number, material: string): Row => ({ org_id: "org", uuid: `line-${String(i).padStart(5, "0")}`, active: 1, material_uuid: material });

beforeEach(() => {
  asked.length = 0;
  TABLES.sm8_materials = [
    { org_id: "org", uuid: "m-coil", item_number: "PC1412" },
    { org_id: "org", uuid: "m-pump", item_number: "REC3210002-1" },
    { org_id: "org", uuid: "m-quote", item_number: "As Per Quote" },
  ];
  TABLES.sm8_job_materials = [
    ...Array.from({ length: 1200 }, (_, i) => line(i, "m-quote")),
    ...Array.from({ length: 38 }, (_, i) => line(2000 + i, "m-coil")),
    ...Array.from({ length: 21 }, (_, i) => line(3000 + i, "m-pump")),
    { org_id: "org", uuid: "line-gone", active: 0, material_uuid: "m-coil" },
  ];
});

it("counts every code's lines across pages, a Reece item under Reece's code too", async () => {
  const lines = await jobLinesByCode("org");
  expect(lines.get("PC1412")).toBe(38);
  expect(lines.get("3210002-1")).toBe(21);
  expect(lines.get("REC3210002-1")).toBe(21);
  expect(lines.get("As Per Quote")).toBe(1200);
  /* paged by the line's own key */
  expect(asked.filter((a) => a.table === "sm8_job_materials").every((a) => a.order === "uuid")).toBe(true);
});

it("for a few codes, reads only their catalogue items and their lines", async () => {
  const lines = await jobLinesByCode("org", ["PC1412", "3210002-1"]);
  expect([...lines.entries()].sort()).toEqual([
    ["3210002-1", 21],
    ["PC1412", 38],
    ["REC3210002-1", 21],
  ]);
  const catalogue = asked.find((a) => a.table === "sm8_materials")!;
  expect(catalogue.in?.[1]).toEqual(expect.arrayContaining(["PC1412", "REC3210002-1"]));
  const jobLines = asked.find((a) => a.table === "sm8_job_materials")!;
  expect(jobLines.in?.[1]).toEqual(expect.arrayContaining(["m-coil", "m-pump"]));
  expect(jobLines.in?.[1]).not.toContain("m-quote");
});

it("is empty, and reads no lines, when no catalogue item holds the codes", async () => {
  expect((await jobLinesByCode("org", ["NOPE"])).size).toBe(0);
  expect(asked.some((a) => a.table === "sm8_job_materials")).toBe(false);
});

describe("an item put forward", () => {
  const item = (supplier_key: string, code: string): Row => ({
    org_id: "org",
    supplier_key,
    code,
    name: code,
    cents: 1000,
    current: true,
    on_list: true,
    listed_on: null,
    last_import_at: null,
    priced_on: null,
    paid_cents: null,
    paid_on: null,
    times_bought: null,
    uom: null,
  });
  beforeEach(() => {
    TABLES.quote_price_items = [item("aad", "PC1412"), item("reece", "9800006-1"), item("aad", "PC1438")];
    TABLES.quote_same_items = [{ org_id: "org", a_ref: "aad|PC1412", b_ref: "reece|9800006-1", decision: "confirmed" }];
    TABLES.quote_suppliers = [];
  });

  it("takes the preference off the part's other codes, whatever the page knew", async () => {
    TABLES.quote_preferred_items = [
      { org_id: "org", supplier_key: "reece", code: "9800006-1" },
      { org_id: "org", supplier_key: "aad", code: "PC1438" },
    ];
    expect(await setPreferred("org", "user", "aad|PC1412", true)).toBe(true);
    expect(TABLES.quote_preferred_items.map((r) => `${r.supplier_key}|${r.code}`).sort()).toEqual(["aad|PC1412", "aad|PC1438"]);
  });

  it("takes back only itself", async () => {
    TABLES.quote_preferred_items = [
      { org_id: "org", supplier_key: "aad", code: "PC1412" },
      { org_id: "org", supplier_key: "aad", code: "PC1438" },
    ];
    expect(await setPreferred("org", "user", "aad|PC1412", false)).toBe(true);
    expect(TABLES.quote_preferred_items.map((r) => `${r.supplier_key}|${r.code}`)).toEqual(["aad|PC1438"]);
  });
});
