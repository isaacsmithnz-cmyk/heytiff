import { stillToPrice } from "./lines-price";
import type { OptionPrice, QuotePrice } from "./quote-price-server";
import type { PriceState } from "./quote-steps";

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
