"use client";

import { Button } from "@/components/parts/button";
import { Row, RowList } from "@/components/parts/row";
import { Dot, StateWord } from "@/components/parts/state";
import { Wrong } from "@/components/parts/states";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { collectionFrom, MONEY_BASIS, type JobMoney } from "@/lib/workboard/job-money";
import { familyInvoicedLine, type FamilyMoney } from "@/lib/workboard/job-family";
import type { BillingView, PaymentRow } from "@/lib/workboard/job-billing";

/* ONE JOB'S MONEY. `readMoney` and the Overview's tile (JobMoneyGlance)
   read it the way they always have; Billing (JobMoneyBlock) draws it ex GST
   from lib/workboard/job-billing's `readBilling`.

   TWO AXES, NEVER ONE SENTENCE, straight out of project-money.ts:

     axis 1  what the job is worth, and how much of it has been invoiced
     axis 2  per claim, paid or awaiting */

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

/** WHAT ONE JOB'S MONEY SAYS, read once: the block below and the Overview's
    Money tile both draw from it, so the two can never tell a job's money two
    ways. */
export function readMoney({
  family,
  money,
  ledgerPaidCents,
  statusLabel,
  unavailable = false,
}: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  ledgerPaidCents: number;
  statusLabel: string | null;
  unavailable?: boolean;
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
  return {
    paidCents,
    value,
    basis,
    basisWord,
    awaiting,
    toCome,
    isFamily,
    overdue,
    segments,
    invoicedLine,
    ladderSpeaksFirst,
    showAwaitingHead,
    showPaidHead,
    fallback,
    barBasisSafe,
    showBar,
    balance,
  };
}

/** BILLING (Isaac, 25 October 2026, the job page's frames 9 and 9b). Across
    the top, one band under a hairline: on the left the bar in three solid
    parts, green paid, orange invoiced and waiting, grey not invoiced yet,
    each part's share under it and its figure under that; on the right the
    job's value in its own box, the one big figure. Then Payments, a row a
    claim, each opening the claim. Every figure ex GST, and saying so
    ("Figures need to be clearly excluding GST"); see lib/workboard/job-billing
    for what is said when a figure isn't known ex GST. */
export function JobMoneyBlock({
  view,
  unavailable = false,
  focusRemoteId = null,
  onOpenClaim,
  deposit = null,
}: {
  view: BillingView | null;
  /** The record read was refused or failed: said, never a guessed figure. */
  unavailable?: boolean;
  /** The claim the page was opened for, from a clone's own number. */
  focusRemoteId?: string | null;
  /** Opens one claim; absent leaves the rows inert. */
  onOpenClaim?: (remoteId: string) => void;
  /** The deposit tick (Isaac, 2026-10-03: "if no deposit required make
      that as an option so it can get ticked off"). Absent where there is
      nothing to ask: a deposit invoice exists, or the work has started. */
  deposit?: { noDeposit: boolean; busy: boolean; error: string | null; onSet: (on: boolean) => void } | null;
}) {
  if (unavailable || !view) {
    return (
      <div className="jb">
        <Wrong word="The figures didn't load" means="ServiceM8's figures didn't load just now. Reload the page to try again." />
      </div>
    );
  }
  const { value, quoted, segments, figures, rows } = view;
  const basisWord = (b: "ex" | "inc") => (b === "ex" ? "ex GST" : "inc GST");
  const allEx = rows.every((r) => r.basis === "ex" || r.cents === null);
  const showFigures = rows.length > 0 && (figures.paid !== null || figures.waiting !== null || figures.tocome !== null);
  const cols = segments ?? [
    { key: "paid" as const, word: "Paid", cents: figures.paid, percent: 1 },
    { key: "waiting" as const, word: "Invoiced, waiting", cents: figures.waiting, percent: 1 },
    { key: "tocome" as const, word: "Not invoiced", cents: figures.tocome, percent: 1 },
  ];
  const hue = { paid: "green", waiting: "orange", tocome: "grey" } as const;

  return (
    <div className="jb">
      <div className="jb-band">
        <div className="jb-split">
          {showFigures ? (
            <div
              className="jb-cols"
              style={{ gridTemplateColumns: cols.map((c) => `minmax(max-content, ${Math.max(1, c.percent)}fr)`).join(" ") }}
            >
              {cols.map((c) => (
                <div className={`jb-col jb-col--${c.key}`} key={c.key}>
                  {segments && (
                    <>
                      <i className="jb-seg" aria-hidden="true" />
                      <span className="jb-pct">{`${c.percent}%`}</span>
                    </>
                  )}
                  <span className="jb-lab">
                    <Dot hue={hue[c.key]} />
                    {c.word}
                  </span>
                  <b className="jb-fig">{c.cents !== null ? fmtAud(c.cents) : "—"}</b>
                </div>
              ))}
            </div>
          ) : (
            view.fact && <p className="jb-fact">{view.fact}</p>
          )}
        </div>

        <div className="jb-value">
          <span className="jb-vlab">
            {quoted ? "Quoted job value" : "Job value"}
            {value.cents !== null && <span className="jb-basis">{basisWord(value.basis)}</span>}
          </span>
          <b className="jb-big">{quoted ? fmtAud(quoted.cents) : value.cents !== null ? fmtAud(value.cents) : "—"}</b>
          {quoted?.variations.map((v) => (
            <span className="jb-var" key={v.n}>{`Variation ${v.n}, ${fmtAud(v.cents)}`}</span>
          ))}
        </div>
      </div>

      {(rows.length > 0 || deposit) && (
        <section className="jb-pay" aria-labelledby="jb-pay-h">
          <div className="jb-payhead">
            <h3 id="jb-pay-h">Payments</h3>
            {allEx && <span className="jb-basis">ex GST</span>}
          </div>
          <RowList label="Payments">
            {/* NO DEPOSIT, said once and ticked here: the progress line's
                Deposit step is done on the tick, and waits for it otherwise */}
            {deposit && (
              <Row
                name="Deposit"
                line={deposit.noDeposit ? "Not needed on this job" : "None invoiced"}
                end={
                  <Button
                    size={32}
                    disabled={deposit.busy}
                    aria-pressed={deposit.noDeposit}
                    onClick={() => deposit.onSet(!deposit.noDeposit)}
                  >
                    {deposit.noDeposit ? "Undo" : "No deposit needed"}
                  </Button>
                }
              />
            )}
            {rows.map((r) => (
              <PaymentRowItem key={r.claimId ?? r.name} row={r} here={r.claimId === focusRemoteId} onOpen={onOpenClaim} />
            ))}
          </RowList>
          {deposit?.error && (
            <p className="jb-err">
              <Dot hue="red" />
              {deposit.error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function PaymentRowItem({ row, here, onOpen }: { row: PaymentRow; here: boolean; onOpen?: (remoteId: string) => void }) {
  const claimId = row.claimId;
  return (
    <Row
      name={row.name}
      line={row.line}
      onClick={onOpen && claimId ? () => onOpen(claimId) : undefined}
      end={
        <span className={"jb-end" + (here ? " jb-here" : "")}>
          <span className="jb-amt">
            {row.cents !== null ? fmtAud(row.cents) : "—"}
            {row.cents !== null && row.basis === "inc" && <span className="jb-basis">inc GST</span>}
          </span>
          <span className={`pt-state pt-state--${row.tone} jb-word`}>{row.word}</span>
        </span>
      }
    />
  );
}

/** THE OVERVIEW'S MONEY CELL (the strip of facts, Isaac, 25 October 2026,
    "Yes, build the refined Overview A"; the tile of 22 October before it):
    the figure at 20, one word on where collection stands, and one line
    under it. Read from `readMoney`, as the block is: what's owing once
    something has come in, the job's value until then. */
export function JobMoneyGlance({
  family,
  money,
  ledgerPaidCents,
  statusLabel,
  unavailable = false,
}: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  ledgerPaidCents: number;
  statusLabel: string | null;
  unavailable?: boolean;
}) {
  if (unavailable) return <p className="jov-cap">ServiceM8&apos;s figures didn&apos;t load just now.</p>;
  const m = readMoney({ family, money, ledgerPaidCents, statusLabel });
  const figure = m.balance ?? m.value;
  const owing = m.showAwaitingHead && m.awaiting !== null ? m.awaiting : null;
  /* a job with no family says where collection stands in the block's own
     words; on the tile they wear their state: owed in orange, paid in green */
  const collection = m.ladderSpeaksFirst || m.isFamily ? null : collectionFrom(money?.valueCents ?? null, m.paidCents);
  const settled = collection === "paid" || collection === "part" || collection === "awaiting" ? collection : null;
  const line =
    m.isFamily && m.invoicedLine
      ? m.invoicedLine
      : m.balance !== null && m.value !== null
        ? `Job value ${fmtAud(m.value)}`
        : money?.invoiced && money.invoicedOn
          ? `Invoiced ${fmtAuWeekdayDayMonth(money.invoicedOn)}`
          : null;
  return (
    <>
      <b className="jov-fig">{figure !== null ? fmtAud(figure) : "—"}</b>
      {owing !== null ? (
        m.overdue !== null ? (
          <StateWord tone="wrong">{m.overdue === 1 ? "1 day overdue" : `${m.overdue} days overdue`}</StateWord>
        ) : (
          <StateWord tone="look">{owing === figure ? "All of it owing" : `${fmtAud(owing)} owing`}</StateWord>
        )
      ) : m.showPaidHead ? (
        <StateWord tone="good">Paid in full</StateWord>
      ) : m.fallback && settled ? (
        <StateWord tone={settled === "paid" ? "good" : "look"}>{m.fallback}</StateWord>
      ) : (
        m.fallback && <p className="jov-read">{m.fallback}</p>
      )}
      {line && <p className="jov-cap">{line}</p>}
    </>
  );
}
