"use client";

import { useEffect, useState } from "react";
import { stillToPrice } from "@/lib/quotes/lines-price";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import type { PriceState, QuoteStep, StepKey } from "@/lib/quotes/quote-steps";

/* THE QUOTE PAGE'S OWN PARTS (Isaac, 2026-10-06, the mock-up he called
   "much cleaner"): the progress line where Home has "Your day", and the
   price, read afresh for each version of the quote. Only to someone with
   money access: the route says no to anyone else, and then nothing shows. */

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
  /* only the last thing marked by hand can be taken back; once accepted,
     that's the option's own Accepted, on the Proposal */
  const accepted = steps.some((s) => s.key === "accepted" && s.state === "done");
  const undoable = accepted ? undefined : [...steps].reverse().find((s) => s.state === "done" && (s.key === "approved" || s.key === "sent"))?.key;
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
