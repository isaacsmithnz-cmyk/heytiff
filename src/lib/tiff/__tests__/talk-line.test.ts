/* The line over a talk in the chat it was written into: when it began, and
   how long it ran, rounded up to the minute and never under one. */

import { talkLine, talkLines } from "../talk-line";

const clock = (ms: number) => `t${ms}`;

describe("talkLine", () => {
  it("rounds up to the minute and never says under one", () => {
    expect(talkLine(0, 5_000, clock)).toBe("Talk, t0, 1 min");
    expect(talkLine(0, 60_001, clock)).toBe("Talk, t0, 2 min");
    expect(talkLine(1000, 1000, clock)).toBe("Talk, t1000, 1 min");
  });
});

describe("talkLines", () => {
  it("draws a line over the first turn of each talk only, with the talk's whole length", () => {
    const msgs = [
      { at: 10 },
      { at: 1_000, talk: 900 },
      { at: 95_000, talk: 900 },
      { at: 100_000 },
      { at: 200_000, talk: 199_000 },
    ];
    expect(talkLines(msgs, clock)).toEqual([null, "Talk, t900, 2 min", null, null, "Talk, t199000, 1 min"]);
  });
});
