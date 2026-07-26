/* Expense claims — the rules, pure.

   A claim is money a staff member spent from their own pocket and wants back.
   Not the business's own bills: those live in Xero and reach the Rate
   Calculator as overheads. A reimbursement is owed to a PERSON.

   Everything here is a rule the server enforces, kept separate from the action
   so each one can be tested on its own and so the screen can apply the same
   rule before it lets someone press a button — the screen for kindness, the
   server for truth. */

export const EXPENSE_CATEGORIES = ["materials", "tools", "travel", "meals", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = [
  "pending",
  "approved",
  "declined",
  "reimbursed",
  "cancelled",
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return typeof v === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(v);
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
};

export type Claim = {
  id: string;
  staffProfileId: string;
  expenseDate: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  gstAmount: number | null;
  supplier: string | null;
  status: ExpenseStatus;
  reviewNote: string | null;
  createdAt: string;
  /** Signed URL for the attached receipt, minted per render. */
  receiptUrl?: string | null;
  receiptIsImage?: boolean;
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
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Can the claimant still take it back? Only while nobody has decided. */
export function isCancellable(status: ExpenseStatus): boolean {
  return status === "pending";
}

/** Is this claim still someone's problem — i.e. does it belong in a queue? */
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
};

export type ClaimRow = {
  expense_date: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  gst_amount: number | null;
  supplier: string | null;
};

/** The most anyone can claim in one go. Not a policy about spending — a guard
    against a typo'd amount (a missing decimal point) reaching an approver as
    though it were real. */
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
  if (amount > MAX_CLAIM) return { error: "That's larger than a claim can be — check the amount." };

  const date = (input.expenseDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date on the receipt." };
  if (date > today) return { error: "That date is in the future." };
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return { error: "Pick the date on the receipt." };
  if (ageDays > MAX_AGE_DAYS) return { error: "That receipt is too old to claim." };

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

  return {
    row: {
      expense_date: date,
      description: description.slice(0, 200),
      category: input.category,
      amount,
      gst_amount: gst,
      supplier,
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
