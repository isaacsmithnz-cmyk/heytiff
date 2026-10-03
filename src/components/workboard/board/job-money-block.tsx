"use client";

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { collectionFrom, MONEY_BASIS, type JobMoney } from "@/lib/workboard/job-money";
import {
  claimTitle,
  familyInvoicedLine,
  type FamilyClaim,
  type FamilyMoney,
} from "@/lib/workboard/job-family";

/* THE MONEY BLOCK — one job's money, read once.

   It replaces a fact tile that could only ever say one sentence, and it is
   the only place on this card that money is derived: the materials and
   payments sections below list what ServiceM8 sent, this says what it MEANS.
   Balance owing used to be computed in two places on this sheet and printed
   in neither.

   THE BLOCK WEARS INK. It used to take the job type's colour as its edge —
   ServiceM8's category palette, which makes no contrast promise and, it
   turned out, no taste promise: a yellow ring around the figure looked bad
   (Isaac, 2026-09-10). The category keeps its dot in the chip up top; this
   block's edge is the stylesheet's, and no colour reaches it from the data.

   TWO AXES, NEVER ONE SENTENCE, straight out of project-money.ts:

     axis 1  what the job is worth, and how much of it has been invoiced
             — "$25,072 invoiced so far — $6,268 to come"
     axis 2  per claim, paid or awaiting — the ledger below the bar

   A JOB WITH NO CLONES wears the same block with the ledger folded away: the
   value, the bar, and one line saying where collection stands. A FAMILY opens
   the ledger and numbers the claims the way the trade schedules them. */

/** The words a claim's chip wears, and its tone. Inert — every one of them
    follows ServiceM8, which is what the tooltip says. */
function chipOf(claim: FamilyClaim): { word: string; tone: string } {
  switch (claim.state) {
    case "paid":
      return { word: "Paid", tone: " ok" };
    case "part":
      return { word: "Part paid", tone: " warn" };
    case "awaiting":
      return claim.overdueDays !== null
        ? { word: "Overdue", tone: " dan" }
        : { word: "Awaiting", tone: " warn" };
    case "not_invoiced":
      return { word: "To come", tone: "" };
    /* Money in, nothing to check it against. Deliberately toneless: green
       would say settled, amber would say chase it, and neither is known. */
    case "paid_unknown":
      return { word: "Part or all paid", tone: "" };
    default:
      return { word: "Amount unknown", tone: "" };
  }
}

/** The fragments under a claim's name. Each starts with a capital because
    each is its own statement, not a clause hanging off the one before. */
function metaOf(claim: FamilyClaim): string {
  const bits: string[] = [];
  // an invoice nobody has raised has no number to name
  if (claim.jobNumber && claim.state !== "not_invoiced") bits.push(`Invoice #${claim.jobNumber}`);
  if (claim.percent !== null) {
    // a real claim rounded to nothing reads as nothing at all
    bits.push(claim.percent === 0 ? "<1% of the job" : `${claim.percent}% of the job`);
  }
  if (claim.state === "not_invoiced") {
    bits.push("Not yet invoiced");
  } else {
    if (claim.raisedOn) bits.push(`Raised ${fmtAuWeekdayDayMonth(claim.raisedOn)}`);
    if ((claim.state === "paid" || claim.state === "paid_unknown") && claim.paidOn) {
      bits.push(`Paid ${fmtAuWeekdayDayMonth(claim.paidOn)}`);
    } else if (claim.state === "part") {
      bits.push(`Paid ${fmtAud(claim.paidCents)} so far`);
    } else if (claim.dueOn) {
      bits.push(`Due ${fmtAuWeekdayDayMonth(claim.dueOn)}`);
    }
  }
  return bits.join(", ");
}

/** What today's sheet says when the mirror can't be added up — kept word for
    word, because it is the only honest thing to say about a job ServiceM8
    never priced, and losing it to a prettier block would be a regression.

    ORDER IS THE MEANING. A quote hasn't been accepted, let alone billed.
    "Not invoiced", when ServiceM8 actually says so, beats any payment
    reading: the action is to bill it. Then collection, counted from payment
    rows rather than the flags — `payment_received` is set on 45 jobs while
    1,819 completed ones carry payments. */
function fallbackLine(
  money: JobMoney | null,
  statusLabel: string | null,
  paidCents: number
): string | null {
  if (statusLabel === "Quote") {
    if (money?.quoteSent === true) {
      return `Quote sent${money.quoteSentOn ? ` ${fmtAuWeekdayDayMonth(money.quoteSentOn)}` : ""}`;
    }
    return money?.quoteSent === false ? "Not sent yet" : null;
  }
  if (money?.invoiced === false) return "Not invoiced";

  switch (collectionFrom(money?.valueCents ?? null, paidCents)) {
    case "paid":
      return "Paid in full";
    case "part":
      return `Part paid — ${fmtAud(money!.valueCents! - paidCents)} still out`;
    case "awaiting":
      return "Nothing paid yet";
    case "paid_unknown_total":
      return "Part or all paid";
    default:
      return money?.paid
        ? `Paid${money.paidOn ? ` ${fmtAuWeekdayDayMonth(money.paidOn)}` : ""}`
        : null;
  }
}

/** Who the invoices go to: the client, and the contact the bills are
    addressed to when the job names one. */
export type BillTo = { name: string; contact: { name: string; email: string | null } | null };

/** A claim's segment on the terms bar: paid in ink's green, invoiced and
    waiting in amber, still to bill in the tint — the same three the old bar
    used, one segment a claim. */
const segOf = (c: FamilyClaim) =>
  c.state === "paid" || c.state === "paid_unknown" ? "paid" : c.state === "awaiting" || c.state === "part" ? "awaiting" : "tocome";

export function JobMoneyBlock({
  family,
  money,
  ledgerPaidCents,
  statusLabel,
  unavailable = false,
  focusRemoteId = null,
  onOpenClaim,
  billTo = null,
  deposit = null,
}: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  /** This job row's OWN payments, for the case where there is no family to
      count — a job number the family read couldn't parse, or a record read
      that came back without one. */
  ledgerPaidCents: number;
  statusLabel: string | null;
  /** The record read was refused or failed. The block says so rather than
      vanishing — and never falls back to this row's own total, which on a
      family is the netted figure the whole feature exists to stop showing. */
  unavailable?: boolean;
  /** The claim this card was opened for — marked in the ledger so a reader
      who searched "2380A" can see which of the three rows they asked for. */
  focusRemoteId?: string | null;
  /** Opens one claim's own modal; absent leaves the rows inert. */
  onOpenClaim?: (remoteId: string) => void;
  billTo?: BillTo | null;
  /** The deposit tick (Isaac, 2026-10-03: "if no deposit required make
      that as an option so it can get ticked off"). Absent where there is
      nothing to ask: a deposit invoice exists, or the work has started. */
  deposit?: { noDeposit: boolean; busy: boolean; error: string | null; onSet: (on: boolean) => void } | null;
}) {
  /* Collection is counted across the FAMILY when there is one. A parent whose
     deposit landed on #2380A used to read "Nothing paid yet" while $9,402 was
     in the bank, because payments join by uuid and never by family. With NO
     family the job's own ledger is the whole truth — reading zero there was
     the same bug pointing the other way, with the payments section three
     sections down listing the money this block said hadn't arrived. */
  const paidCents = family ? family.paidCents : ledgerPaidCents;

  /* `family ? … : …`, NEVER `??`. A family that DELIBERATELY stood its total
     down (mixed bases, an unpriced claim) has valueCents null, and falling
     through to this row's own figure resurrects the netted parent total this
     whole feature exists to kill — printing "$6,268.06" above claim rows
     worth more than it, and above the sentence saying there is no single
     figure. Only the absence of a family read may fall back. */
  const value = family ? family.valueCents : money?.valueCents ?? null;
  /* THE BASIS RIDES ON THE LABEL, and only when there is a figure for it to
     be the basis OF. A suppressed total under "Job value (inc GST)" claims a
     tax basis for a number that isn't there. */
  const basis = family ? family.basis : money?.valueCents != null ? "inc" : null;
  const basisWord = basis === "ex" ? " (ex GST)" : basis === "inc" ? ` (${MONEY_BASIS})` : "";

  const awaiting = family?.awaitingCents ?? null;
  const toCome = family?.toComeCents ?? null;
  const isFamily = family?.isFamily === true && family.claims.length > 1;

  /* The bar is drawn only against a total it can be a share OF. Widths are
     rounded to a tenth so three segments can't sum past 100 and wrap. */
  const pct = (n: number) =>
    value !== null && value > 0 ? `${Math.max(0, Math.min(100, (n / value) * 100)).toFixed(1)}%` : "0%";

  const overdue = (family?.claims ?? []).reduce<number | null>(
    (worst, c) => (c.overdueDays !== null && (worst === null || c.overdueDays > worst) ? c.overdueDays : worst),
    null
  );

  const segments = [
    { key: "paid", word: "Paid", cents: paidCents },
    { key: "awaiting", word: "Invoiced, awaiting", cents: awaiting ?? 0 },
    { key: "tocome", word: "Not yet invoiced", cents: toCome ?? 0 },
  ].filter((seg) => seg.cents > 0);

  const invoicedLine = family ? familyInvoicedLine(family, fmtAud) : null;
  /* WHERE COLLECTION GETS SAID, once. The tinted head row is the answer when
     there is an amount to chase or an amount that came in; the old tile's
     sentence is the answer when there isn't — a job nobody has billed yet,
     a quote, a job ServiceM8 never priced. Never both, and never a second
     summary under a claim ledger that already says it line by line. */
  /* ORDER IS THE MEANING, and the head rows must not jump the queue. A quote
     nobody has accepted cannot be "awaiting payment", and a job ServiceM8
     says it has not invoiced wants billing, not chasing — both sentences live
     in fallbackLine, which used to be reached only when no head row fired.
     Live that silenced #3169: a $4,015 Quote carrying an invoice_date drew an
     amber "Awaiting payment, 100% of the job" under its Quote chip. */
  const ladderSpeaksFirst = statusLabel === "Quote" || money?.invoiced === false;
  const showAwaitingHead = !ladderSpeaksFirst && awaiting !== null && awaiting > 0;
  /* "Paid in full" is about the WHOLE job, so it needs both axes to agree:
     nothing awaiting on what has been raised (axis 2) AND nothing left to
     raise (axis 1). awaitingCents counts only raised claims, so on its own it
     called a job paid in full with a final claim still to bill — directly
     under a line saying "$6,268.06 to come". */
  const showPaidHead =
    !ladderSpeaksFirst && awaiting === 0 && paidCents > 0 && (toCome ?? 0) <= 0;
  const fallback =
    !showAwaitingHead && !showPaidHead && (!isFamily || ladderSpeaksFirst)
      ? fallbackLine(money, statusLabel, paidCents)
      : null;

  /* A bar with one segment in it is a rectangle. It earns its place once
     there is more than one thing to compare. */
  /* AND NOT ACROSS TWO BASES. When the awaiting figure stood down because an
     ex-GST claim carries an inc-GST payment, the segments left are a paid
     figure drawn as a share of a total on the other basis — a picture of a
     subtraction the derivation just refused to do. */
  const barBasisSafe = !(family !== null && family.awaitingCents === null && family.paidCents > 0);
  const showBar = value !== null && value > 0 && segments.length > 1 && barBasisSafe;

  /* THE BALANCE DUE — the hero (Isaac, 2026-10-02: "how other companies do
     their invoicing pages… a hero total"). What is still owed on the whole
     job: invoiced and waiting, plus still to bill. Only where both halves are
     known and on one basis, and once something has been paid; otherwise the
     job's value takes the hero's place as it always did. */
  const balance =
    /* until something has come in, the balance IS the job's value, and the
       hero would say one figure twice */
    unavailable || paidCents <= 0
    ? null
    : family
      ? awaiting !== null && toCome !== null && barBasisSafe
        ? awaiting + Math.max(0, toCome)
        : null
      : value !== null && basis === "inc" && !ladderSpeaksFirst
        ? Math.max(0, value - paidCents)
        : null;
  /* the terms, a segment a claim, where the claims are a share of a total */
  const terms =
    !unavailable && isFamily && value !== null && value > 0 && barBasisSafe
      ? family!.claims.filter((c) => c.amountCents !== null && c.amountCents > 0)
      : null;

  return (
    <div className="wb2-shsect wb2-jmoney jcl-bill">
      {/* THE INVOICE'S HEAD (Isaac, 2026-10-02): who it's billed to on the
          left, the payment terms across the middle, and the balance due big
          on the right — where every invoice page puts it. */}
      <div className="jcl-billhead">
        {billTo && (
          <div className="jcl-billto">
            <span className="wb2-sect">Bill to</span>
            <b>{billTo.name}</b>
            {billTo.contact && <em>{billTo.contact.name}</em>}
            {billTo.contact?.email && <em>{billTo.contact.email}</em>}
          </div>
        )}

        <div className="jcl-terms">
          {terms && terms.length > 1 ? (
            <>
              <span className="wb2-sect">Payment terms</span>
              {/* A ZERO-WIDTH SEGMENT IS NOT DRAWN — it still owns its gap */}
              <span className="wb2-jmbar" aria-hidden>
                {terms.map((c) => (
                  <i key={c.remoteId} className={segOf(c)} style={{ width: pct(c.amountCents!) }} />
                ))}
              </span>
              <span className="jcl-termkey">
                {terms.map((c) => (
                  <span key={c.remoteId} style={{ width: pct(c.amountCents!) }}>
                    {c.percent !== null ? `${c.percent === 0 ? "<1" : c.percent}% ${c.stage.toLowerCase()}` : c.stage}
                  </span>
                ))}
              </span>
            </>
          ) : (
            !unavailable &&
            showBar && (
              <>
                <span className="wb2-jmbar" aria-hidden>
                  {segments.map((seg) => (
                    <i key={seg.key} className={seg.key} style={{ width: pct(seg.cents) }} />
                  ))}
                </span>
                <span className="wb2-jmkey">
                  {segments.map((seg) => (
                    <span key={seg.key}>
                      <i className={seg.key} />
                      {seg.word}
                    </span>
                  ))}
                </span>
              </>
            )
          )}
        </div>

        <div className="wb2-jmhead">
          {balance !== null ? (
            <>
              <span className="wb2-sect">Balance due</span>
              <b className="wb2-jmbig hero">{fmtAud(balance)}</b>
              <span className="jcl-billval">
                <span className="wb2-sect">Job value{basisWord}</span>
                <span>{value !== null ? fmtAud(value) : "—"}</span>
              </span>
            </>
          ) : (
            <>
              <span className="wb2-sect">Job value{unavailable ? "" : basisWord}</span>
              <b className="wb2-jmbig">{!unavailable && value !== null ? fmtAud(value) : "—"}</b>
            </>
          )}
          {/* axis 1, and only axis 1 */}
          {!unavailable && isFamily && invoicedLine && <em className="wb2-jmsub">{invoicedLine}</em>}
        </div>
      </div>

      {unavailable && (
        <p className="int-hint">
          ServiceM8&apos;s figures didn&apos;t load just now. Close the job and open it again to
          try.
        </p>
      )}

      {/* axis 2 — the head row says where collection stands, in the tinted
          row where chasing belongs. The value above it stays the identity. */}
      {!unavailable && showAwaitingHead && (
        <div className="wb2-mline head warn">
          <b>Awaiting payment</b>
          <em>
            {value !== null && value > 0
              ? `${Math.max(1, Math.round((awaiting / value) * 100))}% of the job`
              : ""}
          </em>
          <span>{fmtAud(awaiting)}</span>
          {overdue !== null && (
            <i className="wb2-chip dan">
              {overdue === 1 ? "1 day overdue" : `${overdue} days overdue`}
            </i>
          )}
        </div>
      )}
      {!unavailable && showPaidHead && (
        <div className="wb2-mline head ok">
          <b>Paid in full</b>
          <em />
          <span>{fmtAud(paidCents)}</span>
        </div>
      )}

      {/* NO DEPOSIT, said once and ticked here: the progress line's Deposit
          step is done on the tick, and waits for it otherwise */}
      {!unavailable && deposit && (
        <div className="wb2-mline head">
          <b>Deposit</b>
          <em>{deposit.noDeposit ? "Not needed on this job" : "None invoiced"}</em>
          <span />
          <button type="button" className="pbtn ghost" disabled={deposit.busy} aria-pressed={deposit.noDeposit} onClick={() => deposit.onSet(!deposit.noDeposit)}>
            {deposit.noDeposit ? "Undo" : "No deposit needed"}
          </button>
        </div>
      )}
      {!unavailable && deposit?.error && <p className="wb2-sherr">{deposit.error}</p>}

      {/* A CLAIM ROW IS A DOOR. Each opens that invoice's own modal — its
          lines, its payment, its writing, its paper — which is where those
          live now that a clone has stopped being a card of its own. */}
      {!unavailable && isFamily && (
        <div className="jcl-claimhead" aria-hidden>
          <span>Claim</span>
          <span>Status</span>
          <span>Amount</span>
        </div>
      )}
      {!unavailable &&
        isFamily &&
        family!.claims.map((claim) => {
          const chip = chipOf(claim);
          const inner = (
            <>
              <b>{claimTitle(claim)}</b>
              <em>{metaOf(claim)}</em>
              <span className={claim.state === "not_invoiced" ? "quiet" : undefined}>
                {claim.amountCents !== null ? fmtAud(claim.amountCents) : "—"}
              </span>
              <i
                className={`wb2-chip${chip.tone}`}
                title="Follows ServiceM8 — change it there and it follows here"
              >
                {chip.word}
              </i>
            </>
          );
          const cls =
            "wb2-mline wb2-jmclaim" + (claim.remoteId === focusRemoteId ? " here" : "");
          return onOpenClaim ? (
            <button
              type="button"
              className={cls}
              key={claim.remoteId}
              onClick={() => onOpenClaim(claim.remoteId)}
              aria-label={`${claimTitle(claim)} — open this invoice`}
            >
              {inner}
            </button>
          ) : (
            <div className={cls} key={claim.remoteId}>
              {inner}
            </div>
          );
        })}

      {/* WHY THERE IS NO TOTAL, said rather than left blank. */}
      {family?.mixedBasis && (
        <p className="int-hint">
          These invoices are priced on different tax bases, so they don&apos;t add up to one figure
          here — ServiceM8&apos;s invoices are the total.
        </p>
      )}
      {family?.unknownClaim && !family.mixedBasis && isFamily && (
        <p className="int-hint">
          ServiceM8 hasn&apos;t priced one of this job&apos;s invoices, so there&apos;s no total to
          show.
        </p>
      )}

      {/* THE SENTENCE HAS A ROW OF ITS OWN. It used to hang bare under the
          figure, and across the block's old full width that put it in the
          opposite corner to the number with nothing but space between. The
          neutral tint is the head row's — a place, not a state. */}
      {!unavailable && fallback && (
        <div className="wb2-mline head">
          <b>{fallback}</b>
        </div>
      )}
    </div>
  );
}
