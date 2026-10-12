import { acceptedWords, linesSteps } from "../quote-steps";

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
    expect(due[1]).toMatchObject({ state: "due", words: "2 to confirm" });
    expect(due[2]).toMatchObject({ state: "due", words: "2 to price" });
    const done = linesSteps({ lines: 40, unknown: 0, price: { kind: "priced", left: 0 } });
    expect(done[1]).toMatchObject({ state: "done", words: "None" });
    expect(done[2]).toMatchObject({ state: "done", words: "Every line priced" });
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
  it("says the version it's at from version 2 on (quote-versions.ts)", () => {
    const at = (version: number, approved: boolean) => linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, approved, version })[3];
    expect(at(1, true)).toMatchObject({ key: "approved", state: "done", words: "Approved" });
    expect(at(1, false)).toMatchObject({ state: "todo", words: "" });
    expect(at(2, false)).toMatchObject({ state: "todo", words: "Version 2" });
    expect(at(2, true)).toMatchObject({ state: "done", words: "Version 2 approved" });
  });
});
