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

   THE JOB TYPE'S COLOUR FRAMES THIS BLOCK AND NOTHING ELSE. ServiceM8's
   category palette makes no contrast promise, so it is never a surface and
   never text — a 1.5px edge on the one section where a glance at the colour
   tells you what kind of money this is.

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
  return bits.join(" · ");
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

export function JobMoneyBlock({
  family,
  money,
  ledgerPaidCents,
  statusLabel,
  categoryColour,
  unavailable = false,
  focusRemoteId = null,
  onOpenClaim,
}: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  /** This job row's OWN payments, for the case where there is no family to
      count — a job number the family read couldn't parse, or a record read
      that came back without one. */
  ledgerPaidCents: number;
  statusLabel: string | null;
  categoryColour: string | null;
  /** The record read was refused or failed. The block says so rather than
      vanishing — and never falls back to this row's own total, which on a
      family is the netted figure the whole feature exists to stop showing. */
  unavailable?: boolean;
  /** The claim this card was opened for — marked in the ledger so a reader
      who searched "2380A" can see which of the three rows they asked for. */
  focusRemoteId?: string | null;
  /** Opens one claim's own modal; absent leaves the rows inert. */
  onOpenClaim?: (remoteId: string) => void;
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
     amber "Awaiting payment · 100% of the job" under its Quote chip. */
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

  return (
    <div
      className="wb2-shsect wb2-jmoney"
      style={categoryColour ? { borderColor: categoryColour } : undefined}
    >
      <span className="wb2-sect">Job value{unavailable ? "" : basisWord}</span>
      <b className="wb2-jmbig">{!unavailable && value !== null ? fmtAud(value) : "—"}</b>

      {unavailable && (
        <p className="int-hint">
          ServiceM8&apos;s figures didn&apos;t load just now. Close the job and open it again to
          try.
        </p>
      )}

      {/* axis 1, and only axis 1 */}
      {!unavailable && isFamily && invoicedLine && <em className="wb2-jmsub">{invoicedLine}</em>}

      {!unavailable && showBar && (
        <>
          {/* A ZERO-WIDTH SEGMENT IS NOT DRAWN. It still owns the flex gap
              beside it, so a fully paid job grew a grey nub on the end that
              read as money still to bill. */}
          <span className="wb2-jmbar" aria-hidden>
            {segments.map((seg) => (
              <i key={seg.key} className={seg.key} style={{ width: pct(seg.cents) }} />
            ))}
          </span>
          {/* and a key for a colour that isn't on the bar explains nothing */}
          {segments.length > 1 && (
            <span className="wb2-jmkey">
              {segments.map((seg) => (
                <span key={seg.key}>
                  <i className={seg.key} />
                  {seg.word}
                </span>
              ))}
            </span>
          )}
        </>
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

      {/* A CLAIM ROW IS A DOOR. Each opens that invoice's own modal — its
          lines, its payment, its writing, its paper — which is where those
          live now that a clone has stopped being a card of its own. */}
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

      {!unavailable && fallback && <em className="wb2-jmsub">{fallback}</em>}
    </div>
  );
}
