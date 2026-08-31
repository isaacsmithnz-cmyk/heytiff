/* The family derivation, tested against the LIVE shape of job #2380 — the
   family this design was traced on: a $27,960 quote billed as a 30% deposit
   (#2380A), a 50% progress claim (#2380B) and the netted balance left on the
   parent. Every figure below is ServiceM8's own, to the cent. */

import {
  claimFor,
  claimTitle,
  daysBetween,
  deriveFamilyMoney,
  familyInvoicedLine,
  familyNumbersFor,
  isFamilyMember,
  isPartialInvoiceLine,
  isPartialInvoicePaper,
  isPartialInvoiceStubNote,
  splitJobNumber,
  type FamilyMemberFacts,
} from "../job-family";
import { fmtAud } from "../project-money";

const parent = (over: Partial<FamilyMemberFacts> = {}): FamilyMemberFacts => ({
  remoteId: "p",
  jobNumber: "2380",
  totalCents: 626806,
  paidCents: 0,
  lastPaidOn: null,
  lines: { cents: 569824, taxInclusive: false },
  raisedOn: "2026-08-21",
  ...over,
});

const depositA = (over: Partial<FamilyMemberFacts> = {}): FamilyMemberFacts => ({
  remoteId: "a",
  jobNumber: "2380A",
  totalCents: null,
  paidCents: 940211,
  lastPaidOn: "2026-04-02",
  lines: { cents: 854737, taxInclusive: false },
  raisedOn: "2026-03-27",
  ...over,
});

const progressB = (over: Partial<FamilyMemberFacts> = {}): FamilyMemberFacts => ({
  remoteId: "b",
  jobNumber: "2380B",
  totalCents: null,
  paidCents: 1567018,
  lastPaidOn: "2026-04-10",
  lines: { cents: 1424562, taxInclusive: false },
  raisedOn: "2026-04-02",
  ...over,
});

const derive = (members: FamilyMemberFacts[], termsDays: number | null = null) =>
  deriveFamilyMoney({ members, today: "2026-08-26", termsDays });

describe("splitJobNumber", () => {
  it("reads a parent and a variant", () => {
    expect(splitJobNumber("2380")).toEqual({ base: "2380", suffix: null });
    expect(splitJobNumber("2380B")).toEqual({ base: "2380", suffix: "B" });
  });

  it("refuses anything it can't read rather than guessing a family", () => {
    expect(splitJobNumber("238-0")).toBeNull();
    expect(splitJobNumber("2380ab")).toBeNull();
    expect(splitJobNumber("")).toBeNull();
    expect(splitJobNumber(null)).toBeNull();
  });

  it("names every number the family could wear, and nothing else", () => {
    const wanted = familyNumbersFor("2380");
    expect(wanted).toHaveLength(27);
    expect(wanted[0]).toBe("2380");
    expect(wanted[1]).toBe("2380A");
    expect(wanted[26]).toBe("2380Z");
    // the alphabet the numbers are built from and the one splitJobNumber
    // accepts have to be the same one, or the read and the filter disagree
    expect(wanted.every((n) => isFamilyMember("2380", n))).toBe(true);
    expect(wanted).not.toContain("23800");
  });

  it("does not let a shorter number adopt a longer one", () => {
    expect(isFamilyMember("238", "2380")).toBe(false);
    expect(isFamilyMember("238", "238A")).toBe(true);
    expect(isFamilyMember("2380", "2380")).toBe(true);
  });
});

describe("isPartialInvoiceLine", () => {
  it("catches the parent's netting rows", () => {
    expect(isPartialInvoiceLine({ name: "Partial invoice #2380A", quantity: -1 })).toBe(true);
    expect(isPartialInvoiceLine({ name: "Partial Invoice #310G", quantity: -1 })).toBe(true);
    expect(isPartialInvoiceLine({ name: "Partial invoice #19A", quantity: 0 })).toBe(true);
  });

  it("leaves a variant's own positive charge alone", () => {
    // live: #1047B's whole invoice is one line called "Partial Invoice"
    expect(isPartialInvoiceLine({ name: "Partial Invoice", quantity: 1 })).toBe(false);
    expect(isPartialInvoiceLine({ name: "Partial Invoice 30%", quantity: 1 })).toBe(false);
  });

  it("leaves other negative lines alone", () => {
    // live: 15 "Discount" rows also carry quantity −1 and are real entries
    expect(isPartialInvoiceLine({ name: "Discount", quantity: -1 })).toBe(false);
    expect(isPartialInvoiceLine({ name: "Progress payment", quantity: -1 })).toBe(false);
  });
});

describe("deriveFamilyMoney — the #2380 family", () => {
  it("sums the parent and its clones to the job's real value", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.valueCents).toBe(3134035);
    expect(m.basis).toBe("inc");
    expect(m.isFamily).toBe(true);
    expect(m.memberCount).toBe(3);
  });

  it("numbers the claims the way the trade schedules them, parent last", () => {
    const m = derive([progressB(), parent(), depositA()]);
    expect(m.claims.map((c) => [c.index, c.stage, c.jobNumber])).toEqual([
      [1, "Deposit", "2380A"],
      [2, "Progress", "2380B"],
      [3, "Final", "2380"],
    ]);
  });

  it("gives each claim its whole-percent share", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.claims.map((c) => c.percent)).toEqual([30, 50, 20]);
  });

  it("reads a settled clone's payment as the claim's value", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.claims[0].amountCents).toBe(940211);
    expect(m.claims[0].basis).toBe("inc");
    expect(m.claims[0].state).toBe("paid");
    expect(m.claims[0].paidOn).toBe("2026-04-02");
  });

  it("counts collection across the family, which uuid joins never do", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.paidCents).toBe(2507229);
    expect(m.awaitingCents).toBe(626806);
    expect(m.claims[2].state).toBe("awaiting");
  });

  it("says what is still to bill when the parent has not invoiced", () => {
    const m = derive([
      parent({ raisedOn: null, totalCents: 626806 }),
      depositA(),
      progressB(),
    ]);
    expect(m.claims[2].state).toBe("not_invoiced");
    expect(m.invoicedCents).toBe(2507229);
    expect(m.toComeCents).toBe(626806);
    expect(familyInvoicedLine(m, fmtAud)).toBe("$25,072.29 invoiced so far — $6,268.06 to come");
  });
});

describe("deriveFamilyMoney — the basis guards", () => {
  it("never grosses an unpaid clone's ex-GST lines up to inc", () => {
    const m = derive([parent(), depositA({ paidCents: 0, lastPaidOn: null })]);
    expect(m.claims[0].amountCents).toBe(854737);
    expect(m.claims[0].basis).toBe("ex");
    expect(m.claims[0].state).toBe("awaiting");
  });

  it("suppresses the family total when the bases disagree", () => {
    const m = derive([parent(), depositA({ paidCents: 0, lastPaidOn: null })]);
    expect(m.mixedBasis).toBe(true);
    expect(m.valueCents).toBeNull();
    expect(m.basis).toBeNull();
    expect(m.invoicedCents).toBeNull();
    expect(m.awaitingCents).toBeNull();
    expect(m.claims.every((c) => c.percent === null)).toBe(true);
    expect(familyInvoicedLine(m, fmtAud)).toBeNull();
  });

  it("suppresses the total when a clone says nothing about its money", () => {
    const m = derive([parent(), depositA({ totalCents: null, paidCents: 0, lines: null })]);
    expect(m.unknownClaim).toBe(true);
    expect(m.valueCents).toBeNull();
    expect(m.claims[0].state).toBe("unknown");
  });

  it("refuses to call a part payment the claim's value", () => {
    // live #1306B: $2,500 in against $5,000 of ex-GST lines
    const m = derive([
      parent(),
      depositA({ paidCents: 250000, lines: { cents: 500000, taxInclusive: false } }),
    ]);
    expect(m.claims[0].amountCents).toBe(500000);
    expect(m.claims[0].basis).toBe("ex");
    expect(m.claims[0].state).toBe("part");
    expect(m.valueCents).toBeNull();
  });

  it("takes a payment that clears the ex-GST lines as settled", () => {
    // live: 404 of 408 clones are paid to exactly 1.1× their lines
    const m = derive([parent(), depositA()]);
    expect(m.claims[0].amountCents).toBe(940211);
    expect(m.mixedBasis).toBe(false);
  });
});

describe("deriveFamilyMoney — a payment is never the value of a claim it hasn't cleared", () => {
  /* THE INC-GST CASE IS THE EASY ONE, and it was the one that was wrong.
     When a member's lines already include tax, `paid >= lines` is a
     same-basis comparison needing no tax rate at all — so short-circuiting
     past it turned every deposit against an inc-GST job into that job's
     whole value, and marked it Paid. */
  const incLines = (over: Partial<FamilyMemberFacts> = {}): FamilyMemberFacts =>
    depositA({ lines: { cents: 1100000, taxInclusive: true }, ...over });

  it("keeps the lines as the value when an inc-GST claim is only part paid", () => {
    const m = derive([incLines({ paidCents: 110000, lastPaidOn: "2026-04-02" })]);

    expect(m.claims[0].amountCents).toBe(1100000);
    expect(m.claims[0].basis).toBe("inc");
    expect(m.claims[0].state).toBe("part");
    expect(m.valueCents).toBe(1100000);
    expect(m.awaitingCents).toBe(990000);
  });

  it("still takes the payment once it clears inc-GST lines", () => {
    const m = derive([incLines({ paidCents: 1100000, lastPaidOn: "2026-04-02" })]);

    expect(m.claims[0].amountCents).toBe(1100000);
    expect(m.claims[0].state).toBe("paid");
  });
});

describe("deriveFamilyMoney — the band between a claim's lines and its invoice", () => {
  /* THE ONE PLACE THE SETTLED RULE CANNOT TELL TWO STORIES APART. A claim with
     no stated total is worth its payment once that payment clears its lines —
     the inequality argued in the file header. But for EX-GST lines worth L,
     a payment anywhere in [L, 1.1 × L) has two readings and nothing to choose
     between them:

       · the invoice was L × 1.1 and this is a PART payment, or
       · the invoice was discounted and this IS the whole of it.

     The rule takes the second, so the claim reads Paid in full at whatever
     came in. These tests PIN that choice rather than bless it. The sharp end
     is a customer who pays the quote figure and leaves the GST behind: the
     card goes quiet about the tenth still owed.

     Live at the time of writing the band is not a live problem — 404 of the
     408 clones carrying both payments and ex-GST lines are paid to exactly
     1.1× them, the one below the band (#1306B, $2,500 against $5,000) is read
     as part paid, and the band's only occupants are the three #1047 clones,
     a job with a history of its own. Change the rule and these expectations
     should change with it, deliberately. */

  it("takes a payment that lands mid-band as the claim's whole value", () => {
    // $9,000 against $8,547.37 of ex-GST lines — short of the $9,402.11 an
    // inc-GST invoice for those lines would have asked for.
    const m = derive([parent(), depositA({ paidCents: 900000 }), progressB()]);
    const a = m.claims.find((c) => c.jobNumber === "2380A")!;

    expect(a.amountCents).toBe(900000);
    expect(a.basis).toBe("inc");
    expect(a.state).toBe("paid");
  });

  it("does the same when the payment is exactly the ex-GST figure", () => {
    const m = derive([parent(), depositA({ paidCents: 854737 }), progressB()]);
    const a = m.claims.find((c) => c.jobNumber === "2380A")!;

    expect(a.amountCents).toBe(854737);
    expect(a.state).toBe("paid");
    /* And the family wears it: $854.74 lighter than the same three claims
       paid in full, while still saying the job is invoiced in full. */
    expect(m.valueCents).toBe(3048561);
    expect(familyInvoicedLine(m, fmtAud)).toBe("$30,485.61 invoiced in full");
  });

  it("falls out of the band one cent lower, and the family total goes with it", () => {
    /* A single cent is the whole distance between the two readings above and
       this one: the payment no longer clears the lines, so the claim is worth
       its LINES on their own basis, that basis disagrees with the rest of the
       family, and the total stands down rather than adding ex GST to inc. */
    const m = derive([parent(), depositA({ paidCents: 854736 }), progressB()]);
    const a = m.claims.find((c) => c.jobNumber === "2380A")!;

    expect(a.amountCents).toBe(854737);
    expect(a.basis).toBe("ex");
    expect(a.state).toBe("part");
    expect(m.mixedBasis).toBe(true);
    expect(m.valueCents).toBeNull();
  });
});

describe("deriveFamilyMoney — lines that cannot be read are not lines that aren't there", () => {
  /* THE MISREAD THIS SEPARATION EXISTS TO STOP. `paid >= lines` needs lines to
     test against; with none, the payment stood in as the claim's whole value
     and the claim read Paid. That is right for a member ServiceM8 never
     itemised and wrong for one whose rows simply wouldn't add — and a single
     unpriced row is enough to make the difference, because
     parseSm8AmountToCents("0.0000") is null. */

  it("refuses to price a member whose lines are unreadable, whatever has been paid", () => {
    const m = derive([
      parent(),
      depositA({ paidCents: 250000, lines: "unreadable" }),
      progressB(),
    ]);
    const a = m.claims.find((c) => c.jobNumber === "2380A")!;

    expect(a.amountCents).toBeNull();
    expect(a.state).toBe("part");
    expect(m.unknownClaim).toBe(true);
    expect(m.valueCents).toBeNull();
  });

  it("takes a payment as the amount when there are truly no lines, but never calls it settled", () => {
    /* Money arrived and it is the only figure ServiceM8 has ever stated, so
       it is what the claim is worth. Whether it was ALL of it is a question
       nothing here can answer — and "Paid in full" answers it anyway. */
    const m = derive([depositA({ paidCents: 50000, lines: null })]);

    expect(m.claims[0].amountCents).toBe(50000);
    expect(m.claims[0].state).toBe("paid_unknown");
    expect(m.awaitingCents).toBe(0);
  });

  it("still settles a claim whose readable lines the payment cleared", () => {
    // the 404 clean clones: unchanged by the separation above
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.claims[0].state).toBe("paid");
  });
});

describe("deriveFamilyMoney — whole-percent shares add up", () => {
  it("hands the spare points to the biggest remainders rather than printing 99", () => {
    /* Three equal claims are 33.33% each. Rounded on their own they print
       33/33/33 under a total they are supposed to account for. */
    const m = derive([
      depositA({ totalCents: 100000, lines: null, paidCents: 0 }),
      progressB({ totalCents: 100000, lines: null, paidCents: 0 }),
      parent({ totalCents: 100000, lines: null, paidCents: 0 }),
    ]);

    expect(m.valueCents).toBe(300000);
    expect(m.claims.map((c) => c.percent)).toEqual([34, 33, 33]);
    expect(m.claims.reduce((sum, c) => sum + (c.percent ?? 0), 0)).toBe(100);
  });

  it("rounds a claim smaller than half a percent to zero, for the block to say <1%", () => {
    const m = derive([
      depositA({ totalCents: 100, lines: null, paidCents: 0 }),
      parent({ totalCents: 100000, lines: null, paidCents: 0 }),
    ]);

    expect(m.claims[0].percent).toBe(0);
    expect(m.claims.reduce((sum, c) => sum + (c.percent ?? 0), 0)).toBe(100);
  });
});

describe("deriveFamilyMoney — the awaiting rollup keeps to one basis", () => {
  /* An ex-GST claim amount and an inc-GST payment cannot be subtracted from
     one another. The per-claim state machine already refuses that comparison;
     the rollup underneath it must refuse it too, rather than quietly printing
     a difference between two different bases as "Awaiting payment". */
  it("states no awaiting figure when an ex-GST claim has money against it", () => {
    const m = derive([
      parent({ totalCents: null, lines: { cents: 1000000, taxInclusive: false } }),
      depositA({ totalCents: null, paidCents: 250000, lines: { cents: 500000, taxInclusive: false } }),
    ]);

    expect(m.basis).toBe("ex");
    expect(m.valueCents).toBe(1500000);
    expect(m.claims.find((c) => c.jobNumber === "2380A")!.state).toBe("part");
    expect(m.awaitingCents).toBeNull();
  });

  it("still adds up an ex-GST family that nobody has paid anything on", () => {
    const m = derive([
      parent({ totalCents: null, lines: { cents: 1000000, taxInclusive: false } }),
      depositA({ totalCents: null, paidCents: 0, lastPaidOn: null, lines: { cents: 500000, taxInclusive: false } }),
    ]);

    expect(m.awaitingCents).toBe(1500000);
  });
});

describe("deriveFamilyMoney — a job with no clones", () => {
  it("is a family of one and keeps ServiceM8's own total", () => {
    const m = derive([parent({ jobNumber: "1287", totalCents: 847000 })]);
    expect(m.isFamily).toBe(false);
    expect(m.memberCount).toBe(1);
    expect(m.valueCents).toBe(847000);
    expect(m.claims[0].percent).toBe(100);
  });

  it("drops a member that is worth nothing rather than claiming $0", () => {
    const m = derive([
      parent({ totalCents: null, lines: { cents: 0, taxInclusive: false } }),
      depositA(),
    ]);
    expect(m.claims.map((c) => c.jobNumber)).toEqual(["2380A"]);
    expect(m.valueCents).toBe(940211);
  });
});

describe("due-ness", () => {
  it("says nothing about due dates until the terms are set", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.claims[2].dueOn).toBeNull();
    expect(m.claims[2].overdueDays).toBeNull();
  });

  it("counts from the raise date plus the org's terms", () => {
    const m = derive([parent({ raisedOn: "2026-08-01" }), depositA(), progressB()], 14);
    expect(m.claims[2].dueOn).toBe("2026-08-15");
    expect(m.claims[2].overdueDays).toBe(11);
  });

  it("leaves a claim that isn't due yet without an overdue count", () => {
    const m = derive([parent({ raisedOn: "2026-08-21" }), depositA(), progressB()], 14);
    expect(m.claims[2].dueOn).toBe("2026-09-04");
    expect(m.claims[2].overdueDays).toBeNull();
  });

  it("never dates a claim that is already paid", () => {
    const m = derive([parent(), depositA(), progressB()], 14);
    expect(m.claims[0].dueOn).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts calendar days across a month end", () => {
    expect(daysBetween("2026-08-28", "2026-09-02")).toBe(5);
    expect(daysBetween("2026-09-02", "2026-08-28")).toBe(-5);
    expect(daysBetween("2026-08-28", "2026-08-28")).toBe(0);
  });
});

describe("claimTitle", () => {
  it("names a claim the way the trade schedules it", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(m.claims.map(claimTitle)).toEqual([
      "Payment 1 — Deposit",
      "Payment 2 — Progress",
      "Payment 3 — Final",
    ]);
  });
});

describe("claimFor", () => {
  it("finds the claim a job row is", () => {
    const m = derive([parent(), depositA(), progressB()]);
    expect(claimFor(m, "a")?.jobNumber).toBe("2380A");
    expect(claimFor(m, "p")?.stage).toBe("Final");
  });

  it("misses honestly for a member that never became a claim", () => {
    const m = derive([parent({ totalCents: null, lines: { cents: 0, taxInclusive: false } }), depositA()]);
    expect(claimFor(m, "p")).toBeNull();
    expect(claimFor(m, null)).toBeNull();
    expect(claimFor(null, "a")).toBeNull();
  });
});

describe("isPartialInvoiceStubNote", () => {
  it("catches the two sentences ServiceM8 generates", () => {
    expect(isPartialInvoiceStubNote("This job was created as a Partial Invoice for Job #2380")).toBe(true);
    expect(isPartialInvoiceStubNote("This job was created as a Partial Invoice for Job #461")).toBe(true);
    expect(isPartialInvoiceStubNote("Partial invoice #1103A created")).toBe(true);
    expect(isPartialInvoiceStubNote("  partial invoice  #872A   created.  ")).toBe(true);
  });

  /* The tempting rule — "a note on a clone is noise" — would bin 212 live
     notes that are somebody's actual writing. */
  it("leaves real writing alone, including ServiceM8's other lifecycle note", () => {
    expect(isPartialInvoiceStubNote("@lukeingold Please order new grill 1687x235")).toBe(false);
    expect(isPartialInvoiceStubNote("Job was re-opened after being completed.")).toBe(false);
    expect(isPartialInvoiceStubNote("Partial invoice raised but customer disputes the 30%")).toBe(false);
    expect(isPartialInvoiceStubNote("")).toBe(false);
    expect(isPartialInvoiceStubNote(null)).toBe(false);
  });
});

describe("isPartialInvoicePaper", () => {
  it("keeps the claim's own PDF out of the job's gallery", () => {
    expect(isPartialInvoicePaper("Partial Invoice #2380A")).toBe(true);
    expect(isPartialInvoicePaper("partial invoice 1194b.pdf")).toBe(true);
  });

  it("leaves the job's real paper alone", () => {
    expect(isPartialInvoicePaper("Diamond Air Solutions Pty LTD Invoice #2380")).toBe(false);
    expect(isPartialInvoicePaper("IMG_4021.jpg")).toBe(false);
    expect(isPartialInvoicePaper(null)).toBe(false);
  });
});
