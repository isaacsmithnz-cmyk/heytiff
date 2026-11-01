import { isFirstTurn, leftInWords, stepOf, timeLeft, turnStartOf } from "../time-left";

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
