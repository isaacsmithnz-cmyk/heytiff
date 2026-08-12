import {
  collectionState,
  jobMoneyOf,
  parseSm8AmountToCents,
} from "@/lib/workboard/job-money";

describe("parseSm8AmountToCents — reading ServiceM8's own number", () => {
  it("reads the padded decimals ServiceM8 actually sends", () => {
    expect(parseSm8AmountToCents("1234.5600")).toBe(123456);
    expect(parseSm8AmountToCents("12345.0000")).toBe(1234500);
    expect(parseSm8AmountToCents("640")).toBe(64000);
    expect(parseSm8AmountToCents("0.5")).toBe(50);
  });

  it("rounds to whole cents rather than carrying float dust", () => {
    // 0.1 + 0.2 arithmetic reaches the screen as a dollar figure; the round
    // is what stops "$12.35" and "$12.350000000000001" being the same job.
    expect(parseSm8AmountToCents("12.345")).toBe(1235);
    expect(parseSm8AmountToCents("19.99")).toBe(1999);
  });

  /* An unpriced job sends "0.0000". Treating that as $0 would print a decided
     number on a job nobody has priced — the row must say nothing instead. */
  it("treats zero as absent, not as a $0 job", () => {
    expect(parseSm8AmountToCents("0")).toBeNull();
    expect(parseSm8AmountToCents("0.0000")).toBeNull();
  });

  it("refuses anything that isn't a machine amount", () => {
    for (const junk of ["", "   ", "$1,234", "1,234.00", "abc", "12.34.56", "1e5"]) {
      expect(parseSm8AmountToCents(junk)).toBeNull();
    }
    expect(parseSm8AmountToCents(null)).toBeNull();
    expect(parseSm8AmountToCents(undefined)).toBeNull();
  });

  it("keeps a credit readable rather than dropping the sign", () => {
    expect(parseSm8AmountToCents("-250.00")).toBe(-25000);
  });
});

describe("jobMoneyOf", () => {
  it("reads flags as 1-means-yes and slices stamps to their day", () => {
    const m = jobMoneyOf({
      total_invoice_amount: "3960.0000",
      invoice_sent: 1,
      invoice_date: "2026-07-30 00:00:00",
      quote_sent: 0,
      quote_sent_stamp: null,
      payment_received: 1,
      payment_received_stamp: "2026-08-06 14:22:31",
    });
    expect(m).toEqual({
      valueCents: 396000,
      invoiced: true,
      invoicedOn: "2026-07-30",
      quoteSent: false,
      quoteSentOn: null,
      paid: true,
      paidOn: "2026-08-06",
    });
  });

  it("is all-absent for a job the mirror knows nothing about yet", () => {
    const m = jobMoneyOf({});
    expect(m.valueCents).toBeNull();
    expect(m.invoiced).toBe(false);
    expect(m.paid).toBe(false);
    expect(m.invoicedOn).toBeNull();
  });

  /* A flag that isn't exactly 1 is not a yes. ServiceM8 sends 0/1, but the
     shaper's coercer nulls anything unreadable, and null must not read true. */
  it("only 1 counts as a yes", () => {
    expect(jobMoneyOf({ invoice_sent: null }).invoiced).toBe(false);
    expect(jobMoneyOf({ payment_received: 0 }).paid).toBe(false);
  });
});

describe("collectionState", () => {
  it("names where a job stands with the customer", () => {
    expect(collectionState(jobMoneyOf({ payment_received: 1, invoice_sent: 1 }))).toBe("paid");
    expect(collectionState(jobMoneyOf({ invoice_sent: 1 }))).toBe("awaiting");
    expect(collectionState(jobMoneyOf({}))).toBe("not_invoiced");
  });

  /* Paid outranks invoiced: ServiceM8 can carry a payment against a job whose
     invoice flag was never flipped, and "awaiting payment" on money already in
     the bank is the reading that would chase a customer wrongly. */
  it("believes payment over the invoice flag", () => {
    expect(collectionState(jobMoneyOf({ payment_received: 1, invoice_sent: 0 }))).toBe("paid");
  });
});
