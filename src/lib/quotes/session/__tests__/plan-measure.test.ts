/* Rooms measured off a plan photo against one printed dimension (the 3465
   re-run, 10 November 2026: "There are no room sizes on the plan", so no
   room load), the arithmetic done here, never in her head. */
import { measureAskOf, measurePlan, type MeasureAsk } from "../plan-measure";

const SIZE = { w: 4000, h: 2252 };
/* 3465's plan: the 7440 overall width spans 785 px of the 4000 px photo */
const known = { mm: 7440, what: "the 7440 overall width", from: { x: 0.1, y: 0.1 }, to: { x: 0.1 + 785 / 4000, y: 0.1 } };

it("sizes a room off the picture's own scale, from its corners", () => {
  const ask = measureAskOf({ known, rooms: [{ name: "Bed 1", corners: [{ x: 0.1, y: 0.2 }, { x: 0.15, y: 0.2 }, { x: 0.15, y: 0.3 }, { x: 0.1, y: 0.3 }] }] }) as MeasureAsk;
  const v = measurePlan(SIZE, ask);
  /* 200 × 225.2 px at 9.478 mm a px: 1.9 × 2.1 m */
  expect(v).toEqual({
    scale: "1 px = 9.5 mm on the full-size picture, off the 7440 overall width (785 px)",
    rooms: [{ name: "Bed 1", area_m2: 4, about: "about 1.9 × 2.1 m" }],
    said: "Measured off the plan against the 7440 overall width, as assumed: say so, and ask to confirm the sizes the load rests on.",
  });
});

it("measures an L by its six corners, not its box", () => {
  const L = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.25 }, { x: 0.25, y: 0.25 }, { x: 0.25, y: 0.5 }, { x: 0, y: 0.5 }];
  const v = measurePlan({ w: 1000, h: 1000 }, measureAskOf({ known: { mm: 10000, what: "the 10 m wall", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, rooms: [{ name: "Living", corners: L }] }) as MeasureAsk);
  expect(v).toMatchObject({ rooms: [{ name: "Living", area_m2: 18.8, about: "about 5 × 5 m" }] });
});

it("takes points marked on a part looked at close, as fractions of that part", () => {
  const area = { left: 0.5, top: 0.5, width: 0.5, height: 0.5 };
  const ask = measureAskOf({ known: { mm: 5000, what: "the 5 m wall", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, area }, rooms: [{ name: "Bed 2", area, corners: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] }] }) as MeasureAsk;
  expect(ask.known.from).toEqual({ x: 0.5, y: 0.5 });
  expect(ask.known.to).toEqual({ x: 1, y: 0.5 });
  expect(measurePlan({ w: 1000, h: 1000 }, ask)).toMatchObject({ rooms: [{ area_m2: 6.3, about: "about 2.5 × 2.5 m" }] });
});

it("says what it can't measure by, and a size to check", () => {
  expect(measureAskOf({ rooms: [] })).toEqual({ error: "Give the printed dimension you measure by in mm (known.mm)." });
  expect(measureAskOf({ known: { mm: 7440, from: { x: 0.1 } } })).toMatchObject({ error: expect.stringContaining("two ends") });
  expect(measureAskOf({ known, rooms: [{ name: "Bed", corners: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] })).toEqual({ error: "Mark at least three corners of Bed, each as x and y fractions." });
  expect(measureAskOf({ known, rooms: [] })).toEqual({ error: "Mark the rooms to measure, each by its corners." });
  const short = measureAskOf({ known: { ...known, to: { x: 0.12, y: 0.1 } }, rooms: [{ name: "Bed", corners: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }] }] }) as MeasureAsk;
  expect(measurePlan(SIZE, short)).toMatchObject({ error: expect.stringContaining("too close together") });
  const tiny = measureAskOf({ known, rooms: [{ name: "Cupboard", corners: [{ x: 0.1, y: 0.1 }, { x: 0.11, y: 0.1 }, { x: 0.11, y: 0.11 }, { x: 0.1, y: 0.11 }] }] }) as MeasureAsk;
  expect(measurePlan(SIZE, tiny)).toMatchObject({ rooms: [{ check: expect.stringContaining("small for a room") }] });
});
