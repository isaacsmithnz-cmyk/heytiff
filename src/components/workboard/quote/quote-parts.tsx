"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import { unsetWords } from "@/lib/quotes/build-settings";
import { stillToPrice, type LabourFrom } from "@/lib/quotes/job-price";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import type { PriceState, QuoteStep, StepKey } from "@/lib/quotes/quote-steps";

/* THE QUOTE PAGE'S OWN PARTS (Isaac, 2026-10-06, the mock-up he called
   "much cleaner"): the progress line where Home has "Your day", what each
   option is made of down the page, and its price at the top of the list on
   the right. Each option's own materials and labour at the business's own
   prices, markups and day (Isaac, 2026-10-05: "two quotes on one page").

   A total is the quote's only when nothing is left to price; until then it
   is a total so far (Isaac's walk, 2026-10-05). Labour nothing gives is
   still to price, never a $0 line, and a quote with nothing to price shows
   no figures at all. Only to someone with money access: the route says no
   to anyone else, and then nothing shows. */

const ROUTE = "/api/workboard/quote-price";

type Answer = { ok: true; price: QuotePrice } | { ok: false; reason: string };

/** The quote priced, read again whenever its version changes, the last
    price kept on screen meanwhile so the page never blanks. `undefined`:
    not asked for, or not read yet; null: the route said no. */
export function useQuotePrice(job: string, enabled: boolean, version: string | null): QuotePrice | null | undefined {
  const [read, setRead] = useState<{ at: string | null; price: QuotePrice | null } | null>(null);
  useEffect(() => {
    if (!enabled || !version || (read && read.at === version)) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setRead({ at: version, price: a.ok ? a.price : null }))
      .catch(() => live && setRead({ at: version, price: null }));
    return () => {
      live = false;
    };
  }, [job, enabled, version, read]);
  return enabled ? read?.price : undefined;
}

/** What's left to price on an option: its unpriced lines, and its labour
    when nothing gives it. */
export const leftOn = (o: OptionPrice) => stillToPrice({ unpriced: o.unpriced, labourFrom: o.labourFrom, labourCents: o.build.labour.sellCents });

/** The price as the progress line needs it. */
export function priceState(price: QuotePrice | null | undefined): PriceState {
  if (!price) return { kind: "hidden" };
  if (!price.ok) return { kind: "unset" };
  const anything = price.options.some((o) => o.rows > 0 || o.build.labour.sellCents > 0);
  if (!anything) return { kind: "empty" };
  return { kind: "priced", left: price.options.reduce((n, o) => n + leftOn(o).length, 0) };
}

/* ── the progress line ── */

export function QuoteStepsLine({ steps, onUndo }: { steps: QuoteStep[]; onUndo?: (key: StepKey) => void }) {
  /* only the last thing marked by hand can be taken back */
  const undoable = [...steps].reverse().find((s) => s.state === "done" && (s.key === "approved" || s.key === "sent"))?.key;
  return (
    <ol className="qp-steps" aria-label="Where the quote is">
      {steps.map((s) => (
        <li key={s.key} className={s.state === "todo" ? undefined : s.state} aria-current={s.state === "next" ? "step" : undefined}>
          <i aria-hidden="true" />
          <b>{s.label}</b>
          <span>
            {s.words}
            {onUndo && s.key === undoable && (
              <button type="button" className="qp-undo" aria-label={`Undo ${s.label.toLowerCase()}`} onClick={() => onUndo(s.key)}>
                Undo
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── what an option is made of ── */

const qtyWords = (n: number) => String(Math.round(n * 100) / 100);
const LABOUR_FROM: Record<LabourFrom, string> = {
  brief: "from the brief",
  tiff: "Tiff's suggestion",
  typical: "your typical",
  you: "set on the quote",
  none: "",
};
const daysWords = (d: number) => `${Math.round(d * 100) / 100} person-day${d === 1 ? "" : "s"}`;

/** One option's lines, by group, with what's still to price under them. */
export function PriceLines({ option }: { option: OptionPrice }) {
  const { build, labourFrom } = option;
  const left = leftOn(option);
  const labourPriced = build.labour.sellCents > 0 && labourFrom !== "none";
  if (option.rows === 0 && !labourPriced) return <p className="qp-none">Nothing to price yet: the option puts in no units, and nothing gives its labour.</p>;
  return (
    <table className="qp-bu">
      <tbody>
        {build.groups.map((g) => [
          <tr className="qp-gr" key={`g-${g.name}`}>
            <td>{g.name}</td>
            <td className="q">{g.lines.length === 1 ? "1 line" : `${g.lines.length} lines`}</td>
            <td className="a">{fmtAud(g.sellCents)}</td>
          </tr>,
          ...g.lines.map((l) => (
            <tr className="qp-li" key={l.key}>
              <td>
                {l.name}
                {/* a unit says who it's from (a system's indoor and outdoor come
                    from one supplier) and what its order code gives it */}
                <small>
                  {[`${qtyWords(l.qty)} at ${fmtAud(Math.round(l.unitBuyCents))} buy`, l.supplierName ? `from ${l.supplierName}` : null, ...(l.features ?? []), l.because ?? null]
                    .filter(Boolean)
                    .join(", ")}
                </small>
              </td>
              <td className="q">{qtyWords(l.qty)}</td>
              <td className="a">{fmtAud(l.sellCents)}</td>
            </tr>
          )),
        ])}
        {build.contingency && (
          <tr className="qp-gr">
            <td>
              Duct contingency
              <small>{`On the ductwork and grilles, and ${build.contingency.hours} hrs in labour`}</small>
            </td>
            <td className="q" />
            <td className="a">{fmtAud(build.contingency.sellCents)}</td>
          </tr>
        )}
        {labourPriced && (
          <tr className="qp-gr">
            <td>
              Labour
              <small>{`${daysWords(build.labour.personDays)}, ${LABOUR_FROM[labourFrom]}`}</small>
            </td>
            <td className="q" />
            <td className="a">{fmtAud(build.labour.sellCents)}</td>
          </tr>
        )}
        {left.map((u, i) => (
          <tr className="qp-gr qp-left" key={`u-${i}`}>
            <td>
              {u.name}
              <small>{u.why}</small>
            </td>
            <td className="q">{u.qty}</td>
            <td className="a">Still to price</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── the price, at the top of the list on the right ── */

export function PriceSummary({ price, at, names }: { price: QuotePrice; at: number; names: readonly string[] }) {
  if (!price.ok) {
    return (
      <div className="qp-price">
        <span className="qp-l">Price</span>
        <b className="qp-unset">Not set</b>
        <p className="qp-none">{unsetWords(price.unset)}</p>
        <Link className="pbtn ghost sm" href="/dashboard/admin/quoting">
          Set in Quoting
        </Link>
      </div>
    );
  }
  const o = price.options[at];
  if (!o) return null;
  const b = o.build;
  const left = leftOn(o);
  const labourPriced = b.labour.sellCents > 0 && o.labourFrom !== "none";
  const name = names[at] ?? o.name;
  if (o.rows === 0 && !labourPriced) {
    return (
      <div className="qp-price">
        <span className="qp-l">{name}</span>
        <p className="qp-none">Nothing to price yet</p>
      </div>
    );
  }
  const soFar = left.length > 0 ? ", so far" : "";
  const units = b.groups.filter((g) => g.name === "Units").reduce((n, g) => n + g.sellCents, 0);
  const materials = b.groups.filter((g) => g.name !== "Units").reduce((n, g) => n + g.sellCents, 0) + (b.contingency?.sellCents ?? 0);
  return (
    <div className="qp-price">
      <span className="qp-l">{`${name}, ex GST${soFar}`}</span>
      <b className="qp-big">{fmtAud(b.exGstCents)}</b>
      <span className="qp-l">{`${fmtAud(b.incGstCents)} inc GST${soFar}`}</span>
      <dl className="qp-kv">
        {/* a $0 line reads as a price (Isaac's walk, 2026-10-05): a part
            with nothing in it says nothing */}
        {units > 0 && (
          <div>
            <dt>Units</dt>
            <dd>{fmtAud(units)}</dd>
          </div>
        )}
        {materials > 0 && (
          <div>
            <dt>Materials</dt>
            <dd>{fmtAud(materials)}</dd>
          </div>
        )}
        <div>
          <dt>{labourPriced ? `Labour, ${Math.round(b.labour.personDays * 100) / 100} person-days` : "Labour"}</dt>
          <dd className={labourPriced ? undefined : "late"}>{labourPriced ? fmtAud(b.labour.sellCents) : "Still to price"}</dd>
        </div>
        <div className="q">
          <dt>Parts cost you</dt>
          <dd>{fmtAud(b.buyCents)}</dd>
        </div>
      </dl>
    </div>
  );
}
