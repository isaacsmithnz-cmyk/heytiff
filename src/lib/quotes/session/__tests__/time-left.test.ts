import { buildingFirst, isFirstBuild, isFirstTurn, leftInWords, stepOf, stillToGo, timeLeft, tookOf, turnStartOf, turnTimes } from "../time-left";

const ev = (turnId: string | null, kind: string, name?: string, at = "2026-11-01T00:00:00.000Z") => ({ turnId, kind, body: name ? { name } : {}, at });
const done = [ev("t1", "message"), ev("t1", "tool", "add_lines"), ev("t1", "usage")];

describe("leftInWords", () => {
  it.each([
    [100, "about 1 min 40 left"],
    [95, "about 1 min 40 left"],
    [60, "about 1 min left"],
    [51, "about 1 min left"],
    [50, "about 50 sec left"],
    [11, "about 20 sec left"],
    [10, "about 10 sec left"],
    [9, "Almost done"],
    [0, "Taking longer than usual"],
    [-40, "Taking longer than usual"],
  ])("%d s", (s, words) => expect(leftInWords(s)).toBe(words));
});

describe("timeLeft", () => {
  it("runs a first turn against 100 s", () => {
    expect(timeLeft(0, true)).toEqual({ percent: 0, words: "about 1 min 40 left" });
    expect(timeLeft(50, true)).toEqual({ percent: 50, words: "about 50 sec left" });
  });
  it("holds the bar short of the end past the usual time", () => {
    expect(timeLeft(400, true)).toEqual({ percent: 95, words: "Taking longer than usual" });
  });
  it("shows no bar for the first seconds of a change, a quick answer being over by then", () => {
    expect(timeLeft(4, false)).toBeNull();
    expect(timeLeft(5, false)?.words).toBe("about 30 sec left");
  });
  it("never runs backwards on a clock a little behind the server's", () => {
    expect(timeLeft(-3, true)?.percent).toBe(0);
  });
});

describe("the turn under way", () => {
  it("starts at its first event", () => {
    expect(turnStartOf([...done, ev("t2", "message", undefined, "2026-11-01T00:10:00.000Z"), ev("t2", "tool", "read_quote", "2026-11-01T00:10:09.000Z")])).toBe(Date.parse("2026-11-01T00:10:00.000Z"));
  });
  it("has no start while the send's first event isn't back, or with a time it can't read", () => {
    expect(turnStartOf(done)).toBeNull();
    expect(turnStartOf([])).toBeNull();
    expect(turnStartOf([ev("t1", "message", undefined, "")])).toBeNull();
  });
  it("ignores a tapped answer, which belongs to no turn", () => {
    expect(turnStartOf([...done, ev(null, "message")])).toBeNull();
  });
  it("is the first until a turn has finished", () => {
    expect(isFirstTurn([])).toBe(true);
    expect(isFirstTurn([ev("t1", "message")])).toBe(true);
    expect(isFirstTurn(done)).toBe(false);
  });
});

describe("stepOf", () => {
  it("says what her last tool of this turn was doing", () => {
    expect(stepOf([ev("t1", "message"), ev("t1", "tool", "read_quote"), ev("t1", "tool", "search_book")])).toBe("Pricing the parts");
    expect(stepOf([ev("t1", "message"), ev("t1", "tool", "write_proposal"), ev("t1", "reply")])).toBe("Writing the proposal");
  });
  it("keeps the last step through a tool that doesn't say one", () => {
    expect(stepOf([ev("t1", "tool", "plan_parts"), ev("t1", "tool", "ask")])).toBe("Choosing the parts");
  });
  it("has none before her first tool, or from a turn that has finished", () => {
    expect(stepOf([ev("t1", "message")])).toBeNull();
    expect(stepOf(done)).toBeNull();
  });
});

/* Isaac, 13 November 2026: "is there a way to show the estimated time
   remaining accurately?" — every turn after the first was taken as 35 s */
describe("time left from how long this business's turns took", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 2, 44, 0) + s * 1000).toISOString();
  const e = (turnId: string | null, kind: string, body: Record<string, unknown>, s: number) => ({ turnId, kind, body, at: at(s) });
  // the later turns of 30 days, sorted: most quick, a few long
  const later = [9, 10, 11, 12, 14, 18, 20, 24, 30, 36, 60, 90];

  it("says what the turns that ran this long still took, so a long one stretches", () => {
    expect(stillToGo(later, 0)).toBe(19);
    expect(timeLeft(6, false, later)).toEqual({ percent: (6 / (6 + 13)) * 100, words: "about 20 sec left" });
    // 40 s in, only the long ones are left: about 35 s more, not "taking longer than usual"
    expect(timeLeft(40, false, later)!.words).toBe("about 40 sec left");
    // past the longest: it says so, held short of the end
    expect(timeLeft(95, false, later)).toEqual({ percent: 95, words: "Taking longer than usual" });
    // too few turns of its own: the usual times
    expect(timeLeft(6, false, [12, 14])).toEqual(timeLeft(6, false));
  });

  it("keeps first builds apart, Read the job and the thread's first turn", () => {
    const thread = [e("t1", "message", { text: "Quote this job" }, 0), e("t1", "usage", {}, 86), e("t2", "message", { text: "15" }, 300), e("t2", "usage", {}, 311), e("t3", "message", { text: "Read the job", read: true }, 400), e("t3", "usage", {}, 480)];
    expect(turnTimes(thread)).toEqual([
      { first: true, seconds: 86 },
      { first: false, seconds: 11 },
      { first: true, seconds: 80 },
    ]);
    expect(isFirstBuild(thread, "t2")).toBe(false);
    expect(buildingFirst([...thread, e("t4", "message", { text: "Add a head" }, 600)])).toBe(false);
    expect(tookOf(turnTimes(thread))).toEqual({ first: [80, 86], later: [11] });
  });
});
