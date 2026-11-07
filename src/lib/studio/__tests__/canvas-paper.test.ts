import { canvasUnit, PAST_PRINT, pastPrint, PRINT_PX, REF_W } from "../figure-bounds";
import { PLAN_FILL_MM } from "../export";

/* THE CANVAS IS THE PAPER (the next flow): a word's reference pixel on the
   canvas is the sheet's own, the one the PDF draws it at, until the plan is
   past twice its printed size */
describe("words on the canvas at the size they print", () => {
  /* 7 Cutler's ground floor: the A1 sheet's padded width over REF_W */
  const u = 2.92;

  test("at Fit and at print size the canvas uses the sheet's unit, as the PDF does", () => {
    expect(canvasUnit(u, 0.29)).toBe(u);
    expect(canvasUnit(u, PRINT_PX / u)).toBe(u);
    expect(pastPrint(u, 0.29)).toBe(false);
  });

  test("past twice print size the words stop growing on screen", () => {
    const zoom = (PAST_PRINT * PRINT_PX * 3) / u;
    expect(canvasUnit(u, zoom) * zoom).toBeCloseTo(PAST_PRINT * PRINT_PX);
    expect(pastPrint(u, zoom)).toBe(true);
  });

  test("a print pixel is the next flow's A4 landscape box over the reference width, in screen pixels", () => {
    expect(PRINT_PX).toBeCloseTo(PLAN_FILL_MM.A4.landscape.w / REF_W / 0.2646);
  });
});
