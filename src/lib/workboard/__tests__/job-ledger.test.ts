/* The job's ledger — materials and payments. The rules that matter here are
   about NOT inventing numbers: never deriving GST, never printing a partial
   sum as a total, and never adding inc-tax to ex-tax. */

import {
  collectionAgainst,
  fmtQuantity,
  materialLineOf,
  materialsTaxMixed,
  materialsTotalCents,
  parseSm8Quantity,
  paymentsTotalCents,
  type JobMaterialLine,
  type JobPaymentEntry,
} from "@/lib/workboard/job-ledger";

describe("parseSm8Quantity / fmtQuantity", () => {
  it("reads ServiceM8's padded decimals", () => {
    expect(parseSm8Quantity("2")).toBe(2);
    expect(parseSm8Quantity("1.5000")).toBe(1.5);
    expect(parseSm8Quantity(" 3 ")).toBe(3);
  });

  it("refuses anything unreadable rather than yielding NaN", () => {
    for (const bad of ["", "two", "1,5", null, undefined]) {
      expect(parseSm8Quantity(bad)).toBeNull();
    }
  });

  it("trims the padding back off for display", () => {
    expect(fmtQuantity(2)).toBe("2");
    expect(fmtQuantity(1.5)).toBe("1.5");
    expect(fmtQuantity(0.25)).toBe("0.25");
  });
});

describe("materialLineOf", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    uuid: "m-1",
    name: "Daikin CTXM35RVMA",
    quantity: "2.0000",
    price: "1000.0000",
    displayed_amount: "1100.0000",
    displayed_amount_is_tax_inclusive: 1,
    ...over,
  });

  /* The invoice figure is what the customer was shown, so it wins — and the
     flag rides beside it rather than being folded into a conversion. */
  it("reports the DISPLAYED amount and says whether it includes tax", () => {
    const line = materialLineOf(row());
    expect(line).toMatchObject({
      name: "Daikin CTXM35RVMA",
      quantity: 2,
      unitCents: 110000,
      taxInclusive: true,
      lineCents: 220000,
    });
  });

  it("falls back to the ex-tax price only when nothing was displayed", () => {
    const line = materialLineOf(row({ displayed_amount: null }));
    expect(line.unitCents).toBe(100000);
    // …and does NOT claim the fallback is tax-inclusive
    expect(line.taxInclusive).toBe(false);
  });

  /* ServiceM8 sends "0.0000" for an unpriced line; parseSm8AmountToCents
     reads that as an absence, and a total built on it would be a guess. */
  it("leaves the line total null when the price is an absence", () => {
    const line = materialLineOf(row({ displayed_amount: "0.0000", price: "0.0000" }));
    expect(line.unitCents).toBeNull();
    expect(line.lineCents).toBeNull();
  });

  it("leaves the line total null when the quantity is unreadable", () => {
    const line = materialLineOf(row({ quantity: "" }));
    expect(line.quantity).toBeNull();
    expect(line.lineCents).toBeNull();
  });

  it("names an unnamed line rather than rendering a blank row", () => {
    expect(materialLineOf(row({ name: "   " })).name).toBe("Unnamed item");
  });
});

describe("materialsTotalCents", () => {
  const line = (over: Partial<JobMaterialLine> = {}): JobMaterialLine => ({
    remoteId: "m-1",
    name: "Item",
    quantity: 1,
    unitCents: 10000,
    taxInclusive: true,
    lineCents: 10000,
    ...over,
  });

  it("adds the lines up", () => {
    expect(materialsTotalCents([line(), line({ remoteId: "m-2", lineCents: 5000 })])).toBe(15000);
  });

  /* The rule that matters: a sum that silently skipped a line it couldn't
     read is a number that lies under a heading that says "total". */
  it("refuses to total at all when any line couldn't be totalled", () => {
    expect(materialsTotalCents([line(), line({ remoteId: "m-2", lineCents: null })])).toBeNull();
  });

  it("has no total for no lines", () => {
    expect(materialsTotalCents([])).toBeNull();
  });
});

describe("materialsTaxMixed", () => {
  const line = (taxInclusive: boolean, id: string): JobMaterialLine => ({
    remoteId: id,
    name: "Item",
    quantity: 1,
    unitCents: 10000,
    taxInclusive,
    lineCents: 10000,
  });

  it("spots lines that disagree about tax — their sum means nothing", () => {
    expect(materialsTaxMixed([line(true, "a"), line(false, "b")])).toBe(true);
  });

  it("is quiet when they agree, or when there is nothing to disagree", () => {
    expect(materialsTaxMixed([line(true, "a"), line(true, "b")])).toBe(false);
    expect(materialsTaxMixed([line(true, "a")])).toBe(false);
    expect(materialsTaxMixed([])).toBe(false);
  });
});

describe("payments", () => {
  const pay = (over: Partial<JobPaymentEntry> = {}): JobPaymentEntry => ({
    remoteId: "p-1",
    amountCents: 240000,
    method: "Bank Transfer",
    note: null,
    takenOn: "2026-08-01",
    isDeposit: false,
    takenBy: "Luke Ingold",
    ...over,
  });

  it("counts deposits — money in the bank is money in the bank", () => {
    expect(
      paymentsTotalCents([pay({ isDeposit: true }), pay({ remoteId: "p-2", amountCents: 100000 })])
    ).toBe(340000);
  });

  it("treats an unreadable amount as nothing rather than poisoning the sum", () => {
    expect(paymentsTotalCents([pay(), pay({ remoteId: "p-2", amountCents: null })])).toBe(240000);
  });

  it("says where collection stands against the job's own total", () => {
    expect(collectionAgainst(685000, 685000)).toBe("paid");
    expect(collectionAgainst(700000, 685000)).toBe("paid");
    expect(collectionAgainst(240000, 685000)).toBe("part");
  });

  /* An unpriced job can't be compared against, and guessing would put
     "paid in full" on a job nobody has invoiced. */
  it("refuses the comparison when the job has no total", () => {
    expect(collectionAgainst(240000, null)).toBe("unknown");
    expect(collectionAgainst(0, 0)).toBe("unknown");
  });
});
