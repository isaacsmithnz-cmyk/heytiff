"use client";

import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { readClaim } from "@/app/actions/workboard";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import { Empty, Loading, Wrong } from "@/components/parts/states";
import { Waiting } from "@/components/ui/orb";
import { JobQuoteSend, sendVariation } from "@/components/workboard/board/job-quote-send";
import { useQuotePrice } from "@/components/workboard/quote/quote-parts";
import { QuoteLinesFace } from "@/components/workboard/quote/quote-lines-face";
import type { Sm8Quote } from "@/components/workboard/quote/sm8-quote-of";
import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { firstCard, invoicePaperOf, priceCards, quoteBegun, type PriceAsk, type PriceCard, type QuoteRead } from "@/lib/jobs/job-prices";
import { proposalTitle } from "@/lib/quotes/proposal";
import type { QuoteFacts } from "@/lib/quotes/quote-card";
import type { LandingWhen, QuoteLanding } from "@/lib/quotes/quote-landing";
import type { MirrorJobDetail, ClaimDetailRead } from "@/lib/workboard/all-jobs-query";
import { claimLine, type BillingView, type PaymentRow } from "@/lib/workboard/job-billing";
import type { FamilyClaim } from "@/lib/workboard/job-family";
import type { JobMaterialLine } from "@/lib/workboard/job-ledger";
import { Paper, Sm8Lines, Views, type View } from "./job-price-parts";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { fmtAud } from "@/lib/workboard/project-money";

/* THE JOB'S PRICE TAB (the job page plan's build 10; the Price Tab mock,
   drawn on 3408 on 13 November 2026; Isaac, 14 November: "Build all as
   recommended, I'll change anything I'm not happy with after"). Where what
   the job is charged is built, and the quote page with it: the two are one
   page now, and the quote's old address lands here.

   ACROSS THE TOP, every price on the job as a flat card (job-prices.ts): what
   it is, what it comes to, where it stands. The one open is filled, never
   outlined (old law 14: a selection is a fill). New quote, orange as quoting
   is (rule 25c), ends the row while the job has no quote.

   UNDER THEM, the one open: its views in a tray over the left, Chat with
   Tiff, where a quote is built and changed, Line items, and Preview, the
   paper as the customer gets it, and its rail down the right with its price,
   where it's up to and its buttons pinned at the foot, as the quote page had
   them (quote-lines-face.tsx, in its `views` mode).

     a quote built here    the quote, with its chat
     ServiceM8's quote     typed into ServiceM8, so no chat behind it until
                           someone updates it here: its lines and its PDF
     an invoice            money only: its lines, the PDF ServiceM8 sent, and
                           down the right its figure and word as Billing's row
                           says them, what's been paid and what's written on
                           it. Its one home: Billing's row opens it here.

   The quote is everyone's on the Workboard, its money only theirs who see it
   (Isaac, 2026-10-12: "For techs who are quoting a job"). Nothing goes to
   ServiceM8 or Xero from here except by a person's press. */

const ROUTE = "/api/workboard/quote-status";
/* New invoice, loaded when it is first asked for: its send is a server
   action of its own */
const PriceNewInvoice = lazy(() => import("./job-price-invoice").then((m) => ({ default: m.PriceNewInvoice })));
const WHEN: LandingWhen = { day: fmtAuWeekdayDayMonth, time: (at) => fmtAuTime(new Date(at)) };

export function JobPriceTab({
  job,
  ready,
  moneyVisible,
  financials,
  detail,
  sm8,
  billing,
  claims,
  materials,
  ask,
  onOpenPaper,
  onToast,
}: {
  /** the job card's uuid, or the row's until the record read lands */
  job: string;
  /** the card's uuid is known: the quote can be opened */
  ready: boolean;
  /** `workboard_money`: the invoices and what's owed */
  moneyVisible: boolean;
  /** `financials`: the quote's own money, its price and its paper */
  financials: boolean;
  detail: MirrorJobDetail | null;
  sm8: Sm8Quote;
  /** Billing's view, null without the money or until it's read */
  billing: BillingView | null;
  claims: readonly FamilyClaim[];
  /** the job's own lines in ServiceM8: ServiceM8's quote's */
  materials: readonly JobMaterialLine[];
  /** what a door asked the tab to open on */
  ask: PriceAsk | null;
  onOpenPaper: (item: JobMediaItem) => void;
  onToast: (message: string, undo?: () => void) => void;
}) {
  /* where the quote stands, as the old landing read it: undefined while it's
     read, null when the read failed */
  const [quote, setQuote] = useState<QuoteRead>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.resolve()
      .then(() => fetch(`${ROUTE}?job=${encodeURIComponent(job)}&landing=1`))
      .then((r) => r.json() as Promise<{ ok: boolean; facts?: QuoteFacts; landing?: QuoteLanding }>)
      .then((a) => live && setQuote(a.ok && a.facts ? { facts: a.facts, landing: a.landing ?? null } : null))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [ready, job, reads]);

  /* the quote asked for: started, with the reply box ready for the brief */
  const [starting, setStarting] = useState(() => !!ask?.start);
  const cards = useMemo(
    () =>
      priceCards({
        quote,
        sm8,
        rows: moneyVisible ? (billing?.rows ?? null) : null,
        claims: moneyVisible ? claims : null,
        staged: !!billing?.staged,
        starting,
        when: WHEN,
      }),
    [quote, sm8, moneyVisible, billing, claims, starting]
  );

  /* NEW INVOICE, money only: its card stands while it's being built */
  const [invoicing, setInvoicing] = useState(false);
  const offerInvoice = ready && moneyVisible && financials;
  const shownCards: PriceCard[] =
    invoicing && offerInvoice
      ? [...cards, { key: "new-invoice", kind: "invoice", label: "Invoice", name: "New invoice", figure: null, state: { word: "Not on the job yet", tone: "info" } }]
      : cards;

  /* the card open: what a door asked for, else the tab's first */
  const [picked, setPicked] = useState<string | null>(null);
  const [askSeen, setAskSeen] = useState<number | null>(null);
  if (ask && ask.n !== askSeen) {
    setAskSeen(ask.n);
    if (ask.start) setStarting(true);
    setPicked(ask.invoice ? `invoice:${ask.invoice}` : ask.start || ask.option != null || ask.update ? "quote" : null);
  }
  /* an invoice asked for by its claim matches in any case; one not read yet
     leaves the first card up until Billing's rows land */
  const want = picked?.startsWith("invoice:") ? firstCard(cards, picked.slice("invoice:".length)) : picked;
  const shown = shownCards.find((c) => c.key === want) ?? cards.find((c) => c.key === firstCard(cards, null)) ?? null;

  const newQuote = () => {
    setStarting(true);
    setPicked("quote");
  };
  const offerNew = ready && quote !== undefined && !quoteBegun(quote) && !starting && !cards.some((c) => c.kind === "sm8-quote");

  /* said whatever else is up: ServiceM8's quote or an invoice may still be */
  const unread =
    quote === null ? (
      <Wrong
        word="The quote wasn't read"
        means="Where the quote stands couldn’t be read."
        action={
          <Button kind="second" onClick={() => setReads((n) => n + 1)}>
            Read the quote again
          </Button>
        }
      />
    ) : null;
  let body: ReactNode;
  if (!ready || quote === undefined) body = <Loading what="Reading the quote" />;
  else if (!shown && unread) body = unread;
  else if (!shown)
    body = (
      <Empty
        what="No quote on this job yet"
        action={
          <Button kind="quote" onClick={newQuote}>
            New quote
          </Button>
        }
      />
    );
  else if (shown.kind === "quote")
    body = (
      <PriceQuote
        key={`quote-${ask?.n ?? 0}`}
        job={job}
        detail={detail}
        sm8={sm8}
        moneyVisible={moneyVisible}
        financials={financials}
        start={starting && !quoteBegun(quote)}
        option={ask?.option ?? null}
        update={!!ask?.update}
        onOpenPaper={onOpenPaper}
        onToast={onToast}
        onChanged={() => setReads((n) => n + 1)}
      />
    );
  else if (shown.key === "new-invoice")
    body = (
      <Suspense fallback={<Loading what="Working out the invoice" />}>
        <PriceNewInvoice job={job} jobNumber={detail?.jobNumber ?? null} client={detail?.clientName ?? null} onJob={materials} />
      </Suspense>
    );
  else if (shown.kind === "sm8-quote")
    body = <PriceSm8Quote job={job} sm8={sm8} money={moneyVisible} materials={materials} onUpdate={newQuote} />;
  else
    body = (
      <PriceInvoice
        key={shown.key}
        job={job}
        card={shown}
        claim={claims.find((c) => c.remoteId === shown.claimId) ?? null}
        row={billing?.rows.find((r) => r.claimId === shown.claimId) ?? null}
        staged={!!billing?.staged}
        onOpenPaper={onOpenPaper}
      />
    );

  return (
    <div className="jpr">
      {(shownCards.length > 0 || offerNew || offerInvoice) && (
        <div className="jpr-cards" role="group" aria-label="The job's prices">
          {shownCards.map((c) => (
            <CardButton key={c.key} card={c} on={shown?.key === c.key} onPick={() => setPicked(c.key)} />
          ))}
          {((offerNew && shownCards.length > 0) || (offerInvoice && !invoicing)) && (
            <div className="jpr-new">
              {offerNew && shownCards.length > 0 && (
                <Button kind="quote" onClick={newQuote}>
                  New quote
                </Button>
              )}
              {offerInvoice && !invoicing && (
                <Button
                  onClick={() => {
                    setInvoicing(true);
                    setPicked("new-invoice");
                  }}
                >
                  New invoice
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {shown && unread}
      <div className="jpr-open">{body}</div>
    </div>
  );
}

function CardButton({ card, on, onPick }: { card: PriceCard; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={on ? "jpr-card on" : "jpr-card"} aria-pressed={on} onClick={onPick}>
      <span className="jpr-label">{card.label}</span>
      <span className="jpr-name">
        <Fade>{card.name}</Fade>
      </span>
      {card.figure && <b className="jpr-fig">{card.figure}</b>}
      {card.state && (
        <span className="jpr-state">
          <StateWord tone={card.state.tone}>{card.state.word}</StateWord>
        </span>
      )}
    </button>
  );
}

/* A QUOTE BUILT HERE: the quote page's body, on the tab. Every quote is built
   on its lines (retiring the old builder, Isaac, 2026-10-12): one still on
   the old builder is switched to them as it's opened. */
function PriceQuote({
  job,
  detail,
  sm8,
  financials,
  start,
  option,
  update,
  onOpenPaper,
  onToast,
  onChanged,
}: {
  job: string;
  detail: MirrorJobDetail | null;
  sm8: Sm8Quote;
  moneyVisible: boolean;
  financials: boolean;
  start: boolean;
  option: number | null;
  update: boolean;
  onOpenPaper: (item: JobMediaItem) => void;
  onToast: (message: string, undo?: () => void) => void;
  /** the quote moved: the cards read where it stands again */
  onChanged: () => void;
}) {
  /* on its lines: undefined while a quote on the old builder is switched,
     false when that failed */
  const [onLines, setOnLines] = useState<boolean | undefined>(undefined);
  const [tries, setTries] = useState(0);
  const [linesRev, setLinesRev] = useState(0);
  useEffect(() => {
    let live = true;
    const post = (body: Record<string, unknown>) =>
      fetch("/api/workboard/quote-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(
        (r) => r.json() as Promise<{ ok: boolean }>
      );
    Promise.resolve()
      .then(() => fetch(`/api/workboard/quote-lines?job=${encodeURIComponent(job)}`))
      .then((r) => r.json() as Promise<{ ok: boolean; engine?: "old" | "lines" }>)
      .then((a) => (a?.ok && a.engine !== "lines" ? post({ job, op: "switch", engine: "lines" }) : a))
      .then((a) => live && setOnLines(!!a?.ok))
      .catch(() => live && setOnLines(false));
    return () => {
      live = false;
    };
  }, [job, tries]);

  /* the price, to the money grant only; read for each version of the quote */
  const price = useQuotePrice(job, financials, onLines ? `lines-${linesRev}` : null);
  const address = detail?.address ?? detail?.geoLine ?? null;

  if (onLines === false)
    return (
      <div className="qp-wait">
        <p className="wb2-sherr">The quote couldn&rsquo;t be opened.</p>
        <Button
          onClick={() => {
            setOnLines(undefined);
            setTries((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!onLines)
    return (
      <div className="qp-wait">
        <Waiting note="Opening the quote" />
      </div>
    );
  return (
    <div className="stg hd-page wb2 wb2-qpage qp jpr-quote">
      <QuoteLinesFace
        job={job}
        views
        meta={{ title: proposalTitle(address), client: detail?.clientName ?? null, site: address, jobNumber: detail?.jobNumber ?? null }}
        price={price}
        onPriced={() => {
          setLinesRev((n) => n + 1);
          onChanged();
        }}
        onToast={onToast}
        send={<JobQuoteSend job={job} visible version={`lines-${linesRev}`} />}
        sendQuote={(onSent, sentAt) => <JobQuoteSend job={job} visible as="quote" look="button" sentAt={sentAt} version={`lines-${linesRev}`} onSent={onSent} />}
        sm8={sm8}
        onOpenPaper={onOpenPaper}
        money={financials}
        start={start}
        openAt={option}
        sendVariation={(o) => sendVariation(job, o)}
        jobStatus={detail?.status ?? null}
        update={update}
      />
    </div>
  );
}

/* SERVICEM8'S OWN QUOTE: typed there, never built here (3408's return
   visit), so it has no chat until someone updates it in HeyTiff, which
   starts the quote here from it, as the old landing's Update ServiceM8's
   quote did. */
function PriceSm8Quote({
  job,
  sm8,
  money,
  materials,
  onUpdate,
}: {
  job: string;
  sm8: Sm8Quote;
  money: boolean;
  materials: readonly JobMaterialLine[];
  onUpdate: () => void;
}) {
  const [view, setView] = useState<View>("preview");
  const paper = sm8.papers[0] ?? null;
  const href = sm8JobUrl(job);
  return (
    <div className="jpr-body">
      <div className="jpr-main">
        <Views value={view} onChange={setView} />
        <div className="jpr-left">
          {view === "lines" ? (
            <Sm8Lines lines={materials} money={money} none="ServiceM8 holds no lines on this quote." />
          ) : (
            <Paper item={paper} none="ServiceM8 hasn't made a PDF of this quote." />
          )}
        </div>
      </div>
      <aside className="jpr-rail" aria-label="ServiceM8's quote">
        <div className="jpr-railtop">
          <h2 className="jpr-railname">ServiceM8&rsquo;s quote</h2>
          {sm8.value && <b className="jpr-railfig">{sm8.value}</b>}
          <p className="jpr-railline">{sm8.sentOn ? `Sent to the client ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Not sent yet"}</p>
          <p className="jpr-railline">Typed in ServiceM8, so there&rsquo;s no chat with Tiff behind it.</p>
        </div>
        <div className="jpr-dock">
          <Button kind="quote" onClick={onUpdate}>
            Update quote
          </Button>
          {href && (
            <Button kind="quiet" href={href} target="_blank" rel="noreferrer">
              Open in ServiceM8
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}

/* AN INVOICE, money only: what's on it, the PDF ServiceM8 sent, and down the
   right its figure and word as Billing's row says them, what's been paid,
   and anything written on it. What the claim knows, and nothing the job
   owns. Every figure ex GST, from ServiceM8's own ex-GST price on each line;
   a payment is the one exception and says so: it's what the customer paid,
   the invoice's inc-GST total. */
function PriceInvoice({
  job,
  card,
  claim,
  row,
  staged,
  onOpenPaper,
}: {
  job: string;
  card: PriceCard;
  claim: FamilyClaim | null;
  row: PaymentRow | null;
  staged: boolean;
  onOpenPaper: (item: JobMediaItem) => void;
}) {
  const [view, setView] = useState<View>("preview");
  /* keyed by the invoice, so another is a fresh read */
  const [read, setRead] = useState<ClaimDetailRead | null | undefined>(undefined);
  const id = card.claimId ?? "";
  useEffect(() => {
    let live = true;
    void readClaim(id)
      .then((d) => live && setRead(d))
      .catch(() => live && setRead(null));
    return () => {
      live = false;
    };
  }, [id]);

  const paper = read ? invoicePaperOf(read.media.documents) : null;
  const href = sm8JobUrl(claim?.remoteId ?? job);
  return (
    <div className="jpr-body">
      <div className="jpr-main">
        <Views value={view} onChange={setView} />
        <div className="jpr-left">
          {read === undefined ? (
            <Loading what="Reading the invoice" />
          ) : read === null ? (
            <Wrong word="The invoice wasn't read" means="ServiceM8's invoice couldn’t be read just now. Open it again in a moment." />
          ) : view === "lines" ? (
            <Sm8Lines lines={read.ledger.materials} money none="ServiceM8 holds no lines on this invoice." />
          ) : (
            <Paper item={paper} none="ServiceM8 hasn't sent a PDF of this invoice." />
          )}
        </div>
      </div>
      <aside className="jpr-rail" aria-label={card.label}>
        <div className="jpr-railtop">
          <h2 className="jpr-railname">{staged ? card.name : card.label}</h2>
          {claim && <p className="jpr-railline">{claimLine(claim, row ?? { percent: claim.percent }, staged)}</p>}
          <p className="jpr-railamt">
            <b className="jpr-railfig">{row?.cents != null ? fmtAud(row.cents) : "—"}</b>
            <span className="jb-basis">{row?.basis === "inc" ? "inc GST" : "ex GST"}</span>
          </p>
          {row && <StateWord tone={row.tone}>{row.word}</StateWord>}
          {read && read.ledger.payments.length > 0 && (
            <section className="jpr-grp" aria-label="Paid">
              <h3>Paid</h3>
              <ul className="jpr-lines">
                {read.ledger.payments.map((p) => (
                  <li key={p.remoteId}>
                    <span className="jpr-line">
                      <b>{p.method ?? "Payment"}</b>
                      <em>
                        {[p.isDeposit ? "Deposit" : null, p.takenOn ? fmtAuWeekdayDayMonth(p.takenOn) : null, p.takenBy].filter(Boolean).join(", ")}
                      </em>
                    </span>
                    <span className="jpr-amt">{p.amountCents !== null ? `${fmtAud(p.amountCents)} inc GST` : "—"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {read && (
            <section className="jpr-grp" aria-label="Written on it">
              <h3>Written on it</h3>
              {read.notes.length > 0 ? (
                read.notes.map((n) => (
                  <div className="jpr-note" key={n.remoteId}>
                    <p>{n.text}</p>
                    <em>{[n.writtenBy, n.writtenOn ? fmtAuWeekdayDayMonth(n.writtenOn) : null].filter(Boolean).join(", ")}</em>
                  </div>
                ))
              ) : (
                /* ServiceM8's own note about raising a claim is left off
                   (isPartialInvoiceStubNote), so this is what was checked */
                <p className="jpr-railline">Nothing written on it.</p>
              )}
            </section>
          )}
        </div>
        <div className="jpr-dock">
          {paper?.url && (
            <Button kind="second" onClick={() => onOpenPaper(paper)}>
              Open the PDF
            </Button>
          )}
          {href && (
            <Button kind="quiet" href={href} target="_blank" rel="noreferrer">
              Open in ServiceM8
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
