import { fmtAud } from "@/lib/workboard/project-money";
import type { FamilyClaim } from "@/lib/workboard/job-family";
import type { PaymentRow } from "@/lib/workboard/job-billing";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { QuoteFacts } from "@/lib/quotes/quote-card";
import { acceptedState, landingKind, landingMoney, progressState, type LandingWhen, type QuoteLanding } from "@/lib/quotes/quote-landing";

/* EVERY PRICE ON A JOB, AS A CARD ACROSS THE TOP OF ITS PRICE TAB (the job
   page plan's build 10, on the Price Tab mock drawn on 3408, 13 November
   2026; Isaac, 14 November: "Build all as recommended"). What each one is,
   what it comes to, and where it stands:

     the quote     HeyTiff's quote on the job, built with Tiff: its name,
                   its total ex GST and its state word, as the old Quote
                   tab's landing said them (quote-landing.ts)
     ServiceM8's   a quote typed into ServiceM8 and never built here, so
                   there is no chat behind it until someone updates it in
                   HeyTiff (3408's return visit)
     an invoice    each claim ServiceM8 has invoiced, ONLY to whoever sees
                   money: its figure and its word exactly as Billing's row
                   says them (job-billing.ts), so what's owed is said one
                   way, ex GST where ServiceM8 itemised it and labelled inc
                   GST where it didn't. GST is never worked out.

   One quote a job: a second, separate quote isn't in the data, so a quote
   card stands for its versions and variations, which open inside it. A claim
   still to come isn't an invoice yet and stays Billing's alone. Pure. */

export type PriceTone = "good" | "look" | "wrong" | "info";

export type PriceCard = {
  /** "quote", "sm8-quote", or "invoice:<the claim's uuid>" */
  key: string;
  kind: "quote" | "sm8-quote" | "invoice";
  /** the small grey word over the name: "Quote", "Invoice #3408" */
  label: string;
  /** what it is: the quote's name, "Deposit, 30%" */
  name: string;
  /** "$775.00 ex GST"; null without the money, or before it's priced */
  figure: string | null;
  state: { word: string; tone: PriceTone } | null;
  /** the claim an invoice card opens */
  claimId?: string;
};

/** What the Price tab was asked to open on: a door's, or the address's. */
export type PriceAsk = {
  /** the quote, its reply box ready for the brief (Add › Quote, New quote) */
  start?: boolean;
  /** that option of the quote: a variation Tiff started */
  option?: number | null;
  /** Update quote, with what's landed since it was sent written in */
  update?: boolean;
  /** this claim's invoice (Billing's row, a claim's own address) */
  invoice?: string | null;
  /** bumped on every ask, so the same door twice still lands */
  n: number;
};

/** The quote as the quote-status route read it: undefined while it's read,
    null when the read failed. */
export type QuoteRead = { facts: QuoteFacts; landing: QuoteLanding | null } | null | undefined;

/** ServiceM8's own quote on the job, as sm8QuoteOf says it. */
export type Sm8QuoteSeen = { papers: readonly JobMediaItem[]; sentOn: string | null; value: string | null };

const figureOf = (row: Pick<PaymentRow, "cents" | "basis">): string | null =>
  row.cents === null ? null : `${fmtAud(row.cents)} ${row.basis === "inc" ? "inc GST" : "ex GST"}`;

/** Whether ServiceM8 holds a quote of its own on the job: a PDF it made, or
    the day it went. */
export const sm8Quoted = (sm8: Sm8QuoteSeen | null): boolean => !!sm8 && (sm8.papers.length > 0 || !!sm8.sentOn);

/** Whether HeyTiff's quote has begun: lines, a talk with Tiff, an old draft. */
export const quoteBegun = (quote: QuoteRead): boolean => !!quote && landingKind(quote.facts) !== "first";

export function priceCards(input: {
  quote: QuoteRead;
  sm8: Sm8QuoteSeen | null;
  /** Billing's rows and the claims they are, both null without the money */
  rows: readonly PaymentRow[] | null;
  claims: readonly Pick<FamilyClaim, "remoteId" | "jobNumber" | "state">[] | null;
  /** billed in stages: each invoice is named by its stage */
  staged: boolean;
  /** a quote asked for that hasn't begun: its card stands while it's briefed */
  starting?: boolean;
  when: LandingWhen;
}): PriceCard[] {
  const { quote, sm8, when } = input;
  const cards: PriceCard[] = [];

  if (quote && quoteBegun(quote)) {
    const { facts, landing } = quote;
    const accepted = landingKind(facts) === "accepted";
    const st = accepted ? acceptedState(facts, landing ?? { acceptedAt: null }, when) : progressState(facts, when);
    const total = landing?.totalCents ?? null;
    cards.push({
      key: "quote",
      kind: "quote",
      label: "Quote",
      name: landing?.name?.trim() || "Quote",
      figure: total !== null ? `${landingMoney(total)} ex GST` : null,
      state: { word: st.word, tone: st.tone },
    });
  } else if (input.starting) {
    cards.push({ key: "quote", kind: "quote", label: "Quote", name: "New quote", figure: null, state: { word: "Brief, with Tiff", tone: "info" } });
  } else if (sm8Quoted(sm8)) {
    cards.push({
      key: "sm8-quote",
      kind: "sm8-quote",
      label: "Quote, in ServiceM8",
      name: sm8!.papers.length > 1 ? `${sm8!.papers.length} quotes` : "ServiceM8's quote",
      figure: sm8!.value,
      state: sm8!.sentOn ? { word: `Sent ${when.day(sm8!.sentOn)}`, tone: "info" } : { word: "Not sent yet", tone: "info" },
    });
  }

  /* the invoices, money only: Billing's own rows, less what isn't invoiced */
  if (input.rows && input.claims) {
    for (const row of input.rows) {
      const claim = row.claimId ? input.claims.find((c) => c.remoteId === row.claimId) : undefined;
      if (!claim || claim.state === "not_invoiced") continue;
      const number = claim.jobNumber ? `#${claim.jobNumber}` : "";
      cards.push({
        key: `invoice:${claim.remoteId}`,
        kind: "invoice",
        label: number ? `Invoice ${number}` : "Invoice",
        name: input.staged ? row.name : "The job's invoice",
        figure: figureOf(row),
        state: { word: row.word, tone: row.tone },
        claimId: claim.remoteId,
      });
    }
  }
  return cards;
}

/** The card the tab opens on: the invoice asked for, else the quote, else
    the newest invoice, else nothing. */
export function firstCard(cards: readonly PriceCard[], invoice: string | null | undefined): string | null {
  if (invoice) {
    const low = invoice.toLowerCase();
    const hit = cards.find((c) => c.claimId?.toLowerCase() === low);
    if (hit) return hit.key;
  }
  return cards.find((c) => c.kind !== "invoice")?.key ?? cards.at(-1)?.key ?? null;
}

/** The paper an invoice is previewed on: the PDF ServiceM8 made for it,
    newest first, else any PDF filed against it. */
export function invoicePaperOf(documents: readonly JobMediaItem[]): JobMediaItem | null {
  const pdf = (d: JobMediaItem) => (d.fileType ?? "").toLowerCase().endsWith("pdf") || /\.pdf$/i.test(d.name);
  const newest = (a: JobMediaItem, b: JobMediaItem) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "");
  const made = documents.filter((d) => d.origin === "Invoice").sort(newest);
  if (made.length > 0) return made[0]!;
  const named = documents.filter((d) => pdf(d) && /invoice/i.test(d.name)).sort(newest);
  return named[0] ?? null;
}
