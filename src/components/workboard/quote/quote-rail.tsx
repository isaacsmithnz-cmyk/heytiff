"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { unsetWords } from "@/lib/quotes/build-settings";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { cents2, labourOf, quoteParts, unitsOf } from "@/lib/quotes/quote-sum";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { DocRow } from "../board/job-documents-face";
import type { Sm8Quote } from "../board/job-quote-card";

/* THE RAIL: what the quote comes to, beside the conversation (the
   chat-first quote page, Isaac, 2026-10-13), in layout B (his pick, 21
   October 2026: "Price on top, buttons pinned"). Read top to bottom like a
   checkout, on its own scroll, 400 wide: where the quote is, in colour;
   what's To confirm when Tiff isn't on for the business (with her on, it's
   the conversation's, till the paper stands in its place: then Before you
   approve is here); the price, to someone who sees money; Line items under
   it; what goes to ServiceM8 once it's accepted; and the job in ServiceM8.
   The quote's buttons are pinned at its foot, under a thin line, so they
   never scroll away (quote-actions.tsx). What Tiff has cost left the page
   with layout B. */

/* the parts' colours, the chart's: a figure in colour always carries its
   name beside it (docs/design.md, charts are drawn in colour) */
const PART_COLOUR: Record<string, string> = { units: "var(--chart-1)", materials: "var(--chart-3)", labour: "var(--chart-2)" };

/** a variation's figures: the difference it makes */
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${cents2(Math.abs(c))}`;

/** THE QUOTE (it replaces the head's ledger, 2026-10-10): the total, the
    screen's one big figure, its three parts and their split, and the profit
    as a figure and a state word with no box (Q4), the figure in green at or
    over the business's target and orange under it (layout B, 21 October
    2026). The groups are the line items' to say, once. A variation's
    figures are the difference it makes. */
export function QuoteCard({
  price,
  option,
  label,
  left,
  hours,
  variation,
  building,
}: {
  price: QuotePrice | null | undefined;
  /** the option open on the page, priced */
  option: OptionPrice | undefined;
  /** "Total ex GST", with the option and ", so far" as they apply */
  label: string;
  /** something is still to price: every figure is so far, and the profit
      claims no state against the target until nothing is */
  left: boolean;
  /** the option's labour hours, the contingency's included */
  hours: number;
  /** a variation open: the accepted option it changes, and that one's hours */
  variation: { n: number; of: OptionPrice; hours: number } | null;
  /** Tiff building the quote, part by part, under the total */
  building: ReactNode;
}) {
  const unset = !!price && !price.ok;
  const b = option?.build;

  if (b && variation) {
    const was = variation.of.build;
    const parts = [
      { key: "units", label: "Units", cents: unitsOf(b) - unitsOf(was) },
      { key: "materials", label: "Materials", cents: b.exGstCents - unitsOf(b) - labourOf(b) - (was.exGstCents - unitsOf(was) - labourOf(was)) },
      { key: "labour", label: `Labour, ${hours - variation.hours > 0 ? "+" : ""}${Math.round((hours - variation.hours) * 100) / 100} h`, cents: labourOf(b) - labourOf(was) },
    ];
    const ex = b.exGstCents - was.exGstCents;
    const profit = option?.profit && variation.of.profit ? option.profit.profitCents - variation.of.profit.profitCents : null;
    return (
      <div className="qp-card">
        <div className="qp-tot">
          <span>{`Variation ${variation.n}, ex GST`}</span>
          <b>{signed(ex)}</b>
          <em>{`New total ${cents2(b.exGstCents)}`}</em>
        </div>
        {building}
        <ul className="qp-parts" aria-label="Its parts">
          {parts.map((p) => (
            <li key={p.key}>
              <i style={{ background: PART_COLOUR[p.key] }} aria-hidden="true" />
              <span>{p.label}</span>
              <b>{signed(p.cents)}</b>
            </li>
          ))}
        </ul>
        {profit != null && (
          <div className="qp-profit">
            <span>
              Profit
              {left ? <small>so far</small> : ex !== 0 && <small>{`${Math.round((profit / ex) * 1000) / 10}% of it`}</small>}
            </span>
            <b>{signed(profit)}</b>
          </div>
        )}
      </div>
    );
  }

  const parts = b ? quoteParts(b, hours) : [];
  const whole = parts.reduce((n, p) => n + Math.max(0, p.cents), 0);
  const profit = option?.profit ?? null;
  /* the state in its colour, in words: over the target, or how far under
     and what would meet it; with no target, the figures alone. While
     anything is still to price the figures are so far, and so is the
     profit: no state, and no price to meet the target worked out from part
     of the quote (the head said what was left to confirm there, and its red
     sentence waited until nothing was) */
  const tone = !profit || profit.targetPct == null || left ? null : profit.short ? ("look" as const) : ("good" as const);
  const words =
    !profit || left || profit.targetPct == null
      ? null
      : profit.short
        ? `Under your ${profit.targetPct}% target by ${cents2(profit.short.cents)}. ${cents2(profit.short.priceCents)} ex GST would meet it`
        : `${profit.pct > profit.targetPct ? "Over" : "At"} your ${profit.targetPct}%`;
  return (
    <div className="qp-card">
      <div className="qp-tot">
        <span>{unset ? "Price" : label}</span>
        {unset ? <b className="qc-wait">Not set</b> : <b>{b ? cents2(b.exGstCents) : "–"}</b>}
        {price && !price.ok ? <em>{unsetWords(price.unset)}</em> : b ? <em>{`${cents2(b.incGstCents)} inc GST`}</em> : null}
      </div>
      {building}
      {b && (
        <>
          <ul className="qp-parts" aria-label="Its parts">
            {parts.map((p) => (
              <li key={p.key}>
                <i style={{ background: PART_COLOUR[p.key] }} aria-hidden="true" />
                <span>{p.label}</span>
                <b>{cents2(p.cents)}</b>
              </li>
            ))}
          </ul>
          {whole > 0 && (
            <div className="ql-split" aria-hidden="true">
              {parts.map((p) => (
                <span key={p.key} style={{ flexGrow: Math.max(0, p.cents), background: PART_COLOUR[p.key] }} />
              ))}
            </div>
          )}
          {profit && (
            <div className="qp-profit">
              <span>
                Profit
                {left && <small>so far</small>}
              </span>
              <b className={tone === "good" ? "good" : tone === "look" ? "look" : undefined}>{`${profit.pct}%, ${cents2(profit.profitCents)}`}</b>
              {tone && words && (
                <StateWord tone={tone} className="qp-pword">
                  {words}
                </StateWord>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** THE JOB IN SERVICEM8 (it was Already quoted, Isaac, 2026-10-03: "if a
    quote has been generated in sm8 it should show on our quote page"; a
    card of its own in layout B, 21 October 2026, never an underlined link):
    ServiceM8's own quote, the day it went and what it came to, and this
    quote's day once it went too; Open their PDF opens it on the page, and
    Open in ServiceM8 the job there. A PDF not brought across yet, or a
    second one (a revised quote), is a row of its own, so none drops off. */
export function InServiceM8({
  sm8,
  href,
  ours,
  onOpenPaper,
}: {
  sm8: Sm8Quote | null;
  /** ServiceM8's own page for the job, when there is one */
  href: string | null;
  /** this quote, once it went to ServiceM8 for real: the day it went, and
      what it came to to someone who sees money */
  ours: { at: string; value: string | null } | null;
  onOpenPaper?: (item: JobMediaItem) => void;
}) {
  const theirs = !!sm8 && (sm8.papers.length > 0 || !!sm8.sentOn);
  if (!theirs && !ours) return null;
  const papers = sm8?.papers ?? [];
  const [first, ...more] = papers;
  const rows = first?.url ? more : papers;
  return (
    <section className="qc-sm8" aria-label="In ServiceM8">
      <h2 className="qc-sm8h">
        <Icon name="servicem8" size={16} />
        In ServiceM8
      </h2>
      {theirs && (
        <p className="qc-sm8r">
          <span>{sm8.sentOn ? `Their quote, sent ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Their quote, not sent yet"}</span>
          {sm8.value && <b>{sm8.value}</b>}
        </p>
      )}
      {ours && (
        <p className="qc-sm8r">
          <span>{`This quote, sent ${fmtAuWeekdayDayMonth(auDayOf(ours.at))}`}</span>
          {ours.value && <b>{ours.value}</b>}
        </p>
      )}
      {rows.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
      {(first?.url || href) && (
        <div className="qc-pair">
          {first?.url && <Button onClick={() => onOpenPaper?.(first)}>Open their PDF</Button>}
          {href && (
            <Button href={href} target="_blank" rel="noopener noreferrer">
              Open in ServiceM8
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function QuoteRail({
  progress,
  confirm,
  confirmTitle,
  card,
  building,
  lines,
  send,
  sm8,
  actions,
}: {
  /** where the quote is, in colour, at the rail's top */
  progress: ReactNode;
  /** what's To confirm, or Before you approve on the paper, when the
      conversation isn't there to hold it */
  confirm: ReactNode;
  confirmTitle: string;
  /** the quote's price, to someone who sees money; null to anyone else */
  card: ReactNode;
  /** Tiff building it, where there's no card to hold it */
  building: ReactNode;
  /** Line items, under the price, while there's a conversation to swap with */
  lines: ReactNode;
  /** what goes to ServiceM8 once it's accepted, as it stands today */
  send: ReactNode;
  /** the job in ServiceM8 */
  sm8: ReactNode;
  /** the quote's buttons, pinned at the rail's foot */
  actions: ReactNode;
}) {
  return (
    <aside className="qc-rail" aria-label="On this quote">
      <div className="qc-scroll">
        <div>{progress}</div>
        {confirm && (
          <section className="qc-rs" aria-label={confirmTitle}>
            <h2 className="qc-h">{confirmTitle}</h2>
            {confirm}
          </section>
        )}
        {card ? (
          <section className="qc-rs" aria-label="The quote">
            {card}
          </section>
        ) : (
          building
        )}
        {lines}
        {send}
        {sm8}
      </div>
      {actions}
    </aside>
  );
}
