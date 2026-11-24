import { quoteStarted, unpricedOf } from "../quote-card";

/* Where a job's quote stands, on its card: whether there's anything to
   continue, and what's still to confirm; never a price. The landing's words
   are quote-landing.test.ts. */

it("is started by lines, a talk with Tiff, or an old draft", () => {
  expect(quoteStarted({ lines: 0, talked: false, drafted: false })).toBe(false);
  expect(quoteStarted({ lines: 1, talked: false, drafted: false })).toBe(true);
  expect(quoteStarted({ lines: 0, talked: true, drafted: false })).toBe(true);
  expect(quoteStarted({ lines: 0, talked: false, drafted: true })).toBe(true);
});

it("counts the lines nobody has a price for yet: her questions, and her estimates, are counted apart", () => {
  const l = (source: string, costCents: number, sellCents: number | null, estimate = false) => ({ source, costCents, sellCents, estimate }) as Parameters<typeof unpricedOf>[0][number];
  expect(unpricedOf([l("unknown", 0, null), l("unknown", 1200, null), l("book", 900, null, true), l("said", 500, null)])).toBe(1);
});
