import type { QuoteLine } from "./lines";

/* WHERE A JOB'S QUOTE STANDS, ON ITS CARD (Isaac, 2026-10-12, retiring the
   old builder: the job card's Quote section, "same card on new code"; and
   "the quoting section should still be accessible. For techs who are
   quoting a job"). Counts and days for everyone on the Workboard, with no
   money in them, so a tech reads them as the office does; the Quote tab's
   landing words them (quote-landing.ts). Pure. */

/** What the card is told: counts and days, never a price. */
export type QuoteFacts = {
  /** the lines on the quote, across its options */
  lines: number;
  options: number;
  /** Tiff's questions still open */
  asked: number;
  /** lines nobody has a price for yet */
  toPrice: number;
  /** her estimates, not yet confirmed */
  toConfirm: number;
  /** the latest change to a line: a timestamp */
  changedAt: string | null;
  /** Tiff has been talked to about it */
  talked: boolean;
  /** drafted in the old builder, whose answers Tiff reads */
  drafted: boolean;
  approved: boolean;
  /** the version it's at, 1 until an approved one is kept */
  version: number;
  sent: { at: string; trial: boolean } | null;
  accepted: number[];
};

/** The lines nobody has a price for yet: to price, on the card as on the
    quote. Her open questions are counted apart, as the phone counts them. */
export const unpricedOf = (lines: readonly Pick<QuoteLine, "source" | "costCents" | "sellCents">[]) =>
  lines.filter((l) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null).length;

/** Her estimates still on the quote, each to confirm. */
export const estimatesOf = (lines: readonly Pick<QuoteLine, "estimate">[]) => lines.filter((l) => l.estimate).length;

/** Anything to continue: lines, a talk with Tiff, or an old draft. */
export const quoteStarted = (f: Pick<QuoteFacts, "lines" | "talked" | "drafted">) => f.lines > 0 || f.talked || f.drafted;
