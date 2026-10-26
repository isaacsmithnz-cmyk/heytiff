/* The price book's items, read in ONE call (price_book_items, 26 October
   2026), and still read by the API's pages when that call fails. */

const rpc = jest.fn();
const pages: Record<string, unknown>[][] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => {
      let at = 0;
      const sub: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) sub[m] = () => sub;
      sub.range = (from: number) => {
        at = from;
        return sub;
      };
      sub.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: pages[at / 1000] ?? [], count: pages.flat().length, error: null }).then(ok);
      return sub;
    },
  },
}));

import { currentItems } from "../price-book-server";

const ROW = ["aad", "075433", "BRA ADDON KIT", 3, "EA", 32431, true, "2026-09-29", "2026-09-29T23:23:56.342+00:00", null, null, null];

beforeEach(() => {
  rpc.mockReset();
  pages.length = 0;
});

describe("the price book's items", () => {
  it("come in one call, each row in the function's order, priced as a quote takes it", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const items = await currentItems("org-1");
    expect(rpc).toHaveBeenCalledWith("price_book_items", { p_org: "org-1" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ supplierKey: "aad", code: "075433", name: "BRA ADDON KIT", timesBought: 3, uom: "EA", cents: 32431 });
  });

  it("are read by the API's pages when the call fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    pages.push([{ supplier_key: "reece", code: "R1", name: "Coil", times_bought: null, uom: null, cents: 100, on_list: true, listed_on: null, last_import_at: null, priced_on: null, paid_cents: null, paid_on: null }]);
    const items = await currentItems("org-1");
    expect(items.map((i) => i.code)).toEqual(["R1"]);
  });
});
