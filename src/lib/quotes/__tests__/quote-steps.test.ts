import { acceptedWords, designState, linesSteps, stepPassed } from "../quote-steps";

/* Isaac, 2026-10-06: the progress line where Home has "Your day", and
   "You should still be able to manually approve" */

it("words the options accepted", () => {
  expect(acceptedWords([0])).toBe("Option 1");
  expect(acceptedWords([0, 2])).toBe("Options 1 and 3");
  expect(acceptedWords([0, 1, 2])).toBe("Options 1, 2 and 3");
});

describe("a quote built on its kept lines", () => {
  it("is waiting on its first line", () => {
    expect(linesSteps({ lines: 0, unknown: 0, price: { kind: "empty" } }).map((s) => [s.key, s.state, s.words])).toEqual([
      ["brief", "next", "By hand"],
      ["questions", "todo", ""],
      ["buildup", "next", "No lines yet"],
      ["approved", "todo", ""],
      ["sent", "todo", ""],
      ["accepted", "todo", ""],
    ]);
  });
  it("says what's unknown and what's left to price, then that every line is priced", () => {
    const due = linesSteps({ lines: 40, unknown: 2, price: { kind: "priced", left: 2 } });
    expect(due[1]).toMatchObject({ label: "Scope", state: "due", words: "2 to settle" });
    expect(due[2]).toMatchObject({ label: "Priced", state: "due", words: "2 to price" });
    const done = linesSteps({ lines: 40, unknown: 0, price: { kind: "priced", left: 0 } });
    expect(done[1]).toMatchObject({ state: "done", words: "Settled" });
    expect(done[2]).toMatchObject({ state: "done", words: "All priced" });
  });
  it("asks for Quoting when the business hasn't set what pricing needs", () => {
    expect(linesSteps({ lines: 3, unknown: 0, price: { kind: "unset" } })[2]).toMatchObject({ state: "due", words: "Set Quoting to price it" });
  });
  it("shows the option a person marked accepted", () => {
    expect(linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, accepted: [1] })[5]).toMatchObject({ key: "accepted", state: "done", words: "Option 2" });
  });
  it("shows the quote sent to ServiceM8 as a quote, or only a trial run of it (7.3)", () => {
    const at = (sent: { trial: boolean } | null) => linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, approved: true, sent })[4];
    expect(at(null)).toMatchObject({ key: "sent", state: "todo" });
    expect(at({ trial: false })).toMatchObject({ state: "done", words: "To ServiceM8" });
    expect(at({ trial: true })).toMatchObject({ state: "done", words: "Trial run" });
  });
  /* layout C (Isaac, 18 October): each step done says its day, small in the rail */
  it("names its steps Brief, Scope, Priced, Approved, Sent, Accepted, and dates the approval and the send", () => {
    const steps = linesSteps({
      lines: 3,
      unknown: 0,
      price: { kind: "priced", left: 0 },
      approved: true,
      approvedAt: "2026-10-17T01:00:00Z",
      sent: { trial: false, at: "2026-10-18T02:00:00Z" },
    });
    expect(steps.map((s) => s.label)).toEqual(["Brief", "Scope", "Priced", "Approved", "Sent", "Accepted"]);
    expect(steps[3]).toMatchObject({ state: "done", words: "17 Oct" });
    expect(steps[4]).toMatchObject({ state: "done", words: "18 Oct" });
  });
  it("says the version it's at from version 2 on (quote-versions.ts)", () => {
    const at = (version: number, approved: boolean) => linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, approved, version })[3];
    expect(at(1, true)).toMatchObject({ key: "approved", state: "done", words: "Approved" });
    expect(at(1, false)).toMatchObject({ state: "todo", words: "" });
    expect(at(2, false)).toMatchObject({ state: "todo", words: "Version 2" });
    expect(at(2, true)).toMatchObject({ state: "done", words: "Version 2 approved" });
  });
});

/* Isaac, 28 October 2026: "Brief, Scope, Design (skippable), Priced, with the
   Studio opening from the Design step" */
describe("the Design step", () => {
  const at = (design: "drawn" | "skipped" | "open" | null) => linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, design });
  it("sits between Scope and Priced for someone with the Studio", () => {
    expect(at("open").map((s) => s.label)).toEqual(["Brief", "Scope", "Design", "Priced", "Approved", "Sent", "Accepted"]);
  });
  it("isn't on the line at all without the Studio", () => {
    expect(at(null).map((s) => s.key)).not.toContain("design");
    expect(linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 } }).map((s) => s.key)).not.toContain("design");
  });
  it("is done once the job has a design, still to do with none, and says No design once it's skipped", () => {
    expect(at("drawn")[2]).toMatchObject({ key: "design", label: "Design", state: "done" });
    expect(at("open")[2]).toMatchObject({ key: "design", label: "Design", state: "todo" });
    expect(at("skipped")[2]).toMatchObject({ key: "design", label: "No design", state: "skipped" });
  });
  it("counts a skipped step as passed, and nothing else", () => {
    const [, scope, design, priced] = at("skipped");
    expect([scope, design, priced].map(stepPassed)).toEqual([true, true, true]);
    expect(stepPassed(at("open")[2])).toBe(false);
  });
});

describe("where the job's design is", () => {
  it("is drawn whenever the job has a design, whatever was pressed", () => {
    expect(designState({ designs: 1, noDesign: true, onWithout: true })).toBe("drawn");
  });
  it("is skipped once No design is pressed, or the quote went on without one", () => {
    expect(designState({ designs: 0, noDesign: true, onWithout: false })).toBe("skipped");
    expect(designState({ designs: 0, noDesign: false, onWithout: true })).toBe("skipped");
  });
  it("is still open otherwise", () => {
    expect(designState({ designs: 0, noDesign: false, onWithout: false })).toBe("open");
  });
});

/* 3423, Isaac, 30 October 2026: approved, and the line still sat on Scope in orange */
it("never sits back on Scope once it's approved", () => {
  const steps = linesSteps({ accepted: [], approved: true, sent: null, lines: 11, unknown: 2, price: { kind: "priced", left: 0 }, approvedAt: "2026-10-30T10:50:58.480Z" });
  expect(steps.find((s) => s.key === "questions")).toMatchObject({ state: "done", words: "Settled" });
});
