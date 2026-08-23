/* Expenses — the rules, pure.

   TWO THINGS LIVE IN THIS TABLE, and `paidWith` is the whole difference.

   A CLAIM is money a staff member spent from their own pocket and wants back.
   It is owed to a PERSON, so it has an approval, a decision and a payment.

   A COMPANY RECORD is a receipt for something bought on the company's own card
   — the drill somebody picked up on the way to a job. The money has already
   left the business account, so nobody is owed anything and there is nothing
   to approve; what is missing is the DOCKET. Xero sees a card transaction off
   the bank feed with no receipt, no description and no category, and the one
   person who can supply all three is standing at the trade counter holding a
   phone. That is the same spend this table was built to catch, arriving by a
   different route (Isaac, 2026-08-23).

   Still not the business's own bills: rent, insurance, subscriptions live in
   Xero and reach the Rate Calculator as overheads. The line is not "whose
   money" — it is whether a receipt exists that only a phone will ever capture.

   Everything here is a rule the server enforces, kept separate from the action
   so each one can be tested on its own and so the screen can apply the same
   rule before it lets someone press a button — the screen for kindness, the
   server for truth. */

/* ── what a receipt may be ────────────────────────────────────────────────

   WHY THIS LIVES HERE and not beside the scanner: `actions/expense-ai.ts` is a
   `"use server"` file, where EVERY export becomes a Server Function and must
   therefore be async. A plain synchronous predicate exported from there
   typechecks, passes jest, and fails the build — so the shared rule sits in
   this module, which both the form and the scanner already import.

   PDFs are in the list because the emailed tax invoice is the normal receipt
   for anything bought on account, and the documents bucket has always accepted
   them; only the file picker was narrower. */
export const RECEIPT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const RECEIPT_PDF_TYPE = "application/pdf";

/** The picker's `accept`, and the same list the scanner enforces. */
export const RECEIPT_ACCEPT = [...RECEIPT_IMAGE_TYPES, RECEIPT_PDF_TYPE].join(",");

/** Can Tiff actually read this, or is it only storable? */
export function isReadableReceipt(mediaType: string): boolean {
  return (
    mediaType === RECEIPT_PDF_TYPE ||
    (RECEIPT_IMAGE_TYPES as readonly string[]).includes(mediaType)
  );
}

/* `fuel` is here because an expense claim means one thing — you paid from your
   own pocket and want it back — and fuel bought on a personal card is exactly
   that. Without the category it was being filed as "travel" or "other", which
   made it invisible to the tax screen's fuel reporting.

   It is also the category the fleet's "Log fuel · my own money" path raises a
   claim under, so the two ways a person can end up out of pocket for fuel
   produce the same kind of row. */
export const EXPENSE_CATEGORIES = ["materials", "tools", "travel", "meals", "fuel", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/* WHOSE MONEY BOUGHT IT. The same question `vehicle_logs.paid_with` asks, in
   the same two words, because it is the same question — and a fuel docket and
   a trade-counter docket should not need two vocabularies. */
export const PAID_WITH = ["own", "company"] as const;
export type PaidWith = (typeof PAID_WITH)[number];

export function isPaidWith(v: unknown): v is PaidWith {
  return typeof v === "string" && (PAID_WITH as readonly string[]).includes(v);
}

/* WHAT IT WAS BOUGHT FOR.

   The vocabulary is `workboard_notes.target_kind`'s, unchanged, because it is
   the same act — pointing a captured thing at work — and two vocabularies for
   one question is how a picker and a store stop agreeing. `JobCandidate.kind`
   in workboard/note-match uses these three words too, which is what lets the
   existing job picker feed this without a translation step.

   OPTIONAL, and both kinds carry it. Plenty of spend belongs to the business
   rather than to any one job — a new drill is the van's, not Tuesday's — and
   "which job" has nothing to do with whose card paid: materials bought for
   Northgate on a personal card are the same cost on the same job. */
export const JOB_KINDS = ["project", "visit", "agreement"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export function isJobKind(v: unknown): v is JobKind {
  return typeof v === "string" && (JOB_KINDS as readonly string[]).includes(v);
}

/** The job a row is against, as the screen reads it. `label` is a SNAPSHOT
    taken when the row was filed — see the migration: what this records is
    which job the money went on at the time, and re-deriving it from a job
    since renamed would rewrite history under the person who filed it. */
export type JobLink = { kind: JobKind; id: string; label: string };

export const EXPENSE_STATUSES = [
  "pending",
  "approved",
  "declined",
  "reimbursed",
  "cancelled",
  /* A company-card receipt is born here and stays here. It is not a claim
     waiting on anybody: the money moved when the card was tapped, so there is
     no decision to make and nothing to pay. Its author can still cancel it —
     see TRANSITIONS. */
  "recorded",
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return typeof v === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

/** The status a new row is born with, decided by who paid. Kept as a function
    rather than a constant so the two facts can never drift apart: a company
    row is `recorded`, an own-pocket row is `pending`, and nothing else. */
export function initialStatus(paidWith: PaidWith): ExpenseStatus {
  return paidWith === "company" ? "recorded" : "pending";
}

export function isExpenseStatus(v: unknown): v is ExpenseStatus {
  return typeof v === "string" && (EXPENSE_STATUSES as readonly string[]).includes(v);
}

/** How a category reads on screen. */
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  materials: "Materials",
  tools: "Tools",
  travel: "Travel",
  meals: "Meals",
  fuel: "Fuel",
  other: "Other",
};

/** How a status reads, from the CLAIMANT's side — "declined" is the fact,
    "waiting on approval" is what they actually want to know. */
export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  pending: "Waiting on approval",
  approved: "Approved — awaiting payment",
  declined: "Declined",
  reimbursed: "Reimbursed",
  cancelled: "Cancelled",
  /* Not "Approved" and not "Paid" — both would be answering a question nobody
     asked. What this row says is that the docket is filed and the business's
     own card paid for it. */
  recorded: "On the company card",
};

export type Claim = {
  id: string;
  staffProfileId: string;
  /* Set when this claim was raised BY a fuel log — "Log fuel · my own money".
     It is the reimbursement half of that purchase; the vehicle log is the tax
     half, and the tax screen skips this claim so one tank isn't counted twice.

     WHY IT REACHES THE SCREEN. Both people looking at this row have a question
     it answers. The claimant sees a claim they never filled in and needs to
     know where it came from. The approver, deciding whether to pay, needs to
     know the fuel itself is already recorded against a vehicle — otherwise
     "there's a fuel log AND a claim for the same tank" reads like a duplicate
     to be rejected, when it is the intended pair. */
  fuelLog?: { vehicleLogId: string; vehicle: string | null } | null;
  expenseDate: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  gstAmount: number | null;
  supplier: string | null;
  /** Whose money. `own` is a claim; `company` is a receipt, already paid. */
  paidWith: PaidWith;
  /** The job it was bought for, or null — most spend is against no one job. */
  job: JobLink | null;
  status: ExpenseStatus;
  reviewNote: string | null;
  createdAt: string;
  /** Signed URL for the attached receipt, minted per render. */
  /** Every finished receipt on the claim, signed for this render. */
  receipts?: { url: string | null; image: boolean }[];
};

/* ── what a claim may become ──────────────────────────────────────────────

   One table, so every transition is checked in one place. The shape says a
   claim only ever moves forward, and only from where it currently is: a
   declined claim cannot be quietly approved later, and an already-reimbursed
   one cannot be reimbursed twice. */

const TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  pending: ["approved", "declined", "cancelled"],
  // approved → cancelled is deliberately absent: once somebody has signed off
  // the spend, withdrawing it is a conversation, not a button.
  approved: ["reimbursed"],
  declined: [],
  reimbursed: [],
  cancelled: [],
  /* A company record never becomes approved or reimbursed, and this table is
     where that is enforced rather than in any screen: `decide()` and
     `markReimbursed()` both ask here first, so an approver who somehow reaches
     one gets a refusal instead of authorising a payment for money that never
     left anybody's pocket.

     Cancelled IS reachable, and has to be — a docket entered against the wrong
     purchase can only be withdrawn by the person who entered it, and nothing
     else in this app can remove it. */
  recorded: ["cancelled"],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Can the person who raised it still take it back? While nobody has decided
    — or, for a company record, at any point, because there is no decision
    coming and a wrong docket would otherwise be permanent. */
export function isCancellable(status: ExpenseStatus): boolean {
  return canTransition(status, "cancelled");
}

/** Is this claim still someone's problem — i.e. does it belong in a queue?

    `recorded` is deliberately not: nothing is owed and nobody is waiting, so a
    company receipt must never reach the approver's queue or the owed total.
    Every consumer of those two numbers gets that for free from this one line. */
export function isOpen(status: ExpenseStatus): boolean {
  return status === "pending" || status === "approved";
}

/* ── validating a new claim ── */

export type ClaimInput = {
  expenseDate: string;
  description: string;
  category: string;
  amount: number;
  gstAmount?: number | null;
  supplier?: string | null;
  /* The job, already resolved. The SERVER builds this, never the browser: an
     id off the wire is a claim about somebody else's data until a row in this
     org proves otherwise, and the label is printed on a screen. See
     `resolveJobLink` in actions/expenses.ts. */
  job?: JobLink | null;
  /* Absent means `own`, and that default is chosen for which way it FAILS.
     Both directions have a wrong answer: a claim filed as company-paid leaves
     somebody permanently out of their own money, and a card purchase filed as
     a claim asks the business to pay twice. The second one lands in front of
     an approver who can see the receipt and say no; the first is a silent row
     nobody ever looks at again. So the default fails toward the human. */
  paidWith?: string;
};

export type ClaimRow = {
  expense_date: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  gst_amount: number | null;
  supplier: string | null;
  paid_with: PaidWith;
  status: ExpenseStatus;
  job_kind: JobKind | "none";
  job_id: string | null;
  job_label: string | null;
};

/** The most anyone can put through in one go. Not a policy about spending — a
    guard against a typo'd amount (a missing decimal point) reaching an
    approver, or a tax report, as though it were real. */
export const MAX_CLAIM = 100_000;

/** How far back a receipt can be dated. Generous enough for a glovebox find,
    tight enough that a mistyped year is caught. */
export const MAX_AGE_DAYS = 730;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build the row to insert, or say what's wrong. Every check here is repeated
    from the form deliberately: the form is a courtesy, this is the rule. */
export function buildClaim(
  input: ClaimInput,
  today: string
): { row: ClaimRow } | { error: string } {
  const description = (input.description ?? "").trim();
  if (!description) return { error: "Say what the expense was for." };
  if (description.length > 200) return { error: "Keep the description under 200 characters." };

  if (!isExpenseCategory(input.category)) return { error: "Pick a category." };

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter how much it cost." };
  if (amount > MAX_CLAIM) return { error: "That's larger than a receipt can be — check the amount." };

  const date = (input.expenseDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date on the receipt." };
  if (date > today) return { error: "That date is in the future." };
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return { error: "Pick the date on the receipt." };
  if (ageDays > MAX_AGE_DAYS) return { error: "That receipt is too old to file." };

  /* GST above the total is arithmetically impossible and always a scan
     mis-read — refuse it rather than storing a figure that would make a BAS
     wrong later. */
  let gst: number | null = null;
  if (input.gstAmount !== null && input.gstAmount !== undefined && input.gstAmount !== 0) {
    const g = round2(Number(input.gstAmount));
    if (!Number.isFinite(g) || g < 0) return { error: "Check the GST amount." };
    if (g > amount) return { error: "GST can't be more than the total." };
    gst = g;
  }

  const supplier = (input.supplier ?? "").trim().slice(0, 120) || null;

  /* An unrecognised value is REFUSED rather than falling back to `own`. This
     one field decides whether the business is asked for money, and a silent
     fallback on a typo'd string is exactly how it would be asked wrongly. */
  const paidWith = input.paidWith ?? "own";
  if (!isPaidWith(paidWith)) return { error: "Say who paid for it." };

  /* A job is optional, and an ABSENT one is the common answer rather than a
     missing one. What is refused is a HALF link — a kind with no id, or an id
     with no kind — because neither is a state any reader can do anything with,
     and the column constraint refuses them anyway. */
  const job = input.job ?? null;
  if (job && (!isJobKind(job.kind) || !job.id)) return { error: "Pick the job again." };

  return {
    row: {
      expense_date: date,
      description: description.slice(0, 200),
      category: input.category,
      amount,
      gst_amount: gst,
      supplier,
      paid_with: paidWith,
      status: initialStatus(paidWith),
      job_kind: job ? job.kind : "none",
      job_id: job ? job.id : null,
      job_label: job ? job.label.slice(0, 160) : null,
    },
  };
}

/* ── totals ── */

/** What the business currently owes its people: claims approved but not yet
    paid, plus those still awaiting a decision. The Time & Pay tile shows this,
    so it has to mean something precise. */
export function owedTotal(claims: Pick<Claim, "status" | "amount">[]): number {
  return round2(
    claims.filter((c) => isOpen(c.status)).reduce((sum, c) => sum + (c.amount || 0), 0)
  );
}

export function pendingCount(claims: Pick<Claim, "status">[]): number {
  return claims.filter((c) => c.status === "pending").length;
}
