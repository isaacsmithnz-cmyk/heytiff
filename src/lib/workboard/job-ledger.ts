/* What went onto a job and what has been paid for it — pure, client-safe.

   THIS IS MONEY, AND MONEY IS GATED AT READ. Nothing here decides who may
   see it; the loaders do, by never SELECTing these tables without
   `workboard_money`. This file only decides what the numbers MEAN.

   GST IS NEVER DERIVED — the house rule, and it bites hardest here.
   ServiceM8 sends BOTH `price` (always ex-tax) and `displayed_amount` (what
   it prints on the invoice), plus a flag saying which of the two the
   displayed figure is. So a line has two honest totals and we must never
   compute the other one: multiplying an ex-tax price by 1.1 assumes a tax
   rate nobody told us, and `tax_rate_uuid` names a rate object this
   integration has not adopted. The line therefore reports the DISPLAYED
   amount, says whether it includes tax, and stops.

   COST IS NOT PRICE. `cost` is what the business paid; `price` is what the
   customer is charged. They are never shown as one figure, and cost is not
   surfaced at all here — a margin per line is a different feature with a
   different audience. */

import { parseSm8AmountToCents } from "./job-money";

/** ServiceM8 quantities arrive as strings ("2", "1.5000"). Null for anything
    unreadable so a bad row shows a line without a count rather than NaN. */
export function parseSm8Quantity(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2", "1.5", "0.25" — trailing zeros trimmed, because ServiceM8 pads to
    four decimals and "2.0000 × Split system" reads like a machine. */
export function fmtQuantity(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

export type JobMaterialLine = {
  remoteId: string;
  name: string;
  quantity: number | null;
  /** What ServiceM8 prints for ONE of these, in cents. Null when unpriced. */
  unitCents: number | null;
  /** Whether that figure already includes tax — ServiceM8's own flag, never
      inferred, and never used to convert between the two. */
  taxInclusive: boolean;
  /** quantity × unit, in cents. Null when either half is missing — an
      invented total is worse than a blank. */
  lineCents: number | null;
};

type MaterialRow = {
  uuid: string;
  name?: string | null;
  quantity?: string | null;
  price?: string | null;
  displayed_amount?: string | null;
  displayed_amount_is_tax_inclusive?: number | null;
};

export function materialLineOf(row: MaterialRow): JobMaterialLine {
  const quantity = parseSm8Quantity(row.quantity);
  /* displayed_amount is what the invoice shows; price is the ex-tax figure
     behind it. Prefer what the customer was actually shown, and fall back to
     price only when ServiceM8 sent no displayed figure at all. */
  const displayed = parseSm8AmountToCents(row.displayed_amount);
  const unitCents = displayed ?? parseSm8AmountToCents(row.price);
  const taxInclusive =
    displayed !== null && row.displayed_amount_is_tax_inclusive === 1;

  return {
    remoteId: row.uuid,
    name: row.name?.trim() || "Unnamed item",
    quantity,
    unitCents,
    taxInclusive,
    lineCents: quantity !== null && unitCents !== null ? Math.round(quantity * unitCents) : null,
  };
}

/** The lines' own sum, in cents — and ONLY when every line could be totalled.
    A partial sum under a heading that reads like a total is a number that
    lies; null makes the surface say so instead. */
export function materialsTotalCents(lines: readonly JobMaterialLine[]): number | null {
  if (lines.length === 0) return null;
  if (lines.some((l) => l.lineCents === null)) return null;
  return lines.reduce((sum, l) => sum + (l.lineCents ?? 0), 0);
}

/** True when the lines disagree about tax, which makes their sum meaningless
    — you cannot add an inc-GST line to an ex-GST one and print one figure. */
export function materialsTaxMixed(lines: readonly JobMaterialLine[]): boolean {
  if (lines.length < 2) return false;
  const first = lines[0].taxInclusive;
  return lines.some((l) => l.taxInclusive !== first);
}

/* ── payments ── */

export type JobPaymentEntry = {
  remoteId: string;
  amountCents: number | null;
  /** 'Cash' | 'Credit Card' | 'Stripe' | … verbatim from ServiceM8. */
  method: string | null;
  note: string | null;
  /** Naive local date part. */
  takenOn: string | null;
  isDeposit: boolean;
  takenBy: string | null;
};

/** What's been paid, in cents. Deposits count — money in the bank is money
    in the bank; the entry says which it was. */
export function paymentsTotalCents(entries: readonly JobPaymentEntry[]): number {
  return entries.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
}

/** "Paid in full", "Part paid — $2,400 of $6,850", or null when the job's own
    total is unknown and the comparison can't honestly be made. */
export function collectionAgainst(
  paidCents: number,
  jobTotalCents: number | null
): "paid" | "part" | "unknown" {
  if (jobTotalCents === null || jobTotalCents <= 0) return "unknown";
  return paidCents >= jobTotalCents ? "paid" : "part";
}
