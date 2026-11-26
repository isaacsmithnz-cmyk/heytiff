"use client";

import { Suspense, lazy, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { SectionTabs } from "@/components/parts/tabs";
import { useRouter } from "next/navigation";
import { readClaim, readJobBookedVisits } from "@/app/actions/workboard";
import type { BookedVisitRead } from "@/lib/jobs/built-from-server";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { StateWord, stateTone } from "@/components/parts/state";
import { Row, RowList } from "@/components/parts/row";
import { Empty, Loading, Wrong } from "@/components/parts/states";
import { Waiting } from "@/components/ui/orb";
import { JobQuoteSend, sendVariation } from "@/components/workboard/board/job-quote-send";
import { useQuotePrice } from "@/components/workboard/quote/quote-parts";
import { QuoteLinesFace, useQuoteLines, type QuoteStage } from "@/components/workboard/quote/quote-lines-face";
import { LinesProposalPaper } from "@/components/workboard/quote/lines-proposal-paper";
import { qualificationsOf } from "@/lib/quotes/review";
import { openInTab } from "@/components/shell/open-tabs";
import type { DocStage } from "./job-doc-head";
import type { Sm8Quote } from "@/components/workboard/quote/sm8-quote-of";
import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { invoiceHref, quoteHref } from "@/lib/shell/links";
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
import { fmtMinutesAsHours } from "@/lib/workboard/all-jobs";
import type { TrackerRead } from "@/lib/jobs/job-tracker";
import { withoutCountry } from "@/lib/au-address";

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
  doc = null,
  photos = null,
  onDocStage,
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
  /** the quote in a tab of its own: the quote alone, Build, Breakdown and
      Proposal, with no cards over it */
  doc?: "quote" | "invoice" | null;
  /** the job's photos, for the proposal's Add a photo and to draw one put
      on it; null while they're read */
  photos?: readonly JobMediaItem[] | null;
  /** where the quote's or the invoice's up to, its name, and an invoice's own
      name for its tab, for the head of its tab */
  onDocStage?: (stage: (DocStage & { title: string | null; label?: string | null }) | null) => void;
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

  /* New quote and Update quote open the quote in its own tab, the reply
     box ready for the brief; and so does a door that asks the Price tab for
     the quote (Add › Quote, a variation's Open, Since the quote's Update quote) */
  const router = useRouter();
  const openQuote = (opts: { start?: boolean; option?: number | null; update?: boolean }) => {
    const href = quoteHref(job, opts);
    openInTab(href, `${window.location.pathname}${window.location.search}`);
    router.push(href);
  };
  const newQuote = () => openQuote({ start: true });
  const quoteAsk = !doc && ask && (ask.start || ask.option != null || ask.update) ? ask : null;
  /* once per ask */
  const openAsked = useEffectEvent(() => {
    if (quoteAsk) openQuote({ start: quoteAsk.start, option: quoteAsk.option, update: quoteAsk.update });
  });
  const askN = quoteAsk?.n ?? null;
  useEffect(() => {
    if (askN != null) openAsked();
  }, [askN]);
  const offerNew = ready && quote !== undefined && !quoteBegun(quote) && !starting && !cards.some((c) => c.kind === "sm8-quote");
  /* the customer took the quote: more work is a variation on it (rule 54) */
  const accepted = ready && !!quote && quote.facts.accepted.length > 0;

  /* THE QUOTE IN ITS OWN TAB: the quote alone, under its head */
  if (doc === "quote")
    return (
      <div className="jpr jpr-doc">
        {!ready || quote === undefined ? (
          <Loading what="Reading the quote" />
        ) : (
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
            photos={photos}
            onOpenPaper={onOpenPaper}
            onToast={onToast}
            onChanged={() => setReads((n) => n + 1)}
            onStage={(st) => onDocStage?.(st ? docStageOf(st) : null)}
          />
        )}
      </div>
    );

  /* AN INVOICE IN ITS OWN TAB (decision 6): the invoice alone, under its head */
  if (doc === "invoice") {
    const card = cards.find((c) => c.kind === "invoice" && c.claimId?.toLowerCase() === (ask?.invoice ?? "").toLowerCase()) ?? null;
    return (
      <div className="jpr jpr-doc">
        {!ready || !billing ? (
          <Loading what="Reading the invoice" />
        ) : !card ? (
          <Wrong word="That invoice isn't on this job" means="It may have been taken off in ServiceM8." />
        ) : (
          <PriceInvoice
            key={card.key}
            job={job}
            card={card}
            claim={claims.find((c) => c.remoteId === card.claimId) ?? null}
            row={billing.rows.find((r) => r.claimId === card.claimId) ?? null}
            staged={!!billing.staged}
            detail={detail}
            onOpenPaper={onOpenPaper}
            doc={{ claims, billing, quoteFigure: cards.find((c) => c.kind !== "invoice")?.figure ?? null, onStage: onDocStage }}
          />
        )}
      </div>
    );
  }

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
          <>
            <Button kind="quote" onClick={newQuote}>
              New quote
            </Button>
            {/* bug 62: with nothing on the job there's no list beside the
                page, so New invoice stands with New quote */}
            {offerInvoice && (
              <Button
                onClick={() => {
                  setInvoicing(true);
                  setPicked("new-invoice");
                }}
              >
                New invoice
              </Button>
            )}
          </>
        }
      />
    );
  else if (shown.kind === "quote")
    body = <QuotePreview job={job} detail={detail} money={financials} starting={starting && !quoteBegun(quote)} photos={photos} />;
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
        detail={detail}
        onOpenPaper={onOpenPaper}
      />
    );

  return (
    <div className="jpr jpr--list">
      {/* QUOTES AND INVOICES (the Price overhaul, 18 November 2026, C: "Lose
          the cards row, definitely"): every price on the job as a row, as
          Billing's are, the one chosen filled, and what's chosen beside the
          list as the customer sees it; under the list what can be made now:
          New quote while the job has none, Add a variation once it's
          accepted, New invoice for whoever sees money (decision 8) */}
      {/* nothing on the job: no list, the empty page says it once and holds
          its doors (bug 62, 20 November 2026: "weird positioning", a tall
          empty list beside a page saying No quote) */}
      {shownCards.length > 0 && (
        <section className="jpr-list" aria-label="Quotes and invoices">
          <h2 className="jpr-listname">Quotes and invoices</h2>
          <RowList label="The job's prices">
            {shownCards.map((c) => (
              <Row
                key={c.key}
                name={c.name}
                line={[c.label, c.figure].filter(Boolean).join(", ")}
                dot={c.state ? stateTone(c.state.tone) : undefined}
                end={c.state ? <StateWord tone={c.state.tone}>{c.state.word}</StateWord> : undefined}
                on={shown?.key === c.key}
                onClick={() => setPicked(c.key)}
              />
            ))}
          </RowList>
          {((offerNew && shownCards.length > 0) || accepted || (offerInvoice && !invoicing)) && (
            <div className="jpr-listfoot">
              {/* with nothing on the job, New quote is the empty page's own */}
              {offerNew && shownCards.length > 0 && (
                <Button kind="quote" onClick={newQuote}>
                  New quote
                </Button>
              )}
              {accepted && <Button onClick={() => openQuote({ update: true })}>Add a variation</Button>}
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
        </section>
      )}
      <div className="jpr-open">
        {shown && unread}
        {body}
      </div>
    </div>
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
  photos,
  onOpenPaper,
  onToast,
  onChanged,
  onStage,
}: {
  job: string;
  detail: MirrorJobDetail | null;
  sm8: Sm8Quote;
  moneyVisible: boolean;
  financials: boolean;
  start: boolean;
  option: number | null;
  update: boolean;
  photos: readonly JobMediaItem[] | null;
  onOpenPaper: (item: JobMediaItem) => void;
  onToast: (message: string, undo?: () => void) => void;
  /** the quote moved: the cards read where it stands again */
  onChanged: () => void;
  /** where it's up to, for the head of its tab */
  onStage?: (stage: QuoteStage | null) => void;
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
  /* the site on the paper with ServiceM8's ", Australia" off, as the head has it */
  const address = withoutCountry(detail?.address ?? detail?.geoLine ?? "") || null;

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
        photos={photos}
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
        onStage={onStage}
      />
    </div>
  );
}

/** The quote's state word in its tab's head (rule 17): what's left to settle
    needs a look, ready, sent and the customer's yes are good, a draft is
    for your information; Undo rides with the customer's yes. */
const docStageOf = (st: QuoteStage): DocStage & { title: string | null } => ({
  word: st.word,
  tone: st.settle ? "look" : st.good ? "good" : "info",
  undo: st.undo ?? null,
  actions: st.actions,
  act: st.act,
  title: null,
});

/* THE QUOTE ON THE PRICE TAB (the Price overhaul, 18 November 2026): its
   paper as the customer gets it, read only, and Open quote, which opens it
   in a tab of its own to change. A tech, who never sees the quote's money,
   has no paper (the paper is the money's), only Open quote. */
function QuotePreview({
  job,
  detail,
  money,
  starting,
  photos,
}: {
  job: string;
  detail: MirrorJobDetail | null;
  money: boolean;
  starting: boolean;
  photos: readonly JobMediaItem[] | null;
}) {
  const { view } = useQuoteLines(job, money);
  const price = useQuotePrice(job, money, view ? "preview" : null);
  const address = withoutCountry(detail?.address ?? detail?.geoLine ?? "") || null;
  const href = quoteHref(job, { start: starting });
  const lines = (view?.lines ?? []).filter((l) => !(view?.variations ?? []).some((v) => v.option === l.optionIndex));
  return (
    <div className="jpr-body jpr-body--one">
      <div className="jpr-main">
        <div className="jpr-mainhead">
          <h2 className="qc-vt">{view?.proposal?.title || proposalTitle(address)}</h2>
          <Button kind="main" href={href} onClick={() => openInTab(href, `${window.location.pathname}${window.location.search}`)}>
            Open quote
          </Button>
        </div>
        <div className="jpr-left">
          {!money ? (
            <p className="jpr-none">Open the quote to see its work and talk it through with Tiff.</p>
          ) : !view ? (
            <Loading what="Reading the quote" />
          ) : lines.length === 0 ? (
            <p className="jpr-none">Nothing on the quote yet. Open it to build it with Tiff.</p>
          ) : (
            <div className="lp-desk lp-ro">
              <LinesProposalPaper
                {...{ title: proposalTitle(address) }}
                proposal={view.proposal ?? null}
                lines={lines}
                coolKw={view.coolKw ?? null}
                price={price}
                optionNames={view.optionNames ?? []}
                noteLibrary={view.noteLibrary ?? []}
                paymentTerms={view.paymentTerms ?? null}
                qualifications={qualificationsOf(view.review ?? null)}
                client={detail?.clientName ?? null}
                site={address}
                jobNumber={detail?.jobNumber ?? null}
                preparedBy={view.names[view.me ?? ""] ?? null}
                photos={photos && photos.map((m) => ({ id: m.remoteId, url: m.url }))}
                busy
                readOnly
                onSave={() => undefined}
              />
            </div>
          )}
        </div>
      </div>
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
  detail,
  onOpenPaper,
  doc = null,
}: {
  job: string;
  card: PriceCard;
  claim: FamilyClaim | null;
  row: PaymentRow | null;
  staged: boolean;
  detail: MirrorJobDetail | null;
  onOpenPaper: (item: JobMediaItem) => void;
  /** in a tab of its own (decision 6): its two tabs across the page, the
      head told where it's up to, and the rest of the job's billing beside it */
  doc?: {
    claims: readonly FamilyClaim[];
    billing: BillingView;
    quoteFigure: string | null;
    onStage?: (stage: (DocStage & { title: string | null; label?: string | null }) | null) => void;
  } | null;
}) {
  const [view, setView] = useState<View>("preview");
  /* the head of its tab: its word in its colour, its name, its number */
  const tellHead = useEffectEvent(() => doc?.onStage?.(row ? { word: row.word, tone: row.tone, title: card.name, label: card.label } : { word: "Not read yet", tone: "info", title: card.name, label: card.label }));
  const headKey = `${row?.word ?? ""}|${row?.tone ?? ""}|${card.name}|${card.label}`;
  useEffect(() => {
    if (doc) tellHead();
  }, [headKey, doc]);
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

  /* the job's own invoice is the job: what it was built from is the job's
     (a claim's is a share of the job's value, which its line says) */
  const own = id.toLowerCase() === job.toLowerCase();
  const [used, setUsed] = useState<number | null | undefined>(undefined);
  const [booked, setBooked] = useState<readonly BookedVisitRead[]>([]);
  useEffect(() => {
    if (!own) return;
    let live = true;
    void readJobBookedVisits(job)
      .then((b) => live && setBooked(b ?? []))
      .catch(() => undefined);
    void fetch(`/api/workboard/job-tracker?job=${encodeURIComponent(job)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; tracker?: TrackerRead } | null) => live && setUsed(j?.ok && j.tracker ? j.tracker.materials.count : null))
      .catch(() => live && setUsed(null));
    return () => {
      live = false;
    };
  }, [own, job]);

  const paper = read ? invoicePaperOf(read.media.documents) : null;
  const href = sm8JobUrl(claim?.remoteId ?? job);
  const tabs = doc ? (
    /* the quote's shape: Breakdown, its lines, and Invoice, the page as the customer has it (decision 6) */
    <div className="qc-views qc-views--tabs jpr-doctabs">
      <SectionTabs
        items={[
          { key: "lines", label: "Breakdown" },
          { key: "preview", label: "Invoice" },
        ]}
        current={view}
        ariaLabel="The invoice"
        idPrefix="jpr-tab"
        onGo={(k) => setView(k === "lines" ? "lines" : "preview")}
      />
      <span className="qc-gst">All ex GST</span>
    </div>
  ) : null;
  return (
    <>
    {tabs}
    <div className="jpr-body">
      <div className="jpr-main">
        {!doc && <Views value={view} onChange={setView} />}
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
          {own && detail && <BuiltFrom detail={detail} booked={booked} used={used} />}
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
          {/* OF THE JOB, in its own tab: the quote and every invoice on the
              job, this one in ink, the rest in grey (decision 6) */}
          {doc && (
            <section className="jpr-grp" aria-label="Of the job">
              <h3>Of the job</h3>
              <ul className="jpr-lines">
                {doc.quoteFigure && (
                  <li>
                    <span className="jpr-line">
                      <em>Quote</em>
                    </span>
                    <span className="jpr-amt jpr-amt--q">{doc.quoteFigure}</span>
                  </li>
                )}
                {doc.billing.rows.map((b) => (
                  <li key={b.claimId ?? b.name} aria-current={b.claimId === card.claimId ? "true" : undefined}>
                    <span className="jpr-line">
                      {b.claimId === card.claimId ? <b>{b.name}</b> : <em>{b.name}</em>}
                      <em>{b.word}</em>
                    </span>
                    <span className={b.claimId === card.claimId ? "jpr-amt" : "jpr-amt jpr-amt--q"}>{b.cents != null ? fmtAud(b.cents) : "–"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* what's written on a claim of its own; a job's one invoice is
              the job itself, whose notes are the job's, not the invoice's
              (the walk of 15 November 2026, 3408) */}
          {read && id.toLowerCase() !== job.toLowerCase() && (
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
          {!doc && card.claimId && (
            /* in a tab of its own, Breakdown and Invoice (decision 6) */
            <Button
              kind="main"
              href={invoiceHref(job, card.claimId)}
              onClick={() => openInTab(invoiceHref(job, card.claimId!), `${window.location.pathname}${window.location.search}`)}
            >
              Open invoice
            </Button>
          )}
          {paper?.url && (
            <Button kind="second" onClick={() => onOpenPaper(paper)}>
              Open the PDF
            </Button>
          )}
          {href && (
            /* ServiceM8's own green, ink on it, where it goes there (rule 25b) */
            <Button kind={doc ? "sm8" : "quiet"} href={href} target="_blank" rel="noreferrer">
              Open in ServiceM8
            </Button>
          )}
        </div>
      </aside>
    </div>
    </>
  );
}

/* BUILT FROM (the Price mock's invoice, 3408; the walk of 16 November 2026,
   N4): what the job's own invoice stands on, oldest first: each day on site
   with who went and for how long, the work done as written on the job, and
   how much was said used (job_materials_used, as the Job tracker counts it).
   A past booking nobody checked in on is a visit too when that person left
   photos or notes during it (built-from.ts), said as booked: its time is
   the booking's, not a check-in's (Isaac, 17 November 2026, 3408). */
function BuiltFrom({ detail, booked, used }: { detail: MirrorJobDetail; booked: readonly BookedVisitRead[]; used: number | null | undefined }) {
  const visits = [
    ...detail.visits.map((v) => ({
      day: v.day,
      key: v.day,
      words: [v.crew.map((c) => c.name).join(", "), v.minutes > 0 ? fmtMinutesAsHours(Math.round(v.minutes)) : null].filter(Boolean).join(", ") || "Nobody recorded",
    })),
    ...booked.map((b) => ({ day: b.day, key: `${b.day}|${b.who}`, words: `${b.who}, booked ${fmtMinutesAsHours(b.minutes)}` })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const done = firstWords(detail.workDone);
  return (
    <section className="jpr-grp" aria-label="Built from">
      <h3>Built from</h3>
      <ul className="jpr-lines">
        {visits.map((v) => (
          <li key={v.key}>
            <span className="jpr-line">
              <b>Visit, {fmtAuWeekdayDayMonth(v.day)}</b>
              <em>{v.words}</em>
            </span>
          </li>
        ))}
        {visits.length === 0 && (
          <li>
            <span className="jpr-line">
              <b>Visits</b>
              <em>No time on site recorded</em>
            </span>
          </li>
        )}
        <li>
          <span className="jpr-line">
            <b>Work done</b>
            <em>{done ? <Fade lines={2}>{done}</Fade> : "Nothing written"}</em>
          </span>
        </li>
        {typeof used === "number" && (
          <li>
            <span className="jpr-line">
              <b>Used</b>
              <em>{used === 0 ? "Nothing recorded" : `${used} ${used === 1 ? "thing" : "things"}`}</em>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

/** The work done's first sentence, the rest left to the job's own page. */
function firstWords(text: string | null): string | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const end = t.search(/[.!?](\s|$)/);
  return end >= 0 ? t.slice(0, end + 1) : t;
}
