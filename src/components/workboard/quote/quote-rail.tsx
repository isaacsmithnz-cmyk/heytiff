"use client";

import type { ReactNode } from "react";
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
   chat-first quote page, Isaac, 2026-10-13). Its own scroll, 360 wide: what's
   To confirm when Tiff isn't on for the business (with her on, it's the
   conversation's), the quote's card, what goes to ServiceM8 once it's
   approved or accepted, the quote ServiceM8 already holds, and what Tiff
   has cost, to someone who sees money. */

/* the parts' colours, the chart's: a figure in colour always carries its
   name beside it (docs/design.md, charts are drawn in colour) */
const PART_COLOUR: Record<string, string> = { units: "var(--chart-1)", materials: "var(--chart-3)", labour: "var(--chart-2)" };

/** a variation's figures: the difference it makes */
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${cents2(Math.abs(c))}`;

/** THE QUOTE (it replaces the head's ledger, 2026-10-10): the total, its
    three parts and their split, the profit as a bar in the state's colour,
    then every group in one order, each set adding up to the total
    (quote-sum.ts). A variation's figures are the difference it makes. */
export function QuoteCard({
  price,
  option,
  label,
  hours,
  variation,
  building,
  lines,
  onLines,
}: {
  price: QuotePrice | null | undefined;
  /** the option open on the page, priced */
  option: OptionPrice | undefined;
  /** "Total ex GST", with the option and ", so far" as they apply */
  label: string;
  /** the option's labour hours, the contingency's included */
  hours: number;
  /** a variation open: the accepted option it changes, and that one's hours */
  variation: { n: number; of: OptionPrice; hours: number } | null;
  /** Tiff building the quote, part by part, under the total */
  building: ReactNode;
  /** the line items are up (true), the conversation (false), or there are
      no tabs to change (null: Tiff isn't on for the business) */
  lines: boolean | null;
  onLines: () => void;
}) {
  const unset = !!price && !price.ok;
  const b = option?.build;
  const button =
    lines === null ? null : (
      <button type="button" className="pbtn ghost qc-wide" onClick={onLines}>
        {lines ? "Back to the conversation" : "View line items"}
      </button>
    );

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
            <span>Profit</span>
            <b>{signed(profit)}</b>
            {ex !== 0 && <small>{`${Math.round((profit / ex) * 1000) / 10}% of it`}</small>}
          </div>
        )}
        {button}
      </div>
    );
  }

  const parts = b ? quoteParts(b, hours) : [];
  const groups = b && price && price.ok ? quoteGroups(b, price.chargeOutCents) : [];
  const whole = parts.reduce((n, p) => n + Math.max(0, p.cents), 0);
  const profit = option?.profit ?? null;
  /* the state in its colour, in words: over the target, or how far under
     and what would meet it; with no target, the figures alone */
  const tone = !profit || profit.targetPct == null ? "" : profit.short ? "warn" : "ok";
  const words = !profit || profit.targetPct == null
    ? null
    : profit.short
      ? `under your ${profit.targetPct}% target by ${cents2(profit.short.cents)}. ${cents2(profit.short.priceCents)} ex GST would meet it`
      : `${profit.pct > profit.targetPct ? "over" : "at"} your ${profit.targetPct}%`;
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
            <div className={tone ? `qp-profit ${tone}` : "qp-profit"}>
              <span>Profit</span>
              <b>
                <em>{`${profit.pct}%`}</em>
                {cents2(profit.profitCents)}
              </b>
              {words && <small>{words}</small>}
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
      {button}
    </div>
  );
}

/** THE QUOTE SERVICEM8 ALREADY HOLDS (Isaac, 2026-10-03: "if a quote has
    been generated in sm8 it should show on our quote page"): the day it went
    to the client, and its PDF, opening on the page. */
export function AlreadyQuoted({ sm8, onOpenPaper }: { sm8: Sm8Quote | null; onOpenPaper?: (item: JobMediaItem) => void }) {
  if (!sm8 || (sm8.papers.length === 0 && !sm8.sentOn)) return null;
  const [first, ...more] = sm8.papers;
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
      <h2 className="hd-ls-grp">Already quoted</h2>
      {/* the row opens its PDF; a second PDF (a revised quote) follows as a row of its own */}
      {first?.url ? (
        <button type="button" className="qc-row" onClick={() => onOpenPaper?.(first)}>
          {row}
        </button>
      ) : (
        <div className="qc-row">{row}</div>
      )}
      {more.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
    </section>
  );
}

export function QuoteRail({
  confirm,
  confirmTitle,
  card,
  building,
  send,
  sm8,
  onOpenPaper,
  spentUsd,
}: {
  /** what's To confirm, when the conversation isn't there to hold it */
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
      {confirm && (
        <section className="qc-rs" aria-label={confirmTitle}>
          <h2 className="hd-ls-grp">{confirmTitle}</h2>
          {confirm}
        </section>
      )}
      {card ? (
        <section className="qc-rs" aria-label="The quote">
          <h2 className="hd-ls-grp">The quote</h2>
          {card}
        </section>
      ) : (
        building
      )}
      {send}
      <AlreadyQuoted sm8={sm8} onOpenPaper={onOpenPaper} />
      {spentUsd != null && <p className="qc-spent">{`Tiff on this quote, ${fmtAud(Math.round(spentUsd * 100))}`}</p>}
    </aside>
  );
}
