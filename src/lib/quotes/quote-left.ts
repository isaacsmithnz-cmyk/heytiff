import { stillToPrice } from "./lines-price";
import type { OptionPrice, QuotePrice } from "./quote-price-server";
import type { PriceState } from "./quote-steps";

/** What's left to price on an option: its unpriced lines, and its labour
    when nothing gives it. */
export const leftOn = (o: OptionPrice) => stillToPrice({ unpriced: o.unpriced, labourFrom: o.labourFrom, labourCents: o.build.labour.sellCents });

/* WHAT'S LEFT, IN ONE SET OF WORDS (Isaac, 24 November 2026: "fix wording
   and buttons so they match either device"). The web said "2 to settle",
   her questions and the lines nobody had a price for counted together; the
   phone said "1 to answer", then "1 to price". Both say the phone's now,
   here, so they can't drift apart again. */
/** Her questions still open, as the quote's state word. */
export const answerWord = (n: number) => `${n} to answer`;
/** The lines still to price, as the quote's state word. */
export const priceWord = (n: number) => `${n} to price`;

/** Her estimates and the lines nobody knows yet, still to confirm: the web's own, where the phone has no list of them. */
export const confirmWord = (n: number) => `${n} to confirm`;

/** The price as the progress line needs it. */
export function priceState(price: QuotePrice | null | undefined): PriceState {
  if (!price) return { kind: "hidden" };
  if (!price.ok) return { kind: "unset" };
  const anything = price.options.some((o) => o.rows > 0 || o.build.labour.sellCents > 0);
  if (!anything) return { kind: "empty" };
  return { kind: "priced", left: price.options.reduce((n, o) => n + leftOn(o).length, 0) };
}
