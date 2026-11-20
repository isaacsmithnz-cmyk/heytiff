"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { stepPassed, type QuoteStep } from "@/lib/quotes/quote-steps";
import { RollingFigure } from "@/components/parts/rolling-figure";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { unsetWords } from "@/lib/quotes/build-settings";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { cents2, labourOf, quoteParts, unitsOf } from "@/lib/quotes/quote-sum";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { DocRow } from "../board/job-documents-face";
import type { Sm8Quote } from "./sm8-quote-of";

/* THE RAIL: what the quote comes to, beside the conversation (the
   chat-first quote page, Isaac, 2026-10-13), in layout B (his pick, 21
   October 2026: "Price on top, buttons pinned"). Read top to bottom like a
   checkout, on its own scroll, 400 wide: where the quote is, in colour;
   every option and its total, to pick from;
   the Design step, to someone with the Studio (quote-design.tsx, 28
   October 2026); what's To confirm when Tiff isn't on for the business (with her on, it's
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
export const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${cents2(Math.abs(c))}`;

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
          <b><RollingFigure value={signed(ex)} /></b>
          <em>New total <RollingFigure value={cents2(b.exGstCents)} /></em>
        </div>
        {building}
        <ul className="qp-parts" aria-label="Its parts">
          {parts.map((p) => (
            <li key={p.key}>
              <i style={{ background: PART_COLOUR[p.key] }} aria-hidden="true" />
              <span>{p.label}</span>
              <b><RollingFigure value={signed(p.cents)} /></b>
            </li>
          ))}
        </ul>
        {profit != null && (
          <div className="qp-profit">
            <span>
              Profit
              {left ? <small>so far</small> : ex !== 0 && <small>{`${Math.round((profit / ex) * 1000) / 10}% of it`}</small>}
            </span>
            <b><RollingFigure value={signed(profit)} /></b>
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
        {unset ? <b className="qc-wait">Not set</b> : <b>{b ? <RollingFigure value={cents2(b.exGstCents)} /> : "–"}</b>}
        {price && !price.ok ? <em>{unsetWords(price.unset)}</em> : b ? <em><RollingFigure value={cents2(b.incGstCents)} /> inc GST</em> : null}
      </div>
      {building}
      {b && (
        <>
          <ul className="qp-parts" aria-label="Its parts">
            {parts.map((p) => (
              <li key={p.key}>
                <i style={{ background: PART_COLOUR[p.key] }} aria-hidden="true" />
                <span>{p.label}</span>
                <b><RollingFigure value={cents2(p.cents)} /></b>
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
              <b className={tone === "good" ? "good" : tone === "look" ? "look" : undefined}><RollingFigure value={`${profit.pct}%, ${cents2(profit.profitCents)}`} /></b>
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

/* ── THE PANEL, AS AN IPHONE'S SCREEN (Isaac, 20 November 2026, on the
   quote's own tab: "and the right panel is on an iphone", then "make total
   spread across full width", "B but better", and "Build all three" to
   https://claude.ai/artifact/EAB8Y8FsbnPbcuBXKDhT93). On the soft ground,
   white cards the panel's width: the total and its parts as rows with every
   figure in one column, then where the quote is up to as rows, and the one
   next step at the foot. ── */

const hoursWords = (h: number) => `${Math.round(h * 100) / 100} ${Math.round(h * 100) / 100 === 1 ? "hour" : "hours"}`;

/** THE TOTAL, one white card the panel's width: which option, Total ex GST
    with the screen's one big figure on its right, Inc GST under it, then
    Units (only where there are any), Materials, Labour and the profit in
    that, each a row, every figure in the one column. No dots and no bar.
    The profit says nothing against the target unless it's under it. On the
    Proposal the card is the total alone (`parts` off). A variation's figures
    are the difference it makes. */
export function QuoteTotal({
  price,
  option,
  optionLabel,
  left,
  hours,
  variation,
  building,
  parts: withParts = true,
}: {
  price: QuotePrice | null | undefined;
  option: OptionPrice | undefined;
  /** "Option 2", or the way to pick another; nothing for a quote with one */
  optionLabel: ReactNode;
  left: boolean;
  hours: number;
  variation: { n: number; of: OptionPrice; hours: number } | null;
  building: ReactNode;
  parts?: boolean;
}) {
  const unset = !!price && !price.ok;
  const b = option?.build;
  const top = (name: string, figure: ReactNode, underName: string, underFigure: ReactNode) => (
    <div className="qx-top">
      {optionLabel && <div className="qx-opt">{optionLabel}</div>}
      <div className="qx-r1">
        <b>{name}</b>
        <strong>{figure}</strong>
      </div>
      {(underName || underFigure) && (
        <div className="qx-r2">
          <span>{underName}</span>
          <span>{underFigure}</span>
        </div>
      )}
    </div>
  );
  const line = (key: string, name: string, figure: ReactNode, tone?: "good" | "look") => (
    <div key={key} className="qx-line">
      <span>{name}</span>
      <b className={tone}>{figure}</b>
    </div>
  );

  if (b && variation) {
    const was = variation.of.build;
    const dh = Math.round((hours - variation.hours) * 100) / 100;
    const rows = [
      { key: "units", label: "Units", cents: unitsOf(b) - unitsOf(was) },
      { key: "materials", label: "Materials", cents: b.exGstCents - unitsOf(b) - labourOf(b) - (was.exGstCents - unitsOf(was) - labourOf(was)) },
      { key: "labour", label: dh === 0 ? "Labour" : `Labour, ${dh > 0 ? "+" : "−"}${hoursWords(Math.abs(dh))}`, cents: labourOf(b) - labourOf(was) },
    ].filter((r) => r.key !== "units" || r.cents !== 0);
    const ex = b.exGstCents - was.exGstCents;
    const profit = option?.profit && variation.of.profit ? option.profit.profitCents - variation.of.profit.profitCents : null;
    return (
      <div className="qx-card qx-tot">
        {top(`Variation ${variation.n}, ex GST`, <RollingFigure value={signed(ex)} />, "New total", <RollingFigure value={cents2(b.exGstCents)} />)}
        {building}
        {withParts && rows.map((r) => line(r.key, r.label, <RollingFigure value={signed(r.cents)} />))}
        {withParts && profit != null && line("profit", left ? "Profit so far" : ex !== 0 ? `Profit in that, ${Math.round((profit / ex) * 1000) / 10}%` : "Profit in that", <RollingFigure value={signed(profit)} />)}
      </div>
    );
  }

  const rows = b ? quoteParts(b, hours).filter((r) => r.key !== "units" || r.cents !== 0) : [];
  const profit = option?.profit ?? null;
  /* under the target, and only then: how far, and what would meet it. Over
     or at it the figure is green and says so by itself */
  const tone = !profit || profit.targetPct == null || left ? undefined : profit.short ? ("look" as const) : ("good" as const);
  const under = profit && !left && profit.targetPct != null && profit.short ? `Under your ${profit.targetPct}% target by ${cents2(profit.short.cents)}. ${cents2(profit.short.priceCents)} ex GST would meet it` : null;
  return (
    <div className="qx-card qx-tot">
      {unset
        ? top("Price", <span className="qc-wait">Not set</span>, price && !price.ok ? unsetWords(price.unset) : "", null)
        : top(`Total ex GST${left ? ", so far" : ""}`, b ? <RollingFigure value={cents2(b.exGstCents)} /> : "–", b ? "Inc GST" : "", b ? <RollingFigure value={cents2(b.incGstCents)} /> : null)}
      {building}
      {withParts && b && (
        <>
          {rows.map((r) => line(r.key, r.key === "labour" ? (hours > 0 ? `Labour, ${hoursWords(hours)}` : "Labour") : r.label, <RollingFigure value={cents2(r.cents)} />))}
          {profit && line("profit", `Profit ${left ? "so far" : "in that"}, ${profit.pct}%`, <RollingFigure value={cents2(profit.profitCents)} />, tone)}
          {under && (
            <div className="qx-under">
              <StateWord tone="look">{under}</StateWord>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Which option the panel's figures are, and the way to another where the
    slider isn't on the page (Build and Proposal): a quiet word that opens
    every option and its total. On Breakdown the slider picks, and this is
    the word alone. */
export function OptionPick({ rows, onPick, pick }: { rows: { option: number; name: string; line: string; total: string | null; on: boolean }[]; onPick: (option: number) => void; pick: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const on = rows.find((r) => r.on);
  if (rows.length < 2 || !on) return null;
  if (!pick) return <span>{on.name}</span>;
  return (
    <>
      <button ref={ref} type="button" className="qx-pick" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {on.name}
        <Icon name="chevD" size={16} />
      </button>
      <Menu
        open={open}
        anchor={ref}
        label="Options"
        onClose={() => setOpen(false)}
        onSelect={(k) => {
          setOpen(false);
          onPick(Number(k));
        }}
        items={rows.map((r) => ({ key: String(r.option), label: r.total ? `${r.name}, ${r.total}` : r.name, hint: r.line || undefined }))}
      />
    </>
  );
}

/** WHERE IT'S UP TO, as rows: the last step done, each step that needs a
    look, what the page has to confirm (the page's own list, with its
    buttons), and the step that's next. Not all seven: the head of the tab
    says the state, and the button under this says the next thing to press.
    A dot and a word, as rule 17 has state. */
export function WhereUpTo({
  steps,
  onUndoAccepted,
  busy = false,
  children,
}: {
  steps: QuoteStep[];
  /** Undo beside Customer accepted, where the yes is said */
  onUndoAccepted?: () => void;
  busy?: boolean;
  /** what's to confirm, between what needs a look and what's next */
  children?: ReactNode;
}) {
  const lastDone = steps.findLastIndex((s) => s.state === "done");
  const due = steps.filter((s) => s.state === "due");
  const next = steps.find((s, i) => i > lastDone && !stepPassed(s) && s.state !== "due");
  const row = (s: QuoteStep, tone: "done" | "look" | "next") => (
    <li key={s.key} className={`qx-row qx-step ${tone}`} aria-current={tone === "next" ? "step" : undefined}>
      <i className="qx-dot" aria-hidden="true" />
      <b>{s.label}</b>
      <span className="qx-r">{s.words || (tone === "next" ? "Not yet" : "")}</span>
      {onUndoAccepted && s.key === "accepted" && s.state === "done" && (
        <Button kind="quiet" size={32} disabled={busy} onClick={onUndoAccepted} aria-label="Undo accepted">
          Undo
        </Button>
      )}
    </li>
  );
  return (
    <section className="qx-sec" aria-label="Where it's up to">
      <h2 className="qx-head">Where it&rsquo;s up to</h2>
      <div className="qx-card qx-rows">
        {(lastDone >= 0 || due.length > 0) && (
          <ol className="qx-steps" aria-label="Where the quote is">
            {lastDone >= 0 && row(steps[lastDone]!, "done")}
            {due.map((s) => row(s, "look"))}
          </ol>
        )}
        {children}
        {next && (
          <ol className="qx-steps" aria-label="Next">
            {row(next, "next")}
          </ol>
        )}
      </div>
    </section>
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

/** ONE ROW AN OPTION, EVERY OPTION'S TOTAL (Isaac's walk of 3423, 30 October
    2026; they were tabs over the line items): the row picks which option the
    price under it and the line items show. A variation says the difference
    it makes. Nothing for a quote with one option. */
export function OptionRows({ rows, onPick }: { rows: { option: number; name: string; line: string; total: string | null; on: boolean }[]; onPick: (option: number) => void }) {
  if (rows.length < 2) return null;
  return (
    <section className="qc-opts" aria-label="Options">
      {rows.map((r) => (
        <button key={r.option} type="button" className={r.on ? "qc-opt on" : "qc-opt"} aria-pressed={r.on} onClick={() => onPick(r.option)}>
          <span>
            <b>{r.name}</b>
            {r.line && <em>{r.line}</em>}
          </span>
          {r.total && <b>{r.total}</b>}
        </button>
      ))}
    </section>
  );
}

/** What's landed on the job since the quote was priced (the scope on the
    quote, Isaac's yes, 2 November 2026): nothing when nothing has. Leave out
    takes a thing off this list and leaves it in the job's brief. */
export function AddedRows({
  items,
  since = "priced",
  onLeave,
  onPrice,
}: {
  items: { text: string; from: string }[];
  /** what it's landed since: before it's sent, Price them; after, Update
      quote, orange as quoting is (25c, slice 4) */
  since?: "priced" | "sent" | "accepted";
  onLeave: (text: string) => void;
  onPrice: () => void;
}) {
  if (items.length === 0) return null;
  const heading = `${items.length} added since it was ${since}`;
  return (
    <section className="qc-added" aria-label={heading}>
      <h2>{heading}</h2>
      <ul>
        {items.map((a) => (
          <li key={a.text}>
            <span>
              {a.text}
              {a.from && <em>{a.from}</em>}
            </span>
            <Button kind="quiet" size={32} onClick={() => onLeave(a.text)}>Leave out</Button>
          </li>
        ))}
      </ul>
      {since === "priced" ? (
        <Button kind="second" size={36} onClick={onPrice}>Price them</Button>
      ) : (
        <Button kind="quote" size={36} onClick={onPrice}>Update quote</Button>
      )}
    </section>
  );
}

export function QuoteRail({
  progress,
  options,
  added,
  design,
  confirm,
  confirmTitle,
  card,
  building,
  lines,
  send,
  sm8,
  actions,
  priceFirst = false,
  panel = false,
  proposal,
}: {
  /** where the quote is, in colour, at the rail's top */
  progress: ReactNode;
  /** the price at the rail's top, over where it's up to (the job's Price
      tab, as its mock drew it; the walk of 15 November 2026, T3) */
  priceFirst?: boolean;
  /** every option and its total, to pick from */
  options?: ReactNode;
  /** what's landed on the job since it was priced, under the options */
  added?: ReactNode;
  /** the Design step: the job's designs, or Design it (quote-design.tsx);
      nothing without the Studio */
  design?: ReactNode;
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
  /** laid out as an iPhone's screen (the quote's own tab): the total, then
      the Proposal's own rows where it's up, where it's up to with what's
      to confirm inside it, and the rest as they were */
  panel?: boolean;
  /** the Proposal's choice, payment and notes, as rows (panel) */
  proposal?: ReactNode;
}) {
  if (panel)
    return (
      <aside className="qc-rail qx-panel" aria-label="On this quote">
        <div className="qc-scroll">
          {card ? (
            <section className="qx-sec" aria-label="The quote">
              {card}
            </section>
          ) : (
            building
          )}
          {proposal}
          {progress}
          {options}
          {added}
          {design}
          {lines}
          {send}
          {sm8}
        </div>
        {actions}
      </aside>
    );
  return (
    <aside className="qc-rail" aria-label="On this quote">
      <div className="qc-scroll">
        {priceFirst && card && (
          <section className="qc-rs" aria-label="The quote">
            {card}
          </section>
        )}
        <div>{progress}</div>
        {options}
        {added}
        {design}
        {confirm && (
          <section className="qc-rs" aria-label={confirmTitle}>
            <h2 className="qc-h">{confirmTitle}</h2>
            {confirm}
          </section>
        )}
        {card ? (
          priceFirst ? null : (
            <section className="qc-rs" aria-label="The quote">
              {card}
            </section>
          )
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
