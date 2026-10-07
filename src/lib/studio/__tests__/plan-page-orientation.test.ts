/* A plan page takes whichever way up prints the plan bigger (Isaac,
   2026-10-07: "rotate the design plan landscape if needed"). */

import { planPageOrientation } from "../export";

describe("which way up a plan's page prints", () => {
  it("turns a wide plan's page landscape in a portrait document", () => {
    expect(planPageOrientation({ w: 4048, h: 1952 }, "A4", "portrait")).toBe("landscape");
  });

  it("keeps a tall plan portrait", () => {
    expect(planPageOrientation({ w: 1159, h: 1609 }, "A4", "portrait")).toBe("portrait");
  });

  it("turns a tall plan's page portrait in a landscape document", () => {
    expect(planPageOrientation({ w: 1159, h: 1609 }, "A4", "landscape")).toBe("portrait");
  });

  /* a plan that prints within a tenth of the same size either way: the page
     does not flip for nothing (on A4 that is about 13:10 — a SQUARE plan is
     not it, it prints a quarter bigger portrait) */
  it("leaves a plan that fits about as well either way the way the document is", () => {
    expect(planPageOrientation({ w: 1300, h: 1000 }, "A4", "portrait")).toBe("portrait");
    expect(planPageOrientation({ w: 1300, h: 1000 }, "A4", "landscape")).toBe("landscape");
  });

  it("works for A3 the same way", () => {
    expect(planPageOrientation({ w: 3000, h: 1000 }, "A3", "portrait")).toBe("landscape");
  });

  it("leaves a plan with no extent the way the document is", () => {
    expect(planPageOrientation({ w: 0, h: 500 }, "A4", "portrait")).toBe("portrait");
  });
});
