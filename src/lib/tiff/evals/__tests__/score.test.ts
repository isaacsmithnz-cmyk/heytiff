import { grade, parseCase, type CapturedRun, type EvalCase } from "../score";

const run = (over: Partial<CapturedRun> = {}): CapturedRun => ({ tools: [], moves: [], text: "", ...over });
const c = (expect: EvalCase["expect"], never?: string[]): EvalCase => ({ id: "x", say: "x", expect, never });

describe("grading an eval case", () => {
  it("passes a move to the screen asked for, and fails one to another", () => {
    const moved = run({ moves: [{ href: "/dashboard/workboard", label: "Workboard" }] });
    expect(grade(c({ screen: "Workboard" }), moved).pass).toBe(true);
    expect(grade(c({ screen: "Team" }), moved)).toEqual({
      pass: false,
      reasons: ["wanted a move to Team, got Workboard"],
    });
  });

  it("knows a record move by where it lands", () => {
    const staff = run({ moves: [{ href: "/dashboard/team/s-1", label: "Dane's card" }] });
    expect(grade(c({ record: "staff" }), staff).pass).toBe(true);
    expect(grade(c({ record: "job" }), staff).pass).toBe(false);
    expect(grade(c({ record: "job" }), run({ moves: [{ href: "/dashboard/workboard?job=u1", label: "#1044" }] })).pass).toBe(true);
  });

  it("wants its tools in order, with others allowed between", () => {
    const r = run({ tools: ["search_jobs", "issue_log", "job_history"] });
    expect(grade(c({ tools: ["search_jobs", "job_history"] }), r).pass).toBe(true);
    expect(grade(c({ tools: ["job_history", "search_jobs"] }), r).pass).toBe(false);
  });

  it("an answer is words with no move", () => {
    expect(grade(c({ answers: true }), run({ text: "Lyle has 20." })).pass).toBe(true);
    expect(grade(c({ answers: true }), run({ text: "" })).pass).toBe(false);
    expect(
      grade(c({ answers: true }), run({ text: "Opening.", moves: [{ href: "/dashboard", label: "Home" }] })).pass
    ).toBe(false);
  });

  it("fails a tool it must never call, and an error", () => {
    expect(grade(c({ answers: true }, ["open_screen"]), run({ text: "x", tools: ["open_screen"] })).reasons).toContain(
      "called open_screen, which it must not"
    );
    expect(grade(c({ answers: true }), run({ text: "x", error: "boom" })).pass).toBe(false);
  });
});

describe("reading a case", () => {
  it("refuses a case that expects nothing, since it could never fail", () => {
    expect(() => parseCase({ id: "a", say: "hi", expect: {} }, "a.json")).toThrow("could never fail");
  });

  it("takes a well-formed case", () => {
    expect(parseCase({ id: "a", say: "hi", expect: { answers: true } }, "a.json").id).toBe("a");
  });
});
