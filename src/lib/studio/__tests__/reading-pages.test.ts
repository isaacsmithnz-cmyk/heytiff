import { firstPlanPage, pagesToSend } from "../reading";

/* A tender set too big to send whole goes from its first floor plan on
   (Isaac, 21 October 2026: 7 Cutler Rd, 25 pages, 16 MB). */

it("starts at the first floor plan chosen, when the set is the first file", () => {
  expect(firstPlanPage({ sources: [{ kind: "pdf" }], chosen: [4, 3] })).toBe(3);
  expect(firstPlanPage({ sources: [{ kind: "image" }, { kind: "pdf" }], chosen: [4] })).toBe(0);
  expect(firstPlanPage({ sources: [{ kind: "pdf" }], chosen: [] })).toBe(0);
  expect(firstPlanPage(null)).toBe(0);
});

it("sends at most forty pages from there, never past the end", () => {
  expect(pagesToSend(25, 3, 40)).toEqual(Array.from({ length: 22 }, (_, i) => i + 3));
  expect(pagesToSend(100, 3, 40)).toHaveLength(40);
  expect(pagesToSend(100, 3, 40)[0]).toBe(3);
  expect(pagesToSend(5, 9, 40)).toEqual([4]);
});
