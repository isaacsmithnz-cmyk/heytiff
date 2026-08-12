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

   GST: the number is ServiceM8's own job total, displayed with ServiceM8's own
   meaning. Nothing here derives, adds or removes tax — see the money label
   helpers below and the house rule that GST is never derived. */

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

/** ServiceM8's integer flags are 0/1 but arrive typed loosely. */
export function isSm8Flag(v: number | null | undefined): boolean {
  return typeof v === "number" && v === 1;
}

/** The money facts of one mirrored job, read once and shared by every surface
    that shows the job (row, sheet, claim mirror). */
export type JobMoney = {
  /** ServiceM8's job total in cents; null when unpriced. */
  valueCents: number | null;
  invoiced: boolean;
  /** Naive local date part, or null. */
  invoicedOn: string | null;
  quoteSent: boolean;
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
    invoiced: isSm8Flag(row.invoice_sent),
    invoicedOn: dayOf(row.invoice_date),
    quoteSent: isSm8Flag(row.quote_sent),
    quoteSentOn: dayOf(row.quote_sent_stamp),
    paid: isSm8Flag(row.payment_received),
    paidOn: dayOf(row.payment_received_stamp),
  };
}

/** The columns every money read selects — one list, so a loader that gates
    money can't accidentally select six of the seven. */
export const SM8_JOB_MONEY_COLUMNS =
  "total_invoice_amount, invoice_sent, invoice_date, quote_sent, " +
  "quote_sent_stamp, payment_received, payment_received_stamp";

/** Where a completed job stands with the customer, in one word each. Only
    meaningful once the job is done — an open job isn't late to be paid. */
export function collectionState(m: JobMoney): "paid" | "awaiting" | "not_invoiced" {
  if (m.paid) return "paid";
  return m.invoiced ? "awaiting" : "not_invoiced";
}
