/* One supplier, two sources of price (Isaac, 2026-10-05): Mitsubishi
   Electric's trade book, less the business's discount, and what the
   business paid on its invoices — for the VRF indoors it only ever quotes.
   The newer price wins; an invoice touches only the codes on it; a new
   price list never drops an invoiced price. */
import {
  BUILT_IN_SUPPLIERS,
  dateInName,
  effectivePrice,
  netCents,
  planInvoices,
  planPriceList,
  type StoredItem,
} from "../price-book";

const me = { ...BUILT_IN_SUPPLIERS.find((s) => s.key === "mitsubishi")!, discountPct: 30, rules: [{ prefix: "PUMY", discountPct: 48 }] };
const ctx = { orgId: "org", supplierKey: "mitsubishi", now: "2026-10-05T00:00:00.000Z" };

const stored = (code: string, over: Partial<StoredItem> = {}): StoredItem => ({
  code,
  name: code,
  cents: 100000,
  previous_cents: null,
  price_changed_at: null,
  first_seen_at: "2026-09-30T00:00:00.000Z",
  last_import_at: "2026-09-30T00:00:00.000Z",
  current: true,
  on_list: true,
  paid_cents: null,
  paid_on: null,
  times_bought: null,
  qty_bought: null,
  ...over,
});
const book = (...items: StoredItem[]) => new Map(items.map((i) => [i.code, i]));

describe("which price a quote takes", () => {
  const base = { cents: 186100, onList: true, listedOn: "2026-08-11", importedAt: "2026-09-30T00:00:00Z", pricedOn: null };

  it("the invoice when it's newer than the price list, already net, with the list beside it", () => {
    const { price, other } = effectivePrice({ ...base, paidCents: 125300, paidOn: "2026-09-21" });
    expect(price).toEqual({ cents: 125300, net: true, on: "2026-09-21", from: "invoice" });
    expect(other).toEqual({ cents: 186100, net: false, on: "2026-08-11", from: "list" });
    /* no discount comes off what was paid; it does off the list */
    expect(netCents(me, "PAR-41MAAM", price.cents, price.net)).toBe(125300);
    expect(netCents(me, "PAR-41MAAM", other!.cents, other!.net)).toBe(130270);
  });

  it("the price list when it's newer than the invoice", () => {
    const { price, other } = effectivePrice({ ...base, paidCents: 125300, paidOn: "2026-07-01" });
    expect(price.from).toBe("list");
    expect(other?.from).toBe("invoice");
  });

  it("the invoice for an item only ever invoiced (a VRF indoor), and the upload day when a list has no date", () => {
    expect(effectivePrice({ ...base, onList: false, cents: 87152, paidCents: 87152, paidOn: "2026-08-31" }).price).toEqual({
      cents: 87152,
      net: true,
      on: "2026-08-31",
      from: "invoice",
    });
    expect(effectivePrice({ ...base, listedOn: null, paidCents: 1, paidOn: "2026-09-29" }).price.from).toBe("list");
  });

  it("reads a price list's date from its file name, day first", () => {
    expect(dateInName("ME_PriceList_11-08-2026_HVAC_FINAL.pdf")).toBe("2026-08-11");
    expect(dateInName("aad-prices.csv")).toBeNull();
    expect(dateInName("list 31-13-2026.csv")).toBeNull();
  });
});

describe("a new price list", () => {
  it("takes its prices, keeps an invoiced item it no longer lists, and drops the rest", () => {
    const before = book(
      stored("MSZ-AP25VGD", { cents: 90000 }),
      stored("OLD-ONE"),
      stored("PEFY-P32VMX-E1", { paid_cents: 87152, paid_on: "2026-08-31", times_bought: 16 }),
      stored("PEFY-P25VMX-E1", { on_list: false, paid_cents: 84968, paid_on: "2026-08-31" })
    );
    const plan = planPriceList(before, [{ code: "MSZ-AP25VGD", name: "Wall split", cents: 95000 }, { code: "PEFY-P25VMX-E1", name: "Ducted", cents: 120000 }], {
      ...ctx,
      listOn: "2026-10-01",
    });
    expect(plan.summary).toEqual({ read: 2, added: 1, changed: 1, gone: 1 });
    expect(plan.gone).toEqual(["OLD-ONE"]);
    expect(plan.offList).toEqual(["PEFY-P32VMX-E1"]);
    expect(plan.upserts[0]).toMatchObject({ cents: 95000, previous_cents: 90000, on_list: true, listed_on: "2026-10-01" });
    /* a trade book has no purchase counts or invoice prices: it never writes over them */
    for (const u of plan.upserts) {
      expect(u).not.toHaveProperty("times_bought");
      expect(u).not.toHaveProperty("paid_cents");
    }
  });
});

describe("invoices", () => {
  it("price only the codes on them, under the same supplier, and never take anything off", () => {
    const before = book(stored("PAR-41MAAM", { cents: 17900 }), stored("MSZ-AP25VGD"));
    const plan = planInvoices(
      before,
      [
        { code: "PAR-41MAAM", name: "Wired Controller with Back Light", cents: 12530, pricedOn: "2026-09-21", timesBought: 40 },
        { code: "PEFY-P32VMX-E1", name: "3.6kW C/M Compact Ceiling Concealed", cents: 87152, pricedOn: "2026-08-31", timesBought: 16 },
      ],
      { ...ctx, today: "2026-10-05" }
    );
    expect(plan.summary).toEqual({ read: 2, added: 1, changed: 1, gone: 0 });
    expect(plan.upserts).toHaveLength(2);
    /* on the list: the list's words and price stay, the paid price beside them */
    expect(plan.upserts[0]).toMatchObject({ name: "PAR-41MAAM", cents: 17900, on_list: true, paid_cents: 12530, paid_on: "2026-09-21", times_bought: 40 });
    /* only invoiced: an item of the same supplier, priced by what was paid */
    expect(plan.upserts[1]).toMatchObject({ supplier_key: "mitsubishi", on_list: false, cents: 87152, paid_cents: 87152, paid_on: "2026-08-31" });
  });

  it("an older invoice never replaces a newer one's price", () => {
    const before = book(stored("PAR-41MAAM", { paid_cents: 12530, paid_on: "2026-09-21" }));
    const plan = planInvoices(before, [{ code: "PAR-41MAAM", name: "x", cents: 11000, pricedOn: "2025-09-24" }], { ...ctx, today: "2026-10-05" });
    expect(plan.upserts[0]).toMatchObject({ paid_cents: 12530, paid_on: "2026-09-21" });
    expect(plan.summary.changed).toBe(0);
  });
});
