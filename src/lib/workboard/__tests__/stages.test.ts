/* The pipeline and the seed. The stage ORDER is load-bearing (the stepper and
   "how far along" comparisons index into it), and the Handover section is the
   reason the feature exists — so both are pinned, not assumed. */

import {
  checklistProgress,
  DEFAULT_CHECKLIST,
  isProjectStage,
  isProjectStatus,
  nextStage,
  PROJECT_STAGES,
  SECTION_STAGES,
  stageAdvice,
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
    expect(isProjectStatus("blocked")).toBe(true); // first-class (P4)
    expect(isProjectStatus("paused")).toBe(false);
  });
});

describe("stage advance — manual, checklist-aware (P5)", () => {
  /** The seed, part-ticked: a helper so each case reads as a story. */
  const items = (doneSections: string[], extra: { section: string; done: boolean }[] = []) =>
    DEFAULT_CHECKLIST.map((i) => ({
      section: i.section,
      done: doneSections.includes(i.section),
    })).concat(extra);

  it("every mapped section's stages exist and cover the working pipeline", () => {
    for (const m of SECTION_STAGES) {
      for (const s of m.stages) expect(isProjectStage(s)).toBe(true);
      expect(DEFAULT_CHECKLIST.some((i) => i.section === m.section)).toBe(true);
    }
  });

  it("a completed section nudges out of its LAST stage only", () => {
    const ready = items(["Approval & prep"]);
    expect(stageAdvice("Pre-install", ready).nudge).toBe(true);
    // Quote and Approved share the section but a full section says nothing there
    expect(stageAdvice("Quote", ready).nudge).toBe(false);
    expect(stageAdvice("Approved", ready).nudge).toBe(false);
    // Rough-in has no section voice of its own — Fit-off closes "On the tools"
    expect(stageAdvice("Rough-in", items(["On the tools"])).nudge).toBe(false);
    expect(stageAdvice("Fit-off", items(["On the tools"])).nudge).toBe(true);
  });

  it("an incomplete section never nudges, and its counts are honest", () => {
    const advice = stageAdvice("Pre-install", items([]));
    expect(advice.nudge).toBe(false);
    expect(advice.gateSection).toBe("Approval & prep");
    expect(advice.sectionDone).toBe(0);
    expect(advice.sectionTotal).toBe(4);
  });

  it("leftBehind counts unticked items in every section owed by this stage", () => {
    // Leaving Fit-off owes Approval & prep (4) AND On the tools (4).
    expect(stageAdvice("Fit-off", items([])).leftBehind).toBe(8);
    expect(stageAdvice("Fit-off", items(["Approval & prep"])).leftBehind).toBe(4);
    // Leaving Rough-in owes only Approval & prep — the tools aren't done mid-stretch.
    expect(stageAdvice("Rough-in", items([])).leftBehind).toBe(4);
  });

  it("custom sections someone added never gate anything", () => {
    const withCustom = items(["Approval & prep"], [{ section: "Client extras", done: false }]);
    const advice = stageAdvice("Pre-install", withCustom);
    expect(advice.nudge).toBe(true);
    expect(advice.leftBehind).toBe(0);
  });

  it("Complete is terminal; unknown stages advise nothing", () => {
    expect(nextStage("Complete")).toBeNull();
    expect(nextStage("Handover")).toBe("Complete");
    const advice = stageAdvice("Complete", items([]));
    expect(advice.next).toBeNull();
    expect(advice.nudge).toBe(false);
    expect(stageAdvice("Nonsense", items([])).leftBehind).toBe(0);
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
