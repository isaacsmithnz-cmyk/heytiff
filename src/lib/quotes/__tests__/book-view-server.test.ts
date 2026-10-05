/**
 * @jest-environment node
 */
/* The price book's own reads and writes: how many quotes each part has
   been on (Isaac, 2026-10-05: "the most used should come from quotes. And
   items that get pulled from the quotes can sit in the most used"), what a
   quote pulled in, and an item put forward. */
jest.mock("server-only", () => ({}));

type Row = Record<string, string | number | boolean | null>;
const TABLES: Record<string, Row[]> = {};
let RPC: { fn: string; args: unknown; data: unknown; error: unknown } | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: unknown) => {
      RPC = { ...(RPC ?? { data: [], error: null }), fn, args };
      return { data: RPC.data, error: RPC.error };
    },
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let order: string | null = null;
      let removing = false;
      const rows = () => {
        const out = (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return order ? [...out].sort((a, b) => String(a[order!]).localeCompare(String(b[order!]))) : out;
      };
      const q = {
        select: () => q,
        delete: () => ((removing = true), q),
        insert: async (rs: Row[]) => {
          TABLES[table] = [...(TABLES[table] ?? []), ...rs];
          return { error: null };
        },
        upsert: async (row: Row) => {
          TABLES[table] = [...(TABLES[table] ?? []).filter((r) => !(r.org_id === row.org_id && r.supplier_key === row.supplier_key && r.code === row.code)), row];
          return { error: null };
        },
        match: (o: Row) => (Object.entries(o).forEach(([c, v]) => filters.push((r) => r[c] === v)), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        not: (c: string) => (filters.push((r) => r[c] != null), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        order: (c: string) => ((order = c), q),
        range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), error: null, count: rows().length }),
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

import { quotesByCode, recordQuoteItems, setPreferred } from "../book-view-server";

beforeEach(() => {
  RPC = null;
  for (const k of Object.keys(TABLES)) delete TABLES[k];
});

describe("quotes each part has been on", () => {
  it("are counted in the database, in one call, for the one business", async () => {
    RPC = { fn: "", args: null, data: [{ code: "CMADJ", quotes: 42 }, { code: "PC1412", quotes: "30" }], error: null };
    const counts = await quotesByCode("org");
    expect(RPC.fn).toBe("quote_item_counts");
    expect(RPC.args).toEqual({ p_org: "org" });
    expect([...counts.entries()]).toEqual([
      ["CMADJ", 42],
      ["PC1412", 30],
    ]);
  });

  it("are none when the count can't be read, never an error", async () => {
    RPC = { fn: "", args: null, data: null, error: { message: "no function" } };
    expect((await quotesByCode("org")).size).toBe(0);
  });
});

describe("what a quote pulled in", () => {
  it("replaces what the quote held the last time it was priced", async () => {
    TABLES.quote_item_uses = [
      { org_id: "org", sm8_job_uuid: "job-1", supplier_key: "aad", code: "OLD" },
      { org_id: "org", sm8_job_uuid: "job-2", supplier_key: "aad", code: "OTHER-JOB" },
    ];
    await recordQuoteItems("org", "job-1", [
      { supplierKey: "aad", code: "PC1412" },
      { supplierKey: "aad", code: "PC1412" },
      { supplierKey: "reece", code: "3210002-1" },
      /* an allowance has no item */
      { supplierKey: null, code: null },
    ]);
    expect(TABLES.quote_item_uses!.map((r) => `${r.sm8_job_uuid} ${r.supplier_key}|${r.code}`).sort()).toEqual([
      "job-1 aad|PC1412",
      "job-1 reece|3210002-1",
      "job-2 aad|OTHER-JOB",
    ]);
  });
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
