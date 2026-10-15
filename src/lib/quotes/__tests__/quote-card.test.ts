import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { quoteCardWords, quoteStarted, toConfirmOf, type QuoteFacts } from "../quote-card";

/* Where a job's quote stands, in a line on its card: the furthest it's got,
   how big it is, and what's still to confirm; never a price. */

const facts = (o: Partial<QuoteFacts> = {}): QuoteFacts => ({
  lines: 6,
  options: 1,
  toConfirm: 0,
  changedAt: "2026-10-10T00:00:00Z",
  talked: true,
  drafted: false,
  approved: false,
  version: 1,
  sent: null,
  accepted: [],
  ...o,
});
const when = (iso: string) => `on ${iso.slice(0, 10)}`;

it("says the furthest the quote has got", () => {
  expect(quoteCardWords(facts(), when)).toBe("Changed on 2026-10-10, 6 lines");
  expect(quoteCardWords(facts({ approved: true }), when)).toBe("Approved, 6 lines");
  expect(quoteCardWords(facts({ approved: true, version: 2 }), when)).toBe("Version 2 approved, 6 lines");
  expect(quoteCardWords(facts({ approved: true, sent: { at: "2026-10-11T00:00:00Z", trial: false } }), when)).toBe("Sent to ServiceM8 on 2026-10-11, 6 lines");
  expect(quoteCardWords(facts({ sent: { at: "2026-10-11T00:00:00Z", trial: true } }), when)).toBe("Trial run to ServiceM8 on 2026-10-11, 6 lines");
  expect(quoteCardWords(facts({ accepted: [0], sent: { at: "2026-10-11T00:00:00Z", trial: false } }), when)).toBe("Option 1 accepted, 6 lines");
});

/* a change or a send is a timestamp: 21:30 UTC on the 12th is 8:30 on
   Tuesday the 13th in Sydney, and the card said Monday all morning */
it("words the day a change or a send was in Australia, not its UTC date", () => {
  const morning = "2026-10-12T21:30:00Z";
  expect(quoteCardWords(facts({ changedAt: morning }), fmtAuWeekdayDayMonth)).toBe("Changed Tue 13 Oct, 6 lines");
  expect(quoteCardWords(facts({ approved: true, sent: { at: morning, trial: false } }), fmtAuWeekdayDayMonth)).toBe("Sent to ServiceM8 Tue 13 Oct, 6 lines");
});

it("counts what's still to confirm until an option is accepted", () => {
  expect(quoteCardWords(facts({ options: 2, lines: 14, toConfirm: 3 }), when)).toBe("Changed on 2026-10-10, 2 options, 14 lines, 3 to confirm");
  expect(quoteCardWords(facts({ toConfirm: 3, accepted: [1] }), when)).toBe("Option 2 accepted, 6 lines");
  expect(quoteCardWords(facts({ lines: 0, options: 0, changedAt: null, toConfirm: 2 }), when)).toBe("Started with Tiff, 2 to confirm");
});

it("is started by lines, a talk with Tiff, or an old draft", () => {
  expect(quoteStarted({ lines: 0, talked: false, drafted: false })).toBe(false);
  expect(quoteStarted({ lines: 1, talked: false, drafted: false })).toBe(true);
  expect(quoteStarted({ lines: 0, talked: true, drafted: false })).toBe(true);
  expect(quoteStarted({ lines: 0, talked: false, drafted: true })).toBe(true);
});

it("confirms a line nobody knows yet, an estimate, and Tiff's questions still open", () => {
  const l = (source: string, costCents: number, sellCents: number | null, estimate = false) => ({ source, costCents, sellCents, estimate }) as Parameters<typeof toConfirmOf>[0][number];
  expect(toConfirmOf([l("unknown", 0, null), l("unknown", 1200, null), l("book", 900, null, true), l("said", 500, null)], 2)).toBe(4);
});
