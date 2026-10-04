/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
let rows: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = async () => ({ data: rows, error: null });
      return q;
    },
  },
}));

import { readSuppliers } from "../price-book-server";

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  name: key.toUpperCase(),
  pricing: "net",
  discount_pct: 0,
  rules: [],
  file_name: null,
  imported_at: null,
  item_count: null,
  format: null,
  columns: null,
  ...extra,
});

/* Isaac, 2026-10-04: "Pretend we don't exist… ensure no hard coded parts
   from us come in". */
describe("a business's suppliers", () => {
  it("are none for a new business — never another's", async () => {
    rows = [];
    expect(await readSuppliers("org-new")).toEqual([]);
  });

  it("are the ones it added: a file HeyTiff reads keeps its reader, its own discount, and any other by heading", async () => {
    rows = [
      row("mitsubishi", { name: "Mitsubishi Electric", pricing: "list_less", discount_pct: 30, rules: [{ prefix: "PUMY", discount_pct: 48 }] }),
      row("acme", { name: "Acme", format: "headed" }),
    ];
    const s = await readSuppliers("org-x");
    expect(s.map((x) => [x.key, x.format, x.discountPct, x.rules.length])).toEqual([
      ["mitsubishi", "me_pdf", 30, 1],
      ["acme", "headed", 0, 0],
    ]);
  });
});
