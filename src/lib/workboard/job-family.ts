/* A ServiceM8 job FAMILY — the progress-billing shape, made readable.

   WHAT SERVICEM8 DOES. It has no concept of a progress claim, so it bills one
   by CLONING the job: #2380's deposit becomes job #2380A, its progress claim
   becomes #2380B, and the parent gets a negative "Partial invoice #2380A"
   material line subtracting each one back out again. Three job cards, two of
   them wearing minus signs, for one job the customer thinks of as one job.

   WHAT THAT COSTS US, on the live account, before this file existed:

     · 478 of 3,493 active jobs are variants — one row in seven on the board
       is a progress invoice in a job costume, shown as an independent job.
     · The parent's own total is NET of its partials, so job #2380 reads as a
       $6,268 job when the work was worth $31,340.
     · Payments join by uuid and never by family, so a parent whose deposit
       landed on #2380A reads "Nothing paid yet" while $9,402 is in the bank.
     · The netting lines list as materials — "Partial invoice #2380A × −1".

   A VARIANT IS A CLAIM, NOT A JOB. That is the whole idea here: the family is
   the job, each member is one claim against it, and the money block reads the
   way a builder's progress schedule reads — Payment 1 Deposit, Payment 2
   Progress, Payment 3 Final.

   ─────────────────────────────────────────────────────────────────────────
   GST IS NEVER DERIVED — and this file is where that rule bites hardest,
   because ServiceM8 states the family's numbers on TWO different bases:

     total_invoice_amount   inc GST   (job-money.ts proves it: 1.1000 exactly
                                       across every all-ex-lines job)
     a payment row          inc GST   (a customer pays the tax-inclusive figure)
     a material line        whichever `displayed_amount_is_tax_inclusive` says
                                       — ex GST on every variant line live

   Nothing here multiplies by 1.1 to bridge them. Instead every claim carries
   the BASIS of its own amount, and a family total is stated only when every
   claim agrees on one. When they disagree the total is suppressed and the
   block says so — the same discipline materialsTaxMixed already applies to a
   single job's lines, applied one level up.

   WHERE A CLAIM'S AMOUNT COMES FROM, in order, and why:

     1. `total_invoice_amount` — ServiceM8's own stated total. Inc GST.
     2. A SETTLED payment — inc GST. Live, 404 of the 408 variants that have
        both payments and ex-GST lines are paid to exactly 1.1× their lines:
        the payment IS the invoice total, stated by ServiceM8, not computed by
        us. Only 10 variants carry a total of their own, so without this rule
        the feature would speak for almost none of the account.
     3. The variant's own material lines — on the lines' own basis.

   "SETTLED" IS DECIDED WITHOUT A TAX RATE. paid >= the ex-GST line total is a
   pure inequality: tax is never negative, so an inc-GST invoice is never less
   than its ex-GST lines, and a payment that clears the ex figure has cleared
   at least the whole ex value. A payment BELOW it is definitively part — live
   that is #1306B, $2,500 against $5,000 of lines — and a part payment must
   never be mistaken for the claim's value, so those fall through to rule 3
   and take the family total's basis with them.

   THE TWO AXES DO NOT MIX, exactly as project-money.ts has them. Axis 1 is
   invoicing: what the job is worth, how much of it has been claimed, what is
   still to come. Axis 2 is collection: per claim, paid or awaiting. Payments
   inform an amount ONLY through the settled rule above, and never appear in
   an axis-1 sentence.

   Pure and client-safe, cents throughout, formatting is the caller's job. */

import { plusDays } from "./dates";

/* ── the job number ── */

export type JobNumberParts = {
  /** The family's number — "2380" for both #2380 and #2380B. */
  base: string;
  /** "A", "B" … or null for the parent. */
  suffix: string | null;
};

/** Split a ServiceM8 job number into its family and its claim letter. Null
    for anything that isn't digits-then-an-optional-letter — live, that is no
    row at all (3,015 plain, 478 single-letter, 0 anything else), but a number
    this can't read must produce "no family", never a wrong one. */
export function splitJobNumber(raw: string | null | undefined): JobNumberParts | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d+)([A-Z])?$/.exec(raw.trim());
  if (!m) return null;
  return { base: m[1], suffix: m[2] ?? null };
}

/** Does `candidate` belong to `base`'s family? */
export function isFamilyMember(base: string, candidate: string | null | undefined): boolean {
  const parts = splitJobNumber(candidate);
  return parts !== null && parts.base === base;
}

/** EVERY job number this family could possibly wear — the parent and its
    twenty-six possible clones — so the read can ask for them BY NAME.

    A PREFIX MATCH IS THE WRONG QUESTION and it was a real bug: `ilike '15%'`
    asks for #15, #150–#159 and every #15xx in the account, hundreds of rows,
    and a capped window over them can come back without a single one of #15's
    own members in it. Twenty-seven exact equalities have no window to
    overflow, hit the same index, and cannot drag in a longer number at all.

    Built from the same alphabet splitJobNumber accepts, so the SQL and the
    filter cannot drift apart. */
export function familyNumbersFor(base: string): string[] {
  const out = [base];
  for (let c = 0; c < 26; c += 1) out.push(base + String.fromCharCode(65 + c));
  return out;
}

/* ── the netting lines ── */

/** ServiceM8's own subtraction row on the parent — "Partial invoice #2380A",
    quantity −1. It is bookkeeping, not a material, and listing it under "What
    went on the job" is how a $27,960 install grew two minus signs.

    THE NAME ALONE IS NOT ENOUGH, and the quantity alone is worse. Live there
    are 491 lines named "Partial invoice…": 459 negative ones on parents, and
    32 POSITIVE ones that are a variant's own charge ("Partial Invoice" ×1,
    $16,340 on #1047B) — dropping those would erase the claim itself. And 15
    "Discount" lines also carry quantity −1 and are real ledger entries. So
    the test is both halves: named as a partial invoice AND not adding
    anything. (The two live zero-quantity ones are parent netting rows that
    ServiceM8 has zeroed; they contribute nothing either way.) */
export function isPartialInvoiceLine(line: {
  name: string;
  quantity: number | null;
}): boolean {
  if (!/^\s*partial\s+invoice\b/i.test(line.name)) return false;
  return line.quantity !== null && line.quantity <= 0;
}

/* ── the derivation ── */

/** Which tax basis a figure is on. Never converted between. */
export type MoneyBasis = "inc" | "ex";

/** One member's material lines, already netted and already agreed on a
    basis.

    THREE STATES, NOT TWO, and the third is the whole point. `null` means this
    member HAS no lines — ServiceM8 never itemised it. `"unreadable"` means it
    has them and they cannot honestly be added: an unpriced row, or two rows
    disagreeing about tax. Collapsing those two into one null is how a PART
    payment came to stand as a claim's whole value — amountOf reads "no lines"
    as "nothing to test the payment against", which is true of an absence and
    a lie about a row we simply couldn't read. */
export type FamilyLineTotal = { cents: number; taxInclusive: boolean };
export type FamilyLines = FamilyLineTotal | "unreadable" | null;

/** What the mirror knows about one member of the family. */
export type FamilyMemberFacts = {
  remoteId: string;
  jobNumber: string | null;
  /** ServiceM8's stated job total in cents (inc GST), or null when unpriced. */
  totalCents: number | null;
  /** Summed payment rows against THIS member. Inc GST. Zero when none. */
  paidCents: number;
  /** The latest payment's day. */
  lastPaidOn: string | null;
  /** This member's own lines. Partial-invoice rows are KEPT on the parent —
      they are what net its quote down to its balance. */
  lines: FamilyLines;
  /** The day this claim was raised — invoice_date, else the clone's own day. */
  raisedOn: string | null;
};

export type ClaimState =
  /** Collected in full. */
  | "paid"
  /** Money in, but not all of it. */
  | "part"
  /** Raised and nothing has come in. */
  | "awaiting"
  /** Still to bill — the parent's remainder before the final invoice. */
  | "not_invoiced"
  /** Money in, and no way to say whether it is all of it — the claim's amount
      is the payment itself, with nothing to check it against. */
  | "paid_unknown"
  /** The mirror can't say what this one is worth. */
  | "unknown";

export type FamilyClaim = {
  remoteId: string;
  jobNumber: string | null;
  /** 1-based, in the order the trade schedules them. */
  index: number;
  /** The trade's own word for this position in the schedule. */
  stage: "Deposit" | "Progress" | "Final";
  amountCents: number | null;
  basis: MoneyBasis | null;
  /** Whole percent of the family's value; null when there is no family total
      to be a percent OF — a share of an unknown is not a share. */
  percent: number | null;
  raisedOn: string | null;
  paidCents: number;
  paidOn: string | null;
  state: ClaimState;
  /** raisedOn + the org's payment terms. Null when the terms aren't set —
      ServiceM8 never mirrors invoice terms, so an unset setting means nobody
      has told us, and a due date we invented would be worse than none. */
  dueOn: string | null;
  /** Whole days past due, when it is. Null otherwise. */
  overdueDays: number | null;
};

export type FamilyMoney = {
  /** How many job rows this family holds, this one included. */
  memberCount: number;
  /** True once ServiceM8 has cloned at least once — the block's other face. */
  isFamily: boolean;
  claims: FamilyClaim[];
  /** Every claim summed. Null when a claim is unreadable or the bases
      disagree — see the header. */
  valueCents: number | null;
  basis: MoneyBasis | null;
  /** Why the total is missing, when it is, so the block can say which. */
  mixedBasis: boolean;
  unknownClaim: boolean;
  /** Axis 1 — raised so far, and what is still to bill. */
  invoicedCents: number | null;
  toComeCents: number | null;
  /** Axis 2 — the collection rollups, kept off the axis-1 line. */
  paidCents: number;
  awaitingCents: number | null;
};

/** Days from `from` to `to`, both bare ISO dates. Negative when `to` is
    earlier. Midday-UTC anchored so no zone's DST can move a boundary. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The order the trade bills in: the clones in letter order, the parent last.

    THE PARENT IS THE FINAL CLAIM. ServiceM8 nets every partial out of it, so
    what is left on the parent is precisely the balance — the last invoice, or
    the amount still to bill if it hasn't gone out yet. */
function orderMembers(members: readonly FamilyMemberFacts[]): FamilyMemberFacts[] {
  return [...members].sort((a, b) => {
    const sa = splitJobNumber(a.jobNumber)?.suffix ?? null;
    const sb = splitJobNumber(b.jobNumber)?.suffix ?? null;
    if (sa === sb) return (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "");
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa.localeCompare(sb);
  });
}

/** What one member is worth, on which basis, and whether anything CORROBORATES
    it. See the header for the order and for why a part payment is never an
    amount.

    CORROBORATED means a second fact agrees with the figure: ServiceM8 stated
    it, or the member's own lines were readable and the payment cleared them.
    A payment with nothing to check it against is the only figure we have and
    is still shown — but it must not also be called settled. */
function amountOf(
  m: FamilyMemberFacts
): { cents: number; basis: MoneyBasis; corroborated: boolean } | null {
  if (m.totalCents !== null) return { cents: m.totalCents, basis: "inc", corroborated: true };

  /* UNREADABLE IS NOT ABSENT. A member whose lines wouldn't add is a member we
     cannot price, and no payment against it may stand in for the invoice —
     the exact misread readJobFamily declines a whole read to avoid when its
     caps are hit. */
  if (m.lines === "unreadable") return null;

  if (m.paidCents > 0) {
    /* Settled? `paid >= the lines` is the test, and it needs no tax rate in
       EITHER direction. Against ex-GST lines it is the inequality argued in
       the header: tax is never negative, so an inc-GST invoice is never less
       than its ex-GST lines. Against INC-GST lines it is simply a same-basis
       comparison — which is why this must not short-circuit on the flag. It
       once did, and that made any deposit against a tax-inclusive job the
       whole value of the job and marked it Paid: $1,100 in on an $11,000 job
       read as "$1,100 · Paid in full".

       With no lines at all there is nothing to test against. The payment is
       still the only figure ServiceM8 has ever stated for this claim, so it
       is what the claim is worth — but UNCORROBORATED, because "some money
       arrived" is not "this is what it was worth, and it is settled". */
    if (m.lines === null) return { cents: m.paidCents, basis: "inc", corroborated: false };
    if (m.paidCents >= m.lines.cents) {
      return { cents: m.paidCents, basis: "inc", corroborated: true };
    }
  }

  if (m.lines !== null) {
    return {
      cents: m.lines.cents,
      basis: m.lines.taxInclusive ? "inc" : "ex",
      corroborated: true,
    };
  }
  return null;
}

/** Has this claim been RAISED? A variant exists because an invoice went out,
    so it has by definition. The parent has when ServiceM8 dated its invoice
    or money has come in against it; before that, what is left on the parent
    is the part of the job still to bill. */
function isRaised(m: FamilyMemberFacts, isVariant: boolean): boolean {
  if (isVariant) return true;
  return m.raisedOn !== null || m.paidCents > 0;
}

export function deriveFamilyMoney(input: {
  members: readonly FamilyMemberFacts[];
  /** Today on the CONNECTED ACCOUNT's clock — never read from the clock here. */
  today: string;
  /** The org's payment terms in days, or null when nobody has set them. */
  termsDays: number | null;
}): FamilyMoney {
  const ordered = orderMembers(input.members);
  const memberCount = ordered.length;
  const isFamily = ordered.some((m) => splitJobNumber(m.jobNumber)?.suffix != null);

  type Draft = FamilyClaim & { raised: boolean; corroborated: boolean };
  const drafts: Draft[] = [];

  let paidTotal = 0;
  let mixedBasis = false;
  let unknownClaim = false;
  let basis: MoneyBasis | null = null;

  for (const m of ordered) {
    paidTotal += m.paidCents;
    const amount = amountOf(m);

    /* A member worth nothing is not a claim. A parent whose partials have
       consumed the whole job nets to zero — or, when ServiceM8 rounds a fee
       the other way, slightly past it — and a $0 row in a payment schedule
       reads as a claim for nothing rather than as no claim. Money in makes it
       a claim whatever the lines say. */
    if (amount !== null && amount.cents <= 0 && m.paidCents === 0) continue;

    if (amount === null) unknownClaim = true;
    else if (basis === null) basis = amount.basis;
    else if (basis !== amount.basis) mixedBasis = true;

    const variant = splitJobNumber(m.jobNumber)?.suffix != null;
    const raised = isRaised(m, variant);

    drafts.push({
      remoteId: m.remoteId,
      jobNumber: m.jobNumber,
      index: 0,
      stage: "Progress",
      amountCents: amount?.cents ?? null,
      basis: amount?.basis ?? null,
      percent: null,
      raisedOn: m.raisedOn,
      paidCents: m.paidCents,
      paidOn: m.lastPaidOn,
      state: "unknown",
      dueOn: null,
      overdueDays: null,
      raised,
      corroborated: amount?.corroborated ?? false,
    });
  }

  /* THE FAMILY'S VALUE, and the two reasons it can be missing. Both are
     stated rather than papered over: a suppressed total with a sentence
     beats a number that added ex-GST to inc-GST. */
  const readable = !unknownClaim && !mixedBasis && drafts.length > 0;
  const valueCents = readable
    ? drafts.reduce((sum, c) => sum + (c.amountCents ?? 0), 0)
    : null;

  let invoiced = 0;
  let awaiting = 0;
  /* An ex-GST claim amount minus an inc-GST payment is not a number anybody
     should read. The per-claim state machine below already refuses that
     comparison; this is the rollup refusing it too, rather than printing the
     difference between two bases as "Awaiting payment". */
  let awaitingUnreadable = false;

  const claims: FamilyClaim[] = drafts.map((d, i) => {
    const last = i === drafts.length - 1;
    const stage: FamilyClaim["stage"] =
      drafts.length === 1 ? "Final" : i === 0 ? "Deposit" : last ? "Final" : "Progress";

    let state: ClaimState;
    if (!d.raised) state = "not_invoiced";
    else if (d.amountCents === null) state = d.paidCents > 0 ? "part" : "unknown";
    else if (!d.corroborated) {
      /* The amount IS the payment and nothing agrees with it. Money came in;
         whether it was all of it is a question the mirror cannot answer, and
         "Paid in full" would be answering it anyway. */
      state = d.paidCents > 0 ? "paid_unknown" : "unknown";
    } else if (d.basis === "ex") {
      /* An ex-GST amount can't be compared with an inc-GST payment. It only
         reaches here when the payment FAILED the settled test, which already
         proved it short — so money in means part paid, and no money means
         the whole claim is still out. */
      state = d.paidCents > 0 ? "part" : "awaiting";
    } else if (d.paidCents >= d.amountCents) state = "paid";
    else if (d.paidCents > 0) state = "part";
    else state = "awaiting";

    if (d.raised && d.amountCents !== null && !mixedBasis && !unknownClaim) {
      /* Invoicing is axis 1 and every amount here shares one basis, so it
         adds. What is still OUT needs the payment subtracted from it, and
         that only works when the two are on the same basis. */
      invoiced += d.amountCents;
      if (d.basis === "ex" && d.paidCents > 0) awaitingUnreadable = true;
      else if (state === "paid" || state === "paid_unknown") {
        /* Nothing to add: a settled claim is settled, and one whose total
           nobody stated has no shortfall anyone can name. */
      } else awaiting += Math.max(0, d.amountCents - d.paidCents);
    }

    /* DUE-NESS NEEDS TERMS, and ServiceM8 does not mirror them. With the
       setting unset this stays null everywhere and the row simply says when
       it was raised. */
    const owing = state === "awaiting" || state === "part";
    const dueOn =
      owing && input.termsDays !== null && d.raisedOn !== null
        ? plusDays(d.raisedOn, input.termsDays)
        : null;
    const past = dueOn ? daysBetween(dueOn, input.today) : 0;

    return {
      ...d,
      index: i + 1,
      stage,
      state,
      percent: null,
      dueOn,
      overdueDays: dueOn !== null && past > 0 ? past : null,
    };
  });

  assignWholePercents(claims, valueCents);

  return {
    memberCount,
    isFamily,
    claims,
    valueCents,
    basis: readable ? basis : null,
    mixedBasis,
    unknownClaim,
    invoicedCents: valueCents === null ? null : invoiced,
    toComeCents: valueCents === null ? null : valueCents - invoiced,
    paidCents: paidTotal,
    awaitingCents: valueCents === null || awaitingUnreadable ? null : awaiting,
  };
}

/** Whole-percent shares that ADD UP. Rounding each claim on its own is the
    obvious way and it is wrong in public: three equal claims read 33/33/33
    under a total they are supposed to account for, and the reader is the one
    who notices. Largest remainder hands the spare points to the claims that
    lost the most in the rounding, so the column sums to exactly 100.

    A claim smaller than half a percent still lands on 0 — the block says
    "<1%" rather than "0% of the job", which reads as nothing at all. */
function assignWholePercents(claims: FamilyClaim[], valueCents: number | null): void {
  if (valueCents === null || valueCents <= 0) return;

  const shares = claims
    .map((c, i) => ({ i, cents: c.amountCents }))
    .filter((x): x is { i: number; cents: number } => x.cents !== null && x.cents >= 0)
    .map((x) => {
      const exact = (x.cents / valueCents) * 100;
      const whole = Math.floor(exact);
      return { i: x.i, whole, remainder: exact - whole };
    });
  if (shares.length === 0) return;

  let spare = 100 - shares.reduce((sum, s) => sum + s.whole, 0);
  for (const s of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (spare <= 0) break;
    s.whole += 1;
    spare -= 1;
  }
  for (const s of shares) claims[s.i].percent = s.whole;
}

/** The axis-1 sentence, built one way everywhere — the family shape of
    project-money.ts's claimedLine, and deliberately NOT "x% invoiced across
    3": a percentage and a count answer a question nobody asked while the two
    dollar figures are what a reader is actually chasing. */
export function familyInvoicedLine(
  money: FamilyMoney,
  fmt: (cents: number) => string
): string | null {
  if (money.valueCents === null || money.invoicedCents === null) return null;
  const toCome = money.toComeCents ?? 0;
  if (toCome <= 0) return `${fmt(money.invoicedCents)} invoiced in full`;
  return `${fmt(money.invoicedCents)} invoiced so far — ${fmt(toCome)} to come`;
}
