"use client";

import { useEffect, useState } from "react";
export { leftOn, priceState } from "@/lib/quotes/quote-left";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";

/* THE QUOTE PAGE'S OWN PARTS (Isaac, 2026-10-06, the mock-up he called
   "much cleaner"): the price, read afresh for each version of the quote. Only to someone with
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
