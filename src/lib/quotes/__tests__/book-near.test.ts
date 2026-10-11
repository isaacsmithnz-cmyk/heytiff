/**
 * @jest-environment node
 */
/* The job checklist's book search, when no item holds every word: the
   database's nearest (quote_items_like), nearest first (Isaac, 2026-10-11:
   "Just do fuzzy book now"). */
jest.mock("server-only", () => ({}));

type Row = { supplier_key: string; code: string; name: string; times_bought: number | null; uom: string | null; cents: number; on_list: boolean | null; listed_on: null; last_import_at: null; priced_on: null; paid_cents: null; paid_on: null };
const item = (supplier_key: string, code: string, name: string): Row => ({
  supplier_key, code, name, times_bought: null, uom: null, cents: 1289, on_list: true, listed_on: null, last_import_at: null, priced_on: null, paid_cents: null, paid_on: null,
});
const book = [item("aad", "CD200", "CONE DIFFUSER PLASTIC 200"), item("reece", "1313216-1", "AIRFORM FULLCONE ROUND DIFFUSER 200MM (EA)"), item("aad", "CR200", "CONE REDUCER 200")];
let near: { supplier_key: string; code: string; score: number }[] = [];
const rpc = jest.fn(async () => ({ data: near, error: null }));

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => (rpc as unknown as (...x: unknown[]) => unknown)(...a),
    from: () => {
      let pick: Row[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range"]) q[m] = () => q;
      /* the strict search: an item holding the longest word */
      q.or = (f: string) => {
        const w = /name\.ilike\.%(.+)%$/.exec(f)![1]!;
        pick = book.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(w));
        return q;
      };
      q.in = (_c: string, codes: string[]) => {
        pick = book.filter((r) => codes.includes(r.code));
        return q;
      };
      q.then = (res: (v: unknown) => void) => res({ data: pick, error: null });
      return q;
    },
  },
}));

import { matchingItems } from "../price-book-server";

beforeEach(() => {
  rpc.mockClear();
  near = [];
});

it("takes what holds every word, and asks the database nothing more", async () => {
  expect((await matchingItems("org-a", ["cone", "diffuser"], [])).map((i) => i.code)).toEqual(["CD200", "1313216-1"]);
  expect(rpc).not.toHaveBeenCalled();
});

it("none with every word: the database's nearest, in its order, this org's only", async () => {
  near = [
    { supplier_key: "reece", code: "1313216-1", score: 2.7 },
    { supplier_key: "aad", code: "CD200", score: 2.7 },
    { supplier_key: "aad", code: "CR200", score: 2 },
  ];
  expect((await matchingItems("org-a", ["cone", "difuser", "200"], [])).map((i) => i.code)).toEqual(["1313216-1", "CD200", "CR200"]);
  expect(rpc).toHaveBeenCalledWith("quote_items_like", { p_org: "org-a", p_words: ["cone", "difuser", "200"], p_limit: 12 });
});

it("nothing near: nothing", async () => {
  expect(await matchingItems("org-a", ["vh251"], [])).toEqual([]);
});
