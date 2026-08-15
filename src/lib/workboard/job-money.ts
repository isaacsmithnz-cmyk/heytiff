/* What a ServiceM8 job's money MEANS — pure, client-safe, and separate from
   project-money.ts on purpose: that file derives OUR ledger (budget,
   variations, claims), this one reads THEIR numbers off the mirror.

   TWO PARSERS, TWO JOBS, NEVER SHARED. parseAudToCents in project-money.ts is
   user-input semantics: it strips "$" and commas, accepts a typed minus for a
   credit variation, and caps at $100M so a fat-fingered digit fails loudly.
   This one reads a machine string ServiceM8 already validated — "1234.5600",
   arbitrary decimal padding, never a currency symbol. Handing one string to
   the wrong parser is how "$1,234" becomes null or "1234.5600" becomes
   $1,234.56 in one place and $1,234.5600 in another; keeping them apart is
   cheaper than remembering which is which.

   A ZERO IS A NULL HERE. ServiceM8 sends "0.0000" for a job nobody has priced
   yet — that is an absence, not a $0 job, and the row must render a dash
   rather than a number that looks decided.

   GST: `total_invoice_amount` IS INCLUSIVE OF GST. ServiceM8's docs never say,
   so this was settled against the live mirror by ARITHMETIC rather than by
   reading a screen — and it had to be, because ServiceM8's own UI shows BOTH
   bases and it is easy to read the wrong one:

     the work-order LIST column  →  this field         →  inc GST
     inside the job card         →  the material lines →  ex GST

   Different numbers from different endpoints, and both are correct. The proof,
   across the 56 jobs whose material lines are all tax-EXCLUSIVE
   (`displayed_amount_is_tax_inclusive = 0`): 37 have
   total_invoice_amount / sum(displayed_amount) = EXACTLY 1.1000, and ZERO sit
   at 1.0000. Independently, on jobs flagged paid, the payments recorded
   against them equal this field to the cent — a customer pays the
   tax-inclusive figure. (Jobs landing on neither ratio are ones whose
   materials aren't the whole invoice; noise, not counter-evidence.)

   Nothing here derives, adds or removes tax; the number is displayed as sent
   and LABELLED, which is the whole discipline — and the material lines keep
   their own ex-GST label from the ledger work, so one sheet can honestly show
   both. That label matters most where this number meets one of ours: a
   project's claims are mirrored from these invoices, so a budget typed ex-GST
   beside them would misstate progress by ten per cent — the classic
   one-number-computed-twice. `MONEY_BASIS` below is the single place the words
   live.

   THE TWO SENT FLAGS DO NOT ARRIVE, and pretending otherwise was a bug. On the
   live account every one of 3,455 jobs has `invoice_sent` and `quote_sent`
   NULL — not 0, null, meaning the key is absent from the response — while
   `payment_received` comes through on 45. So a boolean read of those flags
   said "not invoiced" about three thousand jobs when the truth was that nobody
   told us. `invoiced`/`quoteSent` are therefore TRISTATE: true, false, or null
   for "ServiceM8 didn't say", and every surface renders the null as silence
   rather than as a fact. Paid-ness is the one collection signal this account
   actually supplies; per-payment rows now mirror too (`sm8_job_payments`) and
   are the richer answer where a screen needs one. */

/** A ServiceM8 money string → cents. Null for absent, zero, or unreadable. */
export function parseSm8AmountToCents(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;
  // Machine format only: optional sign, digits, optional decimal tail of any
  // length. No "$", no thousands separators — if one ever arrives, something
  // upstream changed and null is the honest answer.
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents === 0) return null;
  return cents;
}

/** The words for what basis a figure is on, said once so two screens can't
    disagree. ServiceM8's job total is tax-inclusive (see the header). */
export const MONEY_BASIS = "inc GST";

/** ServiceM8's integer flags are 0/1 but arrive typed loosely. */
export function isSm8Flag(v: number | null | undefined): boolean {
  return typeof v === "number" && v === 1;
}

/** The tristate read: true, false, or NULL for "the field never arrived".
    Collapsing null into false is what let the board announce "Not invoiced"
    about jobs it knew nothing about. */
export function sm8Flag(v: number | null | undefined): boolean | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v === 1;
}

/** The money facts of one mirrored job, read once and shared by every surface
    that shows the job (row, sheet, claim mirror). */
export type JobMoney = {
  /** ServiceM8's job total in cents, INC GST; null when unpriced. */
  valueCents: number | null;
  /** True, false, or null for "ServiceM8 never sent the flag" — see header. */
  invoiced: boolean | null;
  /** Naive local date part, or null. */
  invoicedOn: string | null;
  quoteSent: boolean | null;
  quoteSentOn: string | null;
  paid: boolean;
  paidOn: string | null;
};

type JobMoneyRow = {
  total_invoice_amount?: string | null;
  invoice_sent?: number | null;
  invoice_date?: string | null;
  quote_sent?: number | null;
  quote_sent_stamp?: string | null;
  payment_received?: number | null;
  payment_received_stamp?: string | null;
};

/** Naive ServiceM8 stamps are 'YYYY-MM-DD HH:MM:SS'; the date part is all any
    money line shows, and slicing beats parsing a wall clock into a Date. */
const dayOf = (stamp: string | null | undefined): string | null =>
  typeof stamp === "string" && stamp.length >= 10 ? stamp.slice(0, 10) : null;

export function jobMoneyOf(row: JobMoneyRow): JobMoney {
  return {
    valueCents: parseSm8AmountToCents(row.total_invoice_amount),
    invoiced: sm8Flag(row.invoice_sent),
    invoicedOn: dayOf(row.invoice_date),
    quoteSent: sm8Flag(row.quote_sent),
    quoteSentOn: dayOf(row.quote_sent_stamp),
    // Paid stays a plain boolean: this flag DOES arrive, and "not paid" is a
    // safe thing to believe — it prompts a look, where a wrong "invoiced"
    // would stop one.
    paid: isSm8Flag(row.payment_received),
    paidOn: dayOf(row.payment_received_stamp),
  };
}

/** The columns every money read selects — one list, so a loader that gates
    money can't accidentally select six of the seven. */
export const SM8_JOB_MONEY_COLUMNS =
  "total_invoice_amount, invoice_sent, invoice_date, quote_sent, " +
  "quote_sent_stamp, payment_received, payment_received_stamp";

/* COLLECTION IS COUNTED FROM MONEY RECEIVED, NOT FROM A FLAG.

   The flags lost this job on the evidence. `invoice_sent` never arrives at
   all, and `payment_received` is set on 45 jobs while 1,819 completed ones
   carry actual payment rows — so believing it would call 1,774 paid jobs
   unpaid. The payment ledger is dense where the flags are sparse, and it is
   money in the bank rather than somebody's tick.

   THE TOTAL IS THE SPARSE SIDE HERE. `total_invoice_amount` is populated on
   93 of 3,455 jobs, so most jobs that were paid can't be compared against
   what they were worth. That asymmetry is why `paid_unknown_total` exists:
   "money came in, we can't say whether it's all of it" is a true sentence and
   a different one from "paid in full". */
export type CollectionState =
  | "paid"
  | "part"
  | "awaiting"
  | "paid_unknown_total"
  | "unknown";

export function collectionFrom(
  totalCents: number | null,
  paidCents: number
): CollectionState {
  const paid = paidCents > 0;
  if (totalCents === null || totalCents <= 0) {
    return paid ? "paid_unknown_total" : "unknown";
  }
  if (!paid) return "awaiting";
  return paidCents >= totalCents ? "paid" : "part";
}

/** True only where the money is genuinely outstanding: the job is worth a
    known amount and none of it has arrived. On the live account that is
    eleven completed jobs — a list somebody can act on, which is the whole
    point of a chip. */
export function isAwaitingPayment(state: CollectionState): boolean {
  return state === "awaiting" || state === "part";
}
