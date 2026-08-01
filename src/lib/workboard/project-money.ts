/* The project money model — derived, never stored, and the two axes NEVER mix.

   Axis 1, claiming progress: "Claimed $10,000 of $54,000 — $44,000 to go."
   Claimed is the sum of claim rows regardless of whether anyone has PAID
   them; paid-ness never appears in that line.

   Axis 2, collection per claim: each claim row is Awaiting payment or Paid.
   The rollups (awaiting/paid) exist for the detail screen's collection
   strip, not for the claimed-of-total line.

   Variations move the TARGET, not the claimed: an approved $4k variation
   turns a $50k job into a $54k job. A pending variation is shown beside the
   target, never inside it; a declined one is ledger history and counts for
   nothing. When a variation is later invoiced it becomes its own claim row.

   Everything here is pure and client-safe — the same numbers on the board
   chip, the detail screen and any future export, because they are the same
   function. Cents throughout; formatting is the caller's last step. */

export type VariationFact = {
  amountCents: number;
  status: "pending" | "approved" | "declined";
};

export type ClaimFact = {
  amountCents: number;
  status: "awaiting" | "paid";
};

export type ProjectMoney = {
  /** The budget as set on the project — null means "not tracked yet". */
  baseCents: number | null;
  /** Signed sum of APPROVED variations (credits subtract). */
  approvedVariationCents: number;
  /** Signed sum of PENDING variations — display beside the target, never in it. */
  pendingVariationCents: number;
  /** base + approved. Null without a base: variations alone are not a total. */
  revisedTotalCents: number | null;
  /** Axis 1 — every claim row, paid or not. */
  claimedCents: number;
  /** revised − claimed. Negative means claimed past the target — surfaced, not clamped. */
  remainingCents: number | null;
  /** Axis 2 rollups — the collection story, kept off the claimed line. */
  awaitingCents: number;
  paidCents: number;
  /** claimed / revised, whole percent. Null without a revised total. */
  claimedPercent: number | null;
};

export function deriveProjectMoney(input: {
  budgetCents: number | null;
  variations: readonly VariationFact[];
  claims: readonly ClaimFact[];
}): ProjectMoney {
  const base = input.budgetCents;

  let approved = 0;
  let pending = 0;
  for (const v of input.variations) {
    if (v.status === "approved") approved += v.amountCents;
    else if (v.status === "pending") pending += v.amountCents;
  }

  let claimed = 0;
  let awaiting = 0;
  let paid = 0;
  for (const c of input.claims) {
    claimed += c.amountCents;
    if (c.status === "paid") paid += c.amountCents;
    else awaiting += c.amountCents;
  }

  const revised = base === null ? null : base + approved;

  return {
    baseCents: base,
    approvedVariationCents: approved,
    pendingVariationCents: pending,
    revisedTotalCents: revised,
    claimedCents: claimed,
    remainingCents: revised === null ? null : revised - claimed,
    awaitingCents: awaiting,
    paidCents: paid,
    claimedPercent:
      revised === null || revised <= 0 ? null : Math.round((claimed / revised) * 100),
  };
}

/* ── formatting & parsing ── */

/** "$54,000" — whole dollars unless the cents are real ("$1,234.50").
    Deterministic string maths, no Intl, so server and client never disagree. */
export function fmtAud(cents: number): string {
  const rounded = Math.round(cents);
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = rem === 0 ? `$${withCommas}` : `$${withCommas}.${String(rem).padStart(2, "0")}`;
  return neg ? `-${core}` : core;
}

/** What people type — "50000", "$50,000", "1234.50", "-4000" (a credit
    variation). Null for anything that isn't money; caps at $100M because a
    fat-fingered extra digit should fail loudly, not become the target. */
export function parseAudToCents(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents)) return null;
  if (Math.abs(cents) > 10_000_000_000) return null;
  return cents;
}

/** The axis-1 sentence, built one way everywhere. */
export function claimedLine(money: ProjectMoney): string | null {
  if (money.revisedTotalCents === null) return null;
  const claimed = fmtAud(money.claimedCents);
  const total = fmtAud(money.revisedTotalCents);
  const rem = money.remainingCents ?? 0;
  if (rem < 0) {
    return `Claimed ${claimed} of ${total} — ${fmtAud(-rem)} over the total`;
  }
  return `Claimed ${claimed} of ${total} — ${fmtAud(rem)} to go`;
}
