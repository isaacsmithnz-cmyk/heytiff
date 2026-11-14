import { FIT_FLOOR, fitHeight } from "../use-fit-height";

/* A job's fitted tab (Isaac, 14 November 2026: "Only scroll inside the
   cards"; call 11, the cards stop shrinking at 420 high) */
it("fills the scroller from the tab's top, less the page's 16 under it", () => {
  expect(fitHeight(710, 222)).toBe(472);
});

it("never draws the cards under 420 high, so a short window scrolls the page", () => {
  expect(fitHeight(570, 222)).toBe(FIT_FLOOR);
  expect(FIT_FLOOR).toBe(420);
});
