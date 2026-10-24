/* A JOB'S BILLING, READ ONCE, EX GST (Isaac, 25 October 2026: "Figures need
   to be clearly excluding GST").

   What the Billing section draws: the job's value, the three-part bar (paid,
   invoiced and waiting, not invoiced), and a row a claim. Pure and
   client-safe; formatting dates and dollars happens here so the section and
   the claim it opens say each thing one way.

   EX GST IS STATED, NEVER WORKED OUT. Every ex-GST figure here is the sum of
   ServiceM8's own ex-GST `price` on a claim's lines (job-family's `exCents`).
   Nothing is divided by 1.1. Where a claim has no lines, its ex-GST figure
   isn't known, and the section says what it does know on the basis it is
   on, labelled, rather than guessing:

     · a row's amount falls back to the claim's own figure with "inc GST"
       beside it, or "—";
     · the job's value falls back to the family's total on its basis, or "—";
     · the bar is drawn only when the three parts are known on one basis. A
       part-paid claim splits into paid and waiting only inc GST, so on the ex
       basis it leaves the three figures as "—". */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "./project-money";
import { collectionFrom, type JobMoney } from "./job-money";
import { wholePercents, type FamilyClaim, type FamilyMoney, type MoneyBasis } from "./job-family";
import type { JobMaterialLine } from "./job-ledger";

export type BillingTone = "good" | "look" | "wrong" | "info";

/** One row under Payments, and the head of the claim it opens. */
export type PaymentRow = {
  /** the claim it opens; null on a row that is not a claim */
  claimId: string | null;
  /** "Deposit, 30%", or "Invoice" on a job not billed in stages */
  name: string;
  /** "Invoice #3237B, due Tue 29 Sept", "Not invoiced yet" */
  line: string;
  /** whole percent of the job, ex GST where every claim is known ex GST */
  percent: number | null;
  cents: number | null;
  /** the basis of `cents` when it is not ex GST */
  basis: MoneyBasis;
  /** "Paid Fri 11 Sept", "25 days overdue", "Awaiting", "To come" */
  word: string;
  tone: BillingTone;
};

export type BillingSegment = { key: "paid" | "waiting" | "tocome"; word: string; cents: number; percent: number };

export type BillingView = {
  /** the job's value; null cents is "—" */
  value: { cents: number | null; basis: MoneyBasis };
  /** a job with variations: the quote's own figure, and each variation's */
  quoted: { cents: number; variations: { n: number; cents: number }[] } | null;
  /** the three parts, on the value's basis; null when they can't be known */
  segments: BillingSegment[] | null;
  /** "Paid", "Invoiced, waiting", "Not invoiced": the figures under the bar,
      each null when it can't be known */
  figures: { paid: number | null; waiting: number | null; tocome: number | null };
  /** billed in stages: two claims or more */
  staged: boolean;
  rows: PaymentRow[];
  /** where collection stands, said as a fact, on a job with no claim rows */
  fact: string | null;
};

/** "Variation 2: return grille, Bed 2" → 2. The name an accepted variation's
    lines go to ServiceM8 under (lib/quotes/sm8-variation-plan,
    `variationLineName`), which is how a variation is told apart from the
    quote's own lines. */
export function variationNumberOf(name: string): number | null {
  const m = /^\s*variation\s+(\d+)\s*:/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** Each variation's lines summed, ex GST, from the job's own lines. Null
    when one of them has no ex-GST price: a part of a variation is no
    figure for it. */
export function variationsOf(lines: readonly Pick<JobMaterialLine, "name" | "exLineCents">[]): { n: number; cents: number }[] | null {
  const by = new Map<number, number>();
  for (const l of lines) {
    const n = variationNumberOf(l.name);
    if (n === null) continue;
    if (l.exLineCents == null) return null;
    by.set(n, (by.get(n) ?? 0) + l.exLineCents);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([n, cents]) => ({ n, cents }));
}

const day = (iso: string | null) => (iso ? fmtAuWeekdayDayMonth(iso) : "");

/** A claim's figure ex GST, as stated: its lines' prices, or its own amount
    when that amount was itself ex GST. */
const exOf = (c: FamilyClaim): number | null => c.exCents ?? (c.basis === "ex" ? c.amountCents : null);

function wordOf(c: FamilyClaim): { word: string; tone: BillingTone } {
  const late = c.overdueDays !== null ? (c.overdueDays === 1 ? "1 day overdue" : `${c.overdueDays} days overdue`) : null;
  switch (c.state) {
    case "paid":
      return { word: c.paidOn ? `Paid ${day(c.paidOn)}` : "Paid", tone: "good" };
    case "part":
      return late ? { word: late, tone: "wrong" } : { word: "Part paid", tone: "look" };
    case "awaiting":
      return late ? { word: late, tone: "wrong" } : { word: "Awaiting", tone: "look" };
    case "not_invoiced":
      return { word: "To come", tone: "info" };
    /* money in, nothing to check it against: neither settled nor owing */
    case "paid_unknown":
      return { word: "Part or all paid", tone: "info" };
    default:
      return { word: "Amount unknown", tone: "info" };
  }
}

/** Collection on a job there is no claim to read for — the job's own words,
    kept from the money block they came from. ORDER IS THE MEANING: a quote
    hasn't been billed, and "not invoiced", when ServiceM8 says so, beats any
    payment reading. */
function factOf(money: JobMoney | null, statusLabel: string | null, paidCents: number): string | null {
  if (statusLabel === "Quote") {
    if (money?.quoteSent === true) return `Quote sent${money.quoteSentOn ? ` ${day(money.quoteSentOn)}` : ""}`;
    return money?.quoteSent === false ? "Quote not sent yet" : null;
  }
  if (money?.invoiced === false) return "Not invoiced";
  switch (collectionFrom(money?.valueCents ?? null, paidCents)) {
    case "paid":
      return "Paid in full";
    case "part":
      return `Part paid, ${fmtAud(money!.valueCents! - paidCents)} inc GST still out`;
    case "awaiting":
      return "Nothing paid yet";
    case "paid_unknown_total":
      return "Part or all paid";
    default:
      return money?.paid ? `Paid${money.paidOn ? ` ${day(money.paidOn)}` : ""}` : null;
  }
}

export function readBilling({
  family,
  money,
  ledgerPaidCents,
  statusLabel,
  lines = [],
}: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  /** the job's own payments, for a job with no family read */
  ledgerPaidCents: number;
  statusLabel: string | null;
  /** the job's own lines, where its variations are */
  lines?: readonly Pick<JobMaterialLine, "name" | "exLineCents">[];
}): BillingView {
  /* NO FAMILY READ: the job's own labelled total, and the fact of where
     collection stands, as before. */
  if (!family || family.claims.length === 0) {
    return {
      value: { cents: money?.valueCents ?? null, basis: "inc" },
      quoted: null,
      segments: null,
      figures: { paid: null, waiting: null, tocome: null },
      staged: false,
      rows: [],
      fact: factOf(money, statusLabel, family ? family.paidCents : ledgerPaidCents),
    };
  }

  const staged = family.isFamily && family.claims.length > 1;
  /* A quote nobody has accepted, or a job ServiceM8 says it hasn't invoiced,
     can't be awaiting payment, whatever date its invoice field carries (#3169:
     a $4,015 quote drew "Awaiting payment"). */
  const ladder = !staged && (statusLabel === "Quote" || money?.invoiced === false);
  const claims = family.claims.map((c) =>
    ladder && c.paidCents === 0 && c.state !== "not_invoiced"
      ? { ...c, state: "not_invoiced" as const, dueOn: null, overdueDays: null }
      : c
  );

  const allEx = claims.every((c) => exOf(c) !== null);
  const valueEx = allEx ? claims.reduce((sum, c) => sum + (exOf(c) ?? 0), 0) : null;
  const value: BillingView["value"] =
    valueEx !== null
      ? { cents: valueEx, basis: "ex" }
      : { cents: family.valueCents, basis: family.basis ?? "inc" };

  const exPercents = allEx ? wholePercents(claims.map(exOf), valueEx) : null;

  /* THE THREE PARTS, on the value's own basis */
  let figures: BillingView["figures"] = { paid: null, waiting: null, tocome: null };
  if (valueEx !== null) {
    if (claims.every((c) => c.state === "paid" || c.state === "awaiting" || c.state === "not_invoiced")) {
      const sum = (s: FamilyClaim["state"]) => claims.filter((c) => c.state === s).reduce((t, c) => t + (exOf(c) ?? 0), 0);
      figures = { paid: sum("paid"), waiting: sum("awaiting"), tocome: sum("not_invoiced") };
    } else {
      /* still to bill is known ex GST whatever has been paid */
      figures = {
        paid: null,
        waiting: null,
        tocome: claims.filter((c) => c.state === "not_invoiced").reduce((t, c) => t + (exOf(c) ?? 0), 0),
      };
    }
  } else if (
    value.cents !== null &&
    family.awaitingCents !== null &&
    family.toComeCents !== null &&
    !claims.some((c) => c.state === "paid_unknown" || c.state === "unknown")
  ) {
    /* inc GST throughout: what came in, what is out, what is still to bill */
    figures = { paid: family.paidCents, waiting: family.awaitingCents, tocome: Math.max(0, family.toComeCents) };
  }

  const known = figures.paid !== null && figures.waiting !== null && figures.tocome !== null;
  const parts = known
    ? ([
        { key: "paid", word: "Paid", cents: figures.paid! },
        { key: "waiting", word: "Invoiced, waiting", cents: figures.waiting! },
        { key: "tocome", word: "Not invoiced", cents: figures.tocome! },
      ] as const).filter((p) => p.cents > 0)
    : [];
  const shares = wholePercents(
    parts.map((p) => p.cents),
    parts.reduce((t, p) => t + p.cents, 0)
  );
  const segments = known && parts.length > 0 ? parts.map((p, i) => ({ ...p, percent: shares[i] ?? 0 })) : null;

  /* VARIATIONS: lines ServiceM8 holds under "Variation N:" on the job. The
     quote's own figure is the value less them, ex GST only. */
  const variations = valueEx !== null ? variationsOf(lines) : null;
  const quoted =
    variations && variations.length > 0 && valueEx !== null
      ? { cents: valueEx - variations.reduce((t, v) => t + v.cents, 0), variations }
      : null;

  const rows: PaymentRow[] = claims.map((c, i) => {
    const percent = exPercents ? exPercents[i] : c.percent;
    const ex = exOf(c);
    const cents = ex ?? c.amountCents;
    const basis: MoneyBasis = ex !== null ? "ex" : c.basis ?? "inc";
    const pctWord = percent === null ? "" : percent === 0 ? ", <1%" : `, ${percent}%`;
    const name = staged ? `${c.stage}${pctWord}` : "Invoice";

    let line: string;
    if (c.state === "not_invoiced") {
      line = ladder ? factOf(money, statusLabel, 0) ?? "Not invoiced yet" : "Not invoiced yet";
    } else {
      const bits = [c.jobNumber ? `Invoice #${c.jobNumber}` : "Invoiced"];
      if ((c.state === "awaiting" || c.state === "part") && c.dueOn) bits.push(`due ${day(c.dueOn)}`);
      /* a part payment is what the customer paid, inc GST, and says so */
      if (c.state === "part" && c.paidCents > 0) bits.push(`${fmtAud(c.paidCents)} inc GST paid`);
      line = bits.join(", ");
    }
    return { claimId: c.remoteId, name, line, percent, cents, basis, ...wordOf(c) };
  });

  return { value, quoted, segments, figures, staged, rows, fact: null };
}

/** The claim's own line in its dialog: "Invoice #3237B, 30% of the job.
    Raised Tue 15 Sept, due Tue 29 Sept." */
export function claimLine(claim: FamilyClaim, row: Pick<PaymentRow, "percent">, staged: boolean): string {
  if (claim.state === "not_invoiced") return "Not invoiced yet.";
  const first = [claim.jobNumber ? `Invoice #${claim.jobNumber}` : "Invoice"];
  if (staged && row.percent !== null) first.push(`${row.percent === 0 ? "<1" : row.percent}% of the job`);
  const second: string[] = [];
  if (claim.raisedOn) second.push(`Raised ${day(claim.raisedOn)}`);
  if ((claim.state === "paid" || claim.state === "paid_unknown") && claim.paidOn) second.push(`paid ${day(claim.paidOn)}`);
  else if ((claim.state === "awaiting" || claim.state === "part") && claim.dueOn) second.push(`due ${day(claim.dueOn)}`);
  const lead = second.length > 0 ? second.join(", ") : "";
  return `${first.join(", ")}.${lead ? ` ${lead.charAt(0).toUpperCase()}${lead.slice(1)}.` : ""}`;
}
