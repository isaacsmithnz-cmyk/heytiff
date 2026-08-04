import { csvCell, taxCsv, taxCsvFilename } from "../csv";
import { totalsFor, type TaxItem } from "../item";

const item = (over: Partial<TaxItem> = {}): TaxItem => ({
  id: "fuel:1",
  source: "fuel",
  date: "2026-03-14",
  supplier: "Shell Coburg",
  abn: "51824753556",
  category: "fuel",
  description: "Fuel — 62.4 L",
  amount: 158.4,
  gst: 14.4,
  staffName: "Jordan Mills",
  vehicle: "FRU397 — Hilux",
  receiptUrl: null,
  receiptIsImage: true,
  hasReceipt: true,
  provisional: false,
  ...over,
});

describe("csvCell", () => {
  it("quotes a value containing a comma", () => {
    expect(csvCell("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('The "Big" Servo')).toBe('"The ""Big"" Servo"');
  });

  it("neutralises a formula, and quotes it too when it needs quoting", () => {
    // Supplier names are read off a photograph, so this is reachable input.
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvCell("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
    expect(csvCell("+61 400 000 000")).toBe("'+61 400 000 000");
    expect(csvCell("-BP Fuel")).toBe("'-BP Fuel");
    expect(csvCell("@servo")).toBe("'@servo");
  });

  it("leaves ordinary text alone", () => {
    expect(csvCell("Shell Coburg")).toBe("Shell Coburg");
    expect(csvCell(null)).toBe("");
  });
});

describe("taxCsv", () => {
  it("writes a header and one row per item", () => {
    const csv = taxCsv([item(), item({ id: "fuel:2" })], 2026);
    const rows = csv.trimEnd().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Amount (incl GST)");
  });

  it("carries the figures unformatted, for arithmetic at the other end", () => {
    const row = taxCsv([item()], 2026).trimEnd().split("\r\n")[1];
    expect(row).toContain("158.40");
    expect(row).toContain("14.40");
    // ex-GST is derived, not guessed
    expect(row).toContain("144.00");
  });

  it("leaves ex-GST BLANK when no GST was recorded", () => {
    // The trap: reporting the full amount as ex-GST would overstate the
    // deduction on every receipt that didn't print a tax line.
    const row = taxCsv([item({ gst: null })], 2026).trimEnd().split("\r\n")[1];
    expect(row.split(",")).toContain("");
    expect(row).not.toContain("158.40,158.40");
  });

  it("spaces the ABN the way it is printed", () => {
    expect(taxCsv([item()], 2026)).toContain("51 824 753 556");
  });

  it("says whether the receipt is actually held", () => {
    expect(taxCsv([item()], 2026)).toContain(",Yes,");
    expect(taxCsv([item({ hasReceipt: false })], 2026)).toContain(",No,");
  });

  it("marks an unapproved claim rather than passing it off as accepted", () => {
    const csv = taxCsv([item({ source: "expense", provisional: true })], 2026);
    expect(csv).toContain("Awaiting approval");
  });

  it("uses CRLF, as RFC 4180 says and Excel expects", () => {
    expect(taxCsv([item()], 2026).endsWith("\r\n")).toBe(true);
  });
});

describe("taxCsvFilename", () => {
  it("names the file by financial year", () => {
    expect(taxCsvFilename(2026)).toBe("heytiff-tax-2025-26.csv");
  });
});

describe("totalsFor", () => {
  it("adds up amounts, GST and receipts held", () => {
    const t = totalsFor([
      item(),
      item({ id: "expense:1", source: "expense", category: "tools", amount: 55, gst: 5, hasReceipt: false }),
    ]);
    expect(t.amount).toBe(213.4);
    expect(t.gst).toBe(19.4);
    expect(t.count).toBe(2);
    expect(t.withReceipt).toBe(1);
  });

  it("treats a missing GST as nothing, not as zero-rated arithmetic", () => {
    const t = totalsFor([item({ gst: null }), item({ id: "fuel:2", gst: 10 })]);
    expect(t.gst).toBe(10);
  });

  it("keeps unapproved spend visible as its own figure", () => {
    const t = totalsFor([item({ source: "expense", provisional: true, amount: 40, gst: null })]);
    expect(t.provisionalAmount).toBe(40);
  });

  it("groups by category in a fixed order, skipping empty ones", () => {
    const t = totalsFor([
      item({ id: "expense:1", source: "expense", category: "tools", amount: 20, gst: null }),
      item(),
    ]);
    expect(t.byCategory.map((c) => c.category)).toEqual(["fuel", "tools"]);
    expect(t.byCategory[1].count).toBe(1);
  });

  it("rounds money once, at the end", () => {
    const t = totalsFor([
      item({ amount: 0.1, gst: null }),
      item({ id: "fuel:2", amount: 0.2, gst: null }),
    ]);
    expect(t.amount).toBe(0.3);
  });
});
