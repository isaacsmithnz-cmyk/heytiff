import type { QuoteLine } from "./lines";
import { acceptedWords } from "./quote-steps";

/* WHERE A JOB'S QUOTE STANDS, ON ITS CARD (Isaac, 2026-10-12, retiring the
   old builder: the job card's Quote section, "same card on new code"; and
   "the quoting section should still be accessible. For techs who are
   quoting a job"). One line for everyone on the Workboard, with no money in
   it, so a tech reads it as the office does. Pure. */

/** What the card is told: counts and days, never a price. */
export type QuoteFacts = {
  /** the lines on the quote, across its options */
  lines: number;
  options: number;
  /** lines nobody knows yet and Tiff's questions still open */
  toConfirm: number;
  /** the latest change to a line */
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

/** The lines nobody knows yet, and Tiff's questions still open: To confirm,
    on the card as on the quote page's progress line. */
export const toConfirmOf = (lines: readonly Pick<QuoteLine, "source" | "costCents" | "sellCents" | "estimate">[], asked: number) =>
  lines.filter((l) => (l.source === "unknown" && l.costCents <= 0 && l.sellCents == null) || l.estimate).length + asked;

/** Anything to continue: lines, a talk with Tiff, or an old draft. */
export const quoteStarted = (f: Pick<QuoteFacts, "lines" | "talked" | "drafted">) => f.lines > 0 || f.talked || f.drafted;

/** "Changed Mon 12 Oct, 2 options, 14 lines, 3 to confirm". */
export function quoteCardWords(f: QuoteFacts, when: (iso: string) => string): string {
  const where = f.accepted.length
    ? `${acceptedWords(f.accepted)} accepted`
    : f.sent
      ? `${f.sent.trial ? "Trial run to ServiceM8" : "Sent to ServiceM8"} ${when(f.sent.at)}`
      : f.approved
        ? f.version > 1
          ? `Version ${f.version} approved`
          : "Approved"
        : f.lines > 0 && f.changedAt
          ? `Changed ${when(f.changedAt)}`
          : f.talked
            ? "Started with Tiff"
            : f.drafted
              ? "Drafted"
              : "";
  const size = f.lines > 0 ? `${f.options > 1 ? `${f.options} options, ` : ""}${f.lines} ${f.lines === 1 ? "line" : "lines"}` : "";
  const open = !f.accepted.length && f.toConfirm > 0 ? `${f.toConfirm} to confirm` : "";
  return [where, size, open].filter(Boolean).join(", ");
}
