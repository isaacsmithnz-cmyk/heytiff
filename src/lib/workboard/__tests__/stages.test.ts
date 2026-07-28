/* The pipeline and the seed. The stage ORDER is load-bearing (the stepper and
   "how far along" comparisons index into it), and the Handover section is the
   reason the feature exists — so both are pinned, not assumed. */

import {
  checklistProgress,
  DEFAULT_CHECKLIST,
  isProjectStage,
  isProjectStatus,
  PROJECT_STAGES,
} from "../stages";

describe("the stage pipeline", () => {
  it("runs quote to complete in the trade's order", () => {
    expect([...PROJECT_STAGES]).toEqual([
      "Quote",
      "Approved",
      "Pre-install",
      "Rough-in",
      "Fit-off",
      "Commission",
      "Handover",
      "Complete",
    ]);
  });

  it("validates stages and statuses as whitelists, not shapes", () => {
    expect(isProjectStage("Rough-in")).toBe(true);
    expect(isProjectStage("rough-in")).toBe(false); // case matters — it's a pin
    expect(isProjectStage("Defects")).toBe(false);
    expect(isProjectStatus("on_hold")).toBe(true);
    expect(isProjectStatus("paused")).toBe(false);
  });
});

describe("the default checklist", () => {
  it("seeds a Handover section that asks the questions that go missing", () => {
    const handover = DEFAULT_CHECKLIST.filter((i) => i.section === "Handover").map((i) => i.label);
    expect(handover).toEqual(
      expect.arrayContaining([
        "Manuals left with the customer",
        "Customer walkthrough done",
      ])
    );
  });

  it("every seed item has a section and a label", () => {
    for (const item of DEFAULT_CHECKLIST) {
      expect(item.section.trim().length).toBeGreaterThan(0);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("checklistProgress", () => {
  it("counts, and an empty list is 0 — never NaN", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(
      checklistProgress([{ done: true }, { done: true }, { done: false }])
    ).toEqual({ done: 2, total: 3, percent: 67 });
    expect(checklistProgress([{ done: true }])).toEqual({ done: 1, total: 1, percent: 100 });
  });
});
