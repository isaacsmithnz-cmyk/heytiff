import {
  collectionState,
  jobMoneyOf,
  MONEY_BASIS,
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

  /* THE DISTINCTION THIS TYPE EXISTS FOR. On the live account ServiceM8 sends
     no invoice_sent key at all — 3,455 jobs, every one null, while
     payment_received arrives on 45. Reading that null as `false` had the board
     announce "Not invoiced" about three thousand jobs nobody had told us
     anything about. Absent and no are different answers. */
  it("tells 'ServiceM8 said no' apart from 'ServiceM8 didn't say'", () => {
    expect(jobMoneyOf({ invoice_sent: 0 }).invoiced).toBe(false);
    expect(jobMoneyOf({ invoice_sent: null }).invoiced).toBeNull();
    expect(jobMoneyOf({}).invoiced).toBeNull();

    expect(jobMoneyOf({ quote_sent: 0 }).quoteSent).toBe(false);
    expect(jobMoneyOf({}).quoteSent).toBeNull();
  });

  it("is all-absent for a job the mirror knows nothing about yet", () => {
    const m = jobMoneyOf({});
    expect(m.valueCents).toBeNull();
    expect(m.invoiced).toBeNull();
    expect(m.paid).toBe(false);
    expect(m.invoicedOn).toBeNull();
  });

  /* Paid stays a plain boolean on purpose: that flag DOES arrive, and "not
     paid" is safe to believe — it prompts a look, where a wrong "invoiced"
     would stop one. */
  it("only 1 counts as paid", () => {
    expect(jobMoneyOf({ payment_received: 0 }).paid).toBe(false);
    expect(jobMoneyOf({ payment_received: null }).paid).toBe(false);
    expect(jobMoneyOf({ payment_received: 1 }).paid).toBe(true);
  });
});

describe("collectionState", () => {
  it("names where a job stands with the customer", () => {
    expect(collectionState(jobMoneyOf({ payment_received: 1, invoice_sent: 1 }))).toBe("paid");
    expect(collectionState(jobMoneyOf({ invoice_sent: 1 }))).toBe("awaiting");
    expect(collectionState(jobMoneyOf({ invoice_sent: 0 }))).toBe("not_invoiced");
  });

  /* The common case on a real account, and it must NOT read as "not
     invoiced" — the surfaces render unknown as silence. */
  it("says unknown when ServiceM8 never sent the flag", () => {
    expect(collectionState(jobMoneyOf({}))).toBe("unknown");
    expect(collectionState(jobMoneyOf({ total_invoice_amount: "640.00" }))).toBe("unknown");
  });

  /* Paid outranks invoiced: ServiceM8 can carry a payment against a job whose
     invoice flag was never flipped, and "awaiting payment" on money already in
     the bank is the reading that would chase a customer wrongly. */
  it("believes payment over the invoice flag", () => {
    expect(collectionState(jobMoneyOf({ payment_received: 1, invoice_sent: 0 }))).toBe("paid");
    expect(collectionState(jobMoneyOf({ payment_received: 1 }))).toBe("paid");
  });
});

describe("the money basis", () => {
  /* Settled against the live account 2026-08-15: ServiceM8's job total is
     tax-inclusive. One constant, so a project budget typed beside a mirrored
     claim can't quietly be on the other basis. */
  it("is stated once and says inc GST", () => {
    expect(MONEY_BASIS).toBe("inc GST");
  });
});
