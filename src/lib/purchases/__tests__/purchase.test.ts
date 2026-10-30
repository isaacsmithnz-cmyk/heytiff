import { againstQuote, bookSummary, bookWords, isClear, judgeLine, parseDocketRead, totalCents, whereItWent, type PurchaseLine } from "../purchase";

const TODAY = "2026-10-29";

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({
  id: "l",
  position: 0,
  code: "",
  name: "A line",
  qty: 1,
  cents: 1000,
  priceFrom: "docket",
  book: "none",
  bookBefore: null,
  bookAfter: null,
  wentTo: "open",
  jobUuid: null,
  jobLabel: null,
  ...over,
});

describe("parseDocketRead", () => {
  it("keeps what the price book would drop: no code, no price", () => {
    const read = parseDocketRead(
      {
        supplier: "Reece Pty Ltd",
        invoiceNo: "7729 4410",
        invoiceDate: "2026-10-29",
        lines: [
          { code: "9800008-1", description: "ARDENT PAIRCOIL 3/8 X 5/8", qty: 1, unitPriceExGst: 273.87, lineTotalExGst: 273.87 },
          { code: "9800005-1", description: "Ardent pair coil 1/4 x 3/8", qty: 1, unitPriceExGst: 0, lineTotalExGst: 0 },
          { code: "", description: "Spring nut M10", qty: 1, unitPriceExGst: 18.9, lineTotalExGst: 18.9 },
          { code: "FRT", description: "Freight", qty: 1, unitPriceExGst: 15, lineTotalExGst: 15 },
          { code: "X1", description: "Back ordered", qty: 0, unitPriceExGst: 5, lineTotalExGst: 0 },
        ],
      },
      TODAY
    );
    expect(read.lines).toEqual([
      { code: "9800008-1", name: "ARDENT PAIRCOIL 3/8 X 5/8", qty: 1, cents: 27387 },
      { code: "9800005-1", name: "Ardent pair coil 1/4 x 3/8", qty: 1, cents: null },
      { code: "", name: "Spring nut M10", qty: 1, cents: 1890 },
    ]);
    expect(read.skipped).toEqual([
      { name: "Freight", why: "not a product" },
      { name: "Back ordered", why: "none supplied" },
    ]);
    expect(read.invoiceDate).toBe("2026-10-29");
  });

  it("never merges two lines with one code: the purchase is the docket", () => {
    const read = parseDocketRead(
      { supplier: "AAD", invoiceNo: "", invoiceDate: "", lines: [
        { code: "A", description: "Duct", qty: 2, unitPriceExGst: 10, lineTotalExGst: 20 },
        { code: "A", description: "Duct", qty: 1, unitPriceExGst: 12, lineTotalExGst: 12 },
      ] },
      TODAY
    );
    expect(read.lines).toHaveLength(2);
    expect(read.invoiceDate).toBeNull();
  });

  it("refuses a date after today", () => {
    expect(parseDocketRead({ invoiceDate: "2026-11-02", lines: [] }, TODAY).invoiceDate).toBeNull();
  });
});

describe("judgeLine", () => {
  const docket = { code: "C", name: "N", qty: 1, cents: 27387 };
  it("a price up, down, the same, or new", () => {
    expect(judgeLine(docket, { now: 26840, after: 27387 })).toMatchObject({ book: "up", bookBefore: 26840, bookAfter: 27387 });
    expect(judgeLine(docket, { now: 28000, after: 27387 }).book).toBe("down");
    expect(judgeLine(docket, { now: 27387, after: 27387 }).book).toBe("same");
    expect(judgeLine(docket, { now: null, after: 27387 }).book).toBe("new");
  });
  it("a docket with no price takes the book's, and says so", () => {
    expect(judgeLine({ ...docket, cents: null }, { now: 15233, after: 0 })).toEqual({ cents: 15233, priceFrom: "book", book: "from_book", bookBefore: 15233, bookAfter: 15233 });
  });
  it("no price anywhere is asked for", () => {
    expect(judgeLine({ ...docket, cents: null }, { now: null, after: 0 }).cents).toBeNull();
    expect(judgeLine({ ...docket, cents: null }, null).cents).toBeNull();
  });
  it("a line that can't reach the book keeps the docket's price and changes nothing", () => {
    expect(judgeLine(docket, null)).toMatchObject({ cents: 27387, book: "none" });
  });
});

describe("where it went", () => {
  const lines = [
    line({ id: "1", wentTo: "job", jobUuid: "j1", jobLabel: "1352 Holbrook Ave", cents: 27387 }),
    line({ id: "2", wentTo: "stock", cents: 1890 }),
    line({ id: "3", wentTo: "job", jobUuid: "j1", jobLabel: "1352 Holbrook Ave", cents: 7452, qty: 2 }),
    line({ id: "4", wentTo: "job", jobUuid: "j2", jobLabel: "3304 Kirribilli Ave", cents: 2828 }),
  ];
  it("groups by job, stock last", () => {
    expect(whereItWent(lines)).toEqual([
      { key: "job:j1", wentTo: "job", jobUuid: "j1", label: "1352 Holbrook Ave", lines: 2, cents: 27387 + 14904 },
      { key: "job:j2", wentTo: "job", jobUuid: "j2", label: "3304 Kirribilli Ave", lines: 1, cents: 2828 },
      { key: "stock", wentTo: "stock", jobUuid: null, label: "Stock", lines: 1, cents: 1890 },
    ]);
  });
  it("is clear once nothing's open", () => {
    expect(isClear(lines)).toBe(true);
    expect(isClear([...lines, line({})])).toBe(false);
  });
  it("totals only what has a price", () => {
    expect(totalCents([line({ cents: 100, qty: 2 }), line({ cents: null })])).toBe(200);
  });
});

describe("the book, in words", () => {
  it("each line", () => {
    expect(bookWords(line({ book: "up", bookBefore: 26840, bookAfter: 27387 }))).toEqual({ text: "Price up, $268.40 to $273.87", tone: "or" });
    expect(bookWords(line({ book: "down", bookBefore: 2710, bookAfter: 2559 })).tone).toBe("gr");
    expect(bookWords(line({ book: "none", code: "" })).text).toBe("No code, not for the book");
  });
  it("the purchase", () => {
    expect(bookSummary([line({ book: "up" }), line({ book: "new" }), line({ book: "down" })])).toEqual({ text: "One price up, one new, one down", tone: "or" });
    expect(bookSummary([line({ book: "new" }), line({ book: "new" })]).text).toBe("Two new");
    expect(bookSummary([line({ book: "same" }), line({ book: "from_book" })]).text).toBe("Same as the book");
    expect(bookSummary([line({ book: "none" })]).text).toBe("Not for the book");
  });
});

describe("againstQuote", () => {
  it("inside or over, and nothing without an allowance", () => {
    expect(againstQuote(63810, 200240)).toEqual({ text: "Inside the quote", tone: "gr" });
    expect(againstQuote(210000, 200240)?.text).toBe("Over the quote");
    expect(againstQuote(100, null)).toBeNull();
  });
});
