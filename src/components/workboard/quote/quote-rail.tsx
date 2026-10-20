"use client";

import type { ReactNode } from "react";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { unsetWords } from "@/lib/quotes/build-settings";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { cents2, labourOf, quoteGroups, quoteParts, unitsOf } from "@/lib/quotes/quote-sum";
import { fmtAud } from "@/lib/workboard/project-money";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { DocRow } from "../board/job-documents-face";
import type { Sm8Quote } from "../board/job-quote-card";

/* THE RAIL: what the quote comes to, beside the conversation (the
   chat-first quote page, Isaac, 2026-10-13; layout C, 18 October). Its own
   scroll, 400 wide: the quote's progress, small, at its top; what's To
   confirm when Tiff isn't on for the business (with her on, it's the
   conversation's, till the paper stands in its place: then Before you
   approve is here); the quote's card and its buttons under it; what goes
   to ServiceM8 once it's approved or accepted; the quote ServiceM8 already
   holds; and what Tiff has cost, to someone who sees money. */

/* the parts' colours, the chart's: a figure in colour always carries its
   name beside it (docs/design.md, charts are drawn in colour) */
const PART_COLOUR: Record<string, string> = { units: "var(--chart-1)", materials: "var(--chart-3)", labour: "var(--chart-2)" };

/** a variation's figures: the difference it makes */
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${cents2(Math.abs(c))}`;

/** THE QUOTE (it replaces the head's ledger, 2026-10-10): the total, the
    screen's one big figure, its three parts and their split, the profit as
    a figure and a state word with no box (Q4), then every group in one
    order, each set adding up to the total (quote-sum.ts). A variation's
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
  const groups = b && price && price.ok ? quoteGroups(b, price.chargeOutCents) : [];
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
              <b>{`${profit.pct}%, ${cents2(profit.profitCents)}`}</b>
              {tone && words && (
                <StateWord tone={tone} className="qp-pword">
                  {words}
                </StateWord>
              )}
            </div>
          )}
          {groups.length > 0 && (
            <ul className="qp-groups" aria-label="By group">
              {groups.map((g) => (
                <li key={g.key}>
                  <span>{g.label}</span>
                  <b>{cents2(g.cents)}</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** THE QUOTE SERVICEM8 ALREADY HOLDS (Isaac, 2026-10-03: "if a quote has
    been generated in sm8 it should show on our quote page"): the day it went
    to the client, and its PDF, opening on the page. */
export function AlreadyQuoted({ sm8, onOpenPaper }: { sm8: Sm8Quote | null; onOpenPaper?: (item: JobMediaItem) => void }) {
  if (!sm8 || (sm8.papers.length === 0 && !sm8.sentOn)) return null;
  const [first, ...more] = sm8.papers;
  /* a PDF not brought across yet has nothing to open: the row is words, and
     every PDF keeps its own row, so none drops off the page with its "not
     brought across yet" */
  const rows = first?.url ? more : sm8.papers;
  const row = (
    <>
      <Icon name="servicem8" size={18} />
      <span className="qc-rt">
        <b>{sm8.sentOn ? "Sent from ServiceM8" : "ServiceM8's quote"}</b>
        <em>{sm8.sentOn ? `Their quote to the client, ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Not sent yet"}</em>
      </span>
      {first?.url && <Icon name="chevR" size={14} />}
    </>
  );
  return (
    <section className="qc-rs" aria-label="Already quoted">
      <h2 className="qc-h">Already quoted</h2>
      {/* the row opens its PDF; a second PDF (a revised quote) follows as a row of its own */}
      {first?.url ? (
        <button type="button" className="qc-row" onClick={() => onOpenPaper?.(first)}>
          {row}
        </button>
      ) : (
        <div className="qc-row">{row}</div>
      )}
      {rows.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
    </section>
  );
}

export function QuoteRail({
  progress,
  actions,
  confirm,
  confirmTitle,
  card,
  building,
  send,
  sm8,
  onOpenPaper,
  spentUsd,
}: {
  /** the quote's progress, small, at the rail's top */
  progress: ReactNode;
  /** the quote's buttons, under its card */
  actions: ReactNode;
  /** what's To confirm, or Before you approve on the paper, when the
      conversation isn't there to hold it */
  confirm: ReactNode;
  confirmTitle: string;
  /** the quote's card, to someone who sees money; null to anyone else */
  card: ReactNode;
  /** Tiff building it, where there's no card to hold it */
  building: ReactNode;
  /** what goes to ServiceM8, as it stands today */
  send: ReactNode;
  sm8: Sm8Quote | null;
  onOpenPaper?: (item: JobMediaItem) => void;
  /** what Tiff has cost on the quote: null to anyone who doesn't see money */
  spentUsd: number | null;
}) {
  return (
    <aside className="qc-rail" aria-label="On this quote">
      <div>{progress}</div>
      {confirm && (
        <section className="qc-rs" aria-label={confirmTitle}>
          <h2 className="qc-h">{confirmTitle}</h2>
          {confirm}
        </section>
      )}
      {card ? (
        <section className="qc-rs" aria-label="The quote">
          <h2 className="qc-h">The quote</h2>
          {card}
        </section>
      ) : (
        building
      )}
      {actions}
      {send}
      <AlreadyQuoted sm8={sm8} onOpenPaper={onOpenPaper} />
      {spentUsd != null && <p className="qc-spent">{`Tiff on this quote, ${fmtAud(Math.round(spentUsd * 100))}`}</p>}
    </aside>
  );
}
