/* A manual's drawings in words (lib/tiff/drawings): which pages are read,
   and every answer seated back on its own page. Drawn on the PUMY-SP80-140
   install manual's page 4 (Fig. 2-1), whose text layer said only
   "(mm) Fig. 2-1 370 1050 225 600 981 330+25" (Isaac, 29 October 2026). */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { drawingHeading, isDrawingCandidate, seatDrawings } from "@/lib/tiff/drawings";
import { pagesToRead } from "@/lib/tiff/drawings-run";

test("a page with a figure, a drawing's words or a run of bare numbers is read", () => {
  expect(isDrawingCandidate("Table 3 Connectable Branch box quantities (mm) Fig. 2-1 370 1050 225 600 981 330+25")).toBe(true);
  expect(isDrawingCandidate("370 1050 225 600 981")).toBe(true);
  expect(isDrawingCandidate("<Foundation specifications> Foundation bolt M10")).toBe(true);
  expect(isDrawingCandidate("Minimum installation space and clearances")).toBe(true);
  /* safety text, a sentence with a number or two: not a drawing */
  expect(isDrawingCandidate("Warning: the unit must not be installed by the user. Use 2 people to lift it.")).toBe(false);
  expect(isDrawingCandidate("Use pipes 0.8 mm thick for 9.52 and 15.88 lines.")).toBe(false);
});

test("pages already described are never read again, and a run is capped", () => {
  const texts = ["cover", "Fig. 1", "safety", "Fig. 2-1 370 1050 225 600 981", "dimensions"];
  expect(pagesToRead(texts, new Set())).toEqual([2, 4, 5]);
  expect(pagesToRead(texts, new Set([4]))).toEqual([2, 5]);
  expect(pagesToRead(texts, new Set(), 2)).toEqual([2, 4]);
});

test("every answer lands on its own page; empty pages and failed groups store nothing", () => {
  expect(
    seatDrawings(
      [[4, 6], [9]],
      [{ ok: true, texts: ["Fig. 2-1: the feet are 600 mm apart.", ""] }, { ok: false, error: "x" }],
    ),
  ).toEqual([{ page: 4, text: "Fig. 2-1: the feet are 600 mm apart." }]);
  expect(drawingHeading(4)).toBe("Drawing, page 4");
});
