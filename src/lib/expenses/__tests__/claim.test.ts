import {
  buildClaim,
  canTransition,
  isCancellable,
  isOpen,
  MAX_CLAIM,
  owedTotal,
  pendingCount,
  type ExpenseStatus,
} from "../claim";

const TODAY = "2026-07-26";

const input = (over: Partial<Parameters<typeof buildClaim>[0]> = {}) => ({
  expenseDate: "2026-07-20",
  description: "Copper fittings",
  category: "materials",
  amount: 84.5,
  ...over,
});

describe("buildClaim", () => {
  it("builds a clean row", () => {
    const out = buildClaim(input({ gstAmount: 7.68, supplier: "Reece" }), TODAY);
    expect(out).toEqual({
      row: {
        expense_date: "2026-07-20",
        description: "Copper fittings",
        category: "materials",
        amount: 84.5,
        gst_amount: 7.68,
        supplier: "Reece",
        paid_with: "own",
        status: "pending",
        job_kind: "none",
        job_id: null,
        job_label: null,
      },
    });
  });

  it("rounds money to cents rather than storing float noise", () => {
    const out = buildClaim(input({ amount: 10.1 + 20.2 }), TODAY);
    expect("row" in out && out.row.amount).toBe(30.3);
  });

  it("insists on a description and a category", () => {
    expect(buildClaim(input({ description: "   " }), TODAY)).toEqual({
      error: "Say what the expense was for.",
    });
    expect(buildClaim(input({ category: "beer" }), TODAY)).toEqual({ error: "Pick a category." });
  });

  it("insists on a real amount", () => {
    expect(buildClaim(input({ amount: 0 }), TODAY)).toMatchObject({ error: expect.any(String) });
    expect(buildClaim(input({ amount: -5 }), TODAY)).toMatchObject({ error: expect.any(String) });
    expect(buildClaim(input({ amount: Number.NaN }), TODAY)).toMatchObject({ error: expect.any(String) });
  });

  /* Not a spending policy — a guard against a missing decimal point reaching
     an approver as though it were real. */
  it("refuses an amount larger than a claim can plausibly be", () => {
    expect(buildClaim(input({ amount: MAX_CLAIM + 1 }), TODAY)).toMatchObject({
      error: expect.stringContaining("check the amount"),
    });
  });

  it("refuses a future date and a mistyped year", () => {
    expect(buildClaim(input({ expenseDate: "2026-07-27" }), TODAY)).toEqual({
      error: "That date is in the future.",
    });
    expect(buildClaim(input({ expenseDate: "2019-07-20" }), TODAY)).toEqual({
      error: "That receipt is too old to file.",
    });
    expect(buildClaim(input({ expenseDate: "not a date" }), TODAY)).toMatchObject({
      error: expect.any(String),
    });
  });

  it("accepts today itself", () => {
    expect(buildClaim(input({ expenseDate: TODAY }), TODAY)).toHaveProperty("row");
  });

  /* GST above the total is arithmetically impossible and always a scan
     mis-read. Storing it would put a wrong figure on a BAS later. */
  it("refuses GST larger than the total", () => {
    expect(buildClaim(input({ amount: 50, gstAmount: 60 }), TODAY)).toEqual({
      error: "GST can't be more than the total.",
    });
  });

  it("treats no GST as null rather than zero", () => {
    // plenty of small receipts show no GST line, and guessing one-eleventh
    // would be inventing a tax figure
    expect(buildClaim(input({ gstAmount: 0 }), TODAY)).toMatchObject({ row: { gst_amount: null } });
    expect(buildClaim(input({ gstAmount: null }), TODAY)).toMatchObject({ row: { gst_amount: null } });
    expect(buildClaim(input(), TODAY)).toMatchObject({ row: { gst_amount: null } });
  });

  it("trims and caps free text", () => {
    const out = buildClaim(input({ description: `  ${"x".repeat(300)}  `, supplier: "  Reece  " }), TODAY);
    expect(out).toMatchObject({ error: expect.stringContaining("under 200 characters") });

    const ok = buildClaim(input({ supplier: "  Reece  " }), TODAY);
    expect("row" in ok && ok.row.supplier).toBe("Reece");
  });

  it("turns a blank supplier into null", () => {
    expect(buildClaim(input({ supplier: "   " }), TODAY)).toMatchObject({ row: { supplier: null } });
  });
});

describe("canTransition", () => {
  it("lets a pending claim be decided or withdrawn", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "declined")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
  });

  it("lets an approved claim be paid", () => {
    expect(canTransition("approved", "reimbursed")).toBe(true);
  });

  /* Paying twice is real money leaving the business twice. */
  it("refuses to pay a claim that is already paid", () => {
    expect(canTransition("reimbursed", "reimbursed")).toBe(false);
  });

  it("refuses to pay a claim nobody approved", () => {
    expect(canTransition("pending", "reimbursed")).toBe(false);
    expect(canTransition("declined", "reimbursed")).toBe(false);
  });

  it("never revives a decided claim", () => {
    for (const from of ["declined", "cancelled", "reimbursed"] as ExpenseStatus[]) {
      for (const to of ["approved", "pending", "declined"] as ExpenseStatus[]) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  /* Withdrawing something already signed off is a conversation, not a button. */
  it("won't let an approved claim be cancelled", () => {
    expect(canTransition("approved", "cancelled")).toBe(false);
  });
});

describe("isCancellable / isOpen", () => {
  it("only lets the claimant withdraw before anyone decides", () => {
    expect(isCancellable("pending")).toBe(true);
    for (const s of ["approved", "declined", "reimbursed", "cancelled"] as ExpenseStatus[]) {
      expect(isCancellable(s)).toBe(false);
    }
  });

  it("counts a claim as open until it is paid or refused", () => {
    expect(isOpen("pending")).toBe(true);
    expect(isOpen("approved")).toBe(true);
    for (const s of ["declined", "reimbursed", "cancelled"] as ExpenseStatus[]) {
      expect(isOpen(s)).toBe(false);
    }
  });
});

describe("owedTotal", () => {
  const claims = [
    { status: "pending" as const, amount: 84.5 },
    { status: "approved" as const, amount: 120.25 },
    { status: "reimbursed" as const, amount: 500 },
    { status: "declined" as const, amount: 90 },
    { status: "cancelled" as const, amount: 12 },
  ];

  /* The Time & Pay tile shows this, so it has to mean something precise:
     money the business still owes its people. Already-paid and refused claims
     are not owed. */
  it("is what's still owed — pending plus approved, nothing else", () => {
    expect(owedTotal(claims)).toBe(204.75);
  });

  it("is zero with nothing outstanding", () => {
    expect(owedTotal([])).toBe(0);
    expect(owedTotal([{ status: "reimbursed", amount: 500 }])).toBe(0);
  });

  it("counts only what someone is still waiting on a decision for", () => {
    expect(pendingCount(claims)).toBe(1);
  });
});

/* ── whose money ──────────────────────────────────────────────────────────

   `paidWith` is the only field in this module that decides whether the
   BUSINESS IS ASKED FOR MONEY, so every rule around it is pinned here rather
   than left to the screen that happens to set it today. */

describe("who paid", () => {
  const co = (over: Partial<Parameters<typeof buildClaim>[0]> = {}) =>
    buildClaim(input({ paidWith: "company", ...over }), TODAY);

  it("files a company-card row as recorded, and an own-pocket one as pending", () => {
    const company = co();
    expect("row" in company && company.row).toMatchObject({
      paid_with: "company",
      status: "recorded",
    });
    const own = buildClaim(input(), TODAY);
    expect("row" in own && own.row).toMatchObject({ paid_with: "own", status: "pending" });
  });

  /* THE DEFAULT FAILS TOWARD THE HUMAN. Both wrong answers are costly — a
     claim filed as company-paid leaves somebody permanently out of their own
     money; a card purchase filed as a claim asks the business to pay twice.
     The second lands in front of an approver holding the receipt, so that is
     the direction an unstated field must fall. */
  it("treats an unstated payer as own pocket, never as the company", () => {
    const out = buildClaim(input(), TODAY);
    expect("row" in out && out.row.paid_with).toBe("own");
    expect("row" in out && out.row.status).toBe("pending");
  });

  /* …and a value that is neither is REFUSED, not quietly defaulted: a silent
     fallback on a typo'd string is exactly how the business gets asked
     wrongly. */
  it("refuses a payer it doesn't recognise", () => {
    expect(buildClaim(input({ paidWith: "petty cash" }), TODAY)).toEqual({
      error: "Say who paid for it.",
    });
  });

  it("never lets a company record become approved or reimbursed", () => {
    expect(canTransition("recorded", "approved")).toBe(false);
    expect(canTransition("recorded", "reimbursed")).toBe(false);
    // …but its author can still take back a docket filed against the wrong
    // purchase, because nothing else in the app can remove it
    expect(canTransition("recorded", "cancelled")).toBe(true);
    expect(isCancellable("recorded")).toBe(true);
  });

  /* NOBODY IS OWED FOR THE COMPANY'S OWN MONEY. `owedTotal` and the approver
     queue both ride `isOpen`, so this one line keeps a card receipt out of the
     Time & Pay tile, the dashboard chip and the review list at once. */
  it("keeps a company record out of the open queue and the owed total", () => {
    expect(isOpen("recorded")).toBe(false);
    const rows = [
      { status: "pending" as const, amount: 100 },
      { status: "recorded" as const, amount: 900 },
    ];
    expect(owedTotal(rows)).toBe(100);
    expect(pendingCount(rows)).toBe(1);
  });
});

/* ── which job ────────────────────────────────────────────────────────────

   Optional, and it has to stay optional: a new drill is the van's, not
   Tuesday's. What is refused is a HALF link, because neither half is a state
   any reader can act on — and the column constraint refuses one anyway. */

describe("the job it was bought for", () => {
  it("files against no job by default, and says so in the row", () => {
    const out = buildClaim(input(), TODAY);
    expect("row" in out && out.row).toMatchObject({
      job_kind: "none",
      job_id: null,
      job_label: null,
    });
  });

  it("carries the job through when there is one", () => {
    const out = buildClaim(
      input({ job: { kind: "visit", id: "v1", label: "#1042 · Northgate Realty · Quarterly" } }),
      TODAY,
    );
    expect("row" in out && out.row).toMatchObject({
      job_kind: "visit",
      job_id: "v1",
      job_label: "#1042 · Northgate Realty · Quarterly",
    });
  });

  it("refuses a half link rather than filing against nothing", () => {
    // `as never` because the TYPE already refuses these — this pins the
    // RUNTIME refusal, which is the one a request off the wire has to meet
    expect(
      buildClaim(input({ job: { kind: "nonsense" as never, id: "v1", label: "x" } }), TODAY),
    ).toEqual({ error: "Pick the job again." });
    expect(buildClaim(input({ job: { kind: "visit", id: "", label: "x" } }), TODAY)).toEqual({
      error: "Pick the job again.",
    });
  });

  /* WHOSE CARD PAID HAS NOTHING TO DO WITH WHICH JOB. Materials for Northgate
     bought on a personal card are the same cost on the same job, and a rule
     that applied to one payer and not the other would be a hole to fall
     through. */
  it("is available to a claim and a card receipt alike", () => {
    const job = { kind: "project" as const, id: "p1", label: "Acme · Plant room" };
    for (const paidWith of ["own", "company"]) {
      const out = buildClaim(input({ paidWith, job }), TODAY);
      expect("row" in out && out.row).toMatchObject({ paid_with: paidWith, job_id: "p1" });
    }
  });
});
