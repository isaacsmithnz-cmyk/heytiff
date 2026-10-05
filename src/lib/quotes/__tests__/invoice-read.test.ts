/* A supplier's invoice, read off a PDF or a photo (Isaac, 2026-10-05: the
   price book "take[s] in invoices"): what's believed of what Tiff read, and
   what each line would do to the book. */
import {
  INVOICE_LINES_SCHEMA,
  eachOf,
  namesSupplier,
  otherSupplierNamed,
  parseInvoiceRead,
  withBookPrices,
  type HeldItem,
} from "../invoice-read";
import type { Supplier } from "../price-book";

const TODAY = "2026-10-05";
const line = (code: string, description: string, qty: number, unitPriceExGst: number, lineTotalExGst = 0) => ({
  code,
  description,
  qty,
  unitPriceExGst,
  lineTotalExGst,
});

describe("what's believed of an invoice read", () => {
  it("keeps every product line with a code, how many and the price of one before GST", () => {
    const read = parseInvoiceRead(
      {
        supplier: "Mitsubishi Electric Australia Pty Ltd",
        invoiceNo: "9104412",
        invoiceDate: "2026-09-18",
        lines: [line("PEFY-P32VMA-E", "Ducted indoor  3.2kW", 2, 1105.4, 2210.8), line("PAC-SE41TS-E", "Wired controller", 2, 96.5, 193)],
      },
      TODAY
    );
    expect(read).toEqual({
      supplier: "Mitsubishi Electric Australia Pty Ltd",
      invoiceNo: "9104412",
      invoiceDate: "2026-09-18",
      lines: [
        { code: "PEFY-P32VMA-E", name: "Ducted indoor 3.2kW", qty: 2, cents: 110540 },
        { code: "PAC-SE41TS-E", name: "Wired controller", qty: 2, cents: 9650 },
      ],
      skipped: [],
    });
  });

  it("leaves out freight, a line with no code, none supplied and no price before GST, and says why", () => {
    const read = parseInvoiceRead(
      {
        supplier: "Reece",
        invoiceNo: "",
        invoiceDate: "",
        lines: [
          line("FRT", "Freight", 1, 45),
          line("", "Copper pipe 1/4 per metre", 18, 4.2),
          line("PC1412", "Pair coil 1/4 3/8", 0, 120),
          line("CMADJ", "Pipe clamp", 10, 0, 0),
          line("DLV", "Delivery", 1, 30),
          line("BO-1", "Small order charge", 1, 15),
        ],
      },
      TODAY
    );
    expect(read.lines).toEqual([]);
    expect(read.invoiceDate).toBeNull();
    expect(read.skipped).toEqual([
      { name: "Freight", why: "not a product" },
      { name: "Copper pipe 1/4 per metre", why: "no code on the line" },
      { name: "Pair coil 1/4 3/8", why: "none supplied" },
      { name: "Pipe clamp", why: "no price before GST" },
      { name: "Delivery", why: "not a product" },
      { name: "Small order charge", why: "not a product" },
    ]);
  });

  it("is one line for a code on two, at what they cost each on average", () => {
    const read = parseInvoiceRead({ lines: [line("CMADJ", "Pipe clamp", 10, 1.2), line("CMADJ", "Pipe clamp", 30, 1)] }, TODAY);
    expect(read.lines).toEqual([{ code: "CMADJ", name: "Pipe clamp", qty: 40, cents: 105 }]);
  });

  it("drops a date that isn't real or is after today, which would outrank every invoice after it", () => {
    const at = (invoiceDate: string) => parseInvoiceRead({ invoiceDate, lines: [] }, TODAY).invoiceDate;
    expect(at("2026-10-05")).toBe("2026-10-05");
    expect(at("2026-12-03")).toBeNull();
    expect(at("2026-02-30")).toBeNull();
    expect(at("03/12/2026")).toBeNull();
    expect(at("1999-12-31")).toBeNull();
  });

  it("reads nothing into an answer that isn't one", () => {
    expect(parseInvoiceRead(null, TODAY)).toEqual({ supplier: "", invoiceNo: "", invoiceDate: null, lines: [], skipped: [] });
    expect(parseInvoiceRead({ lines: "PEFY" }, TODAY).lines).toEqual([]);
  });
});

describe("the price of one", () => {
  it("is the unit price when the line's total agrees with it", () => {
    expect(eachOf(1105.4, 2210.8, 2)).toBe(1105.4);
    expect(eachOf(1.333, 4, 3)).toBe(1.333);
  });

  it("is the line's total over the quantity when the unit price is before the line's discount", () => {
    /* list $100 each, 40% off on the line, $120 for two */
    expect(eachOf(100, 120, 2)).toBe(60);
  });

  it("is never the line's total when the total has GST on it", () => {
    expect(eachOf(100, 220, 2)).toBe(100);
  });

  it("is whichever was printed when only one was", () => {
    expect(eachOf(0, 300, 4)).toBe(75);
    expect(eachOf(42, 0, 4)).toBe(42);
    expect(eachOf(0, 0, 4)).toBe(0);
  });
});

describe("whose invoice it is", () => {
  it("knows a supplier by every word of its name", () => {
    expect(namesSupplier("Mitsubishi Electric Australia Pty Ltd", "Mitsubishi Electric")).toBe(true);
    expect(namesSupplier("AAD Pty Ltd", "AAD")).toBe(true);
    expect(namesSupplier("Mitsubishi Heavy Industries", "Mitsubishi Electric")).toBe(false);
    expect(namesSupplier("Pty Ltd", "Pty Ltd")).toBe(false);
  });

  it("names another of the business's suppliers when the invoice is theirs, not the one it's added to", () => {
    const all = ["AAD", "Reece", "Mitsubishi Electric"];
    expect(otherSupplierNamed("Reece Australia Pty Ltd", "AAD", all)).toBe("Reece");
    expect(otherSupplierNamed("AAD Pty Ltd", "AAD", all)).toBeNull();
    expect(otherSupplierNamed("Rexel Electrical", "AAD", all)).toBeNull();
    expect(otherSupplierNamed("", "AAD", all)).toBeNull();
  });
});

describe("what a line does to the book", () => {
  const me: Supplier = { key: "mitsubishi", name: "Mitsubishi Electric", pricing: "list_less", file: "pdf", format: "me_pdf", discountPct: 30, rules: [] };
  const held = (code: string, h: Partial<HeldItem>): [string, HeldItem] => [
    code,
    {
      code,
      name: code,
      cents: 0,
      previous_cents: null,
      price_changed_at: null,
      first_seen_at: "2026-08-11T00:00:00Z",
      last_import_at: "2026-08-11T00:00:00Z",
      current: true,
      on_list: true,
      paid_cents: null,
      paid_on: null,
      times_bought: null,
      qty_bought: null,
      listed_on: "2026-08-11",
      priced_on: "2026-08-11",
      ...h,
    },
  ];

  it("is new, or the newer price over the list's less the discount, or the newer invoice the book keeps", () => {
    const book = new Map([
      /* on the August list at $1,000, so a quote pays $700 */
      held("PUMY-P125YKM", { cents: 100000 }),
      /* a VRF indoor only ever invoiced, last paid in September */
      held("PEFY-P32VMA-E", { cents: 112000, on_list: false, listed_on: null, priced_on: null, paid_cents: 112000, paid_on: "2026-09-30" }),
      /* gone from the list: not in the book */
      held("PAR-OLD", { cents: 5000, current: false }),
    ]);
    const lines = [
      { code: "PUMY-P125YKM", name: "Outdoor", qty: 1, cents: 68000 },
      { code: "PEFY-P32VMA-E", name: "Ducted indoor", qty: 2, cents: 110540 },
      { code: "PAC-SE41TS-E", name: "Wired controller", qty: 2, cents: 9650 },
      { code: "PAR-OLD", name: "Old remote", qty: 1, cents: 4000 },
    ];
    expect(withBookPrices(lines, book, me, "2026-09-18").map(({ code, now, after }) => ({ code, now, after }))).toEqual([
      { code: "PUMY-P125YKM", now: 70000, after: 68000 },
      /* the September 30 invoice is newer than this one: the book keeps it */
      { code: "PEFY-P32VMA-E", now: 112000, after: 112000 },
      { code: "PAC-SE41TS-E", now: null, after: 9650 },
      { code: "PAR-OLD", now: null, after: 4000 },
    ]);
  });

  it("keeps a newer list's price over an older invoice's", () => {
    const book = new Map([held("PUMY-P125YKM", { cents: 100000, priced_on: "2026-10-01", listed_on: "2026-10-01" })]);
    const [l] = withBookPrices([{ code: "PUMY-P125YKM", name: "Outdoor", qty: 1, cents: 68000 }], book, me, "2026-09-18");
    expect([l!.now, l!.after]).toEqual([70000, 70000]);
  });
});

it("asks for every field it reads, with nothing left open — structured output needs all of them required", () => {
  const item = INVOICE_LINES_SCHEMA.properties.lines.items;
  expect([...INVOICE_LINES_SCHEMA.required].sort()).toEqual(Object.keys(INVOICE_LINES_SCHEMA.properties).sort());
  expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  expect(INVOICE_LINES_SCHEMA.additionalProperties).toBe(false);
  expect(item.additionalProperties).toBe(false);
});
