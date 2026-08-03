import { fromLines, linesEqual, toLines } from "../note-lines";

describe("notes as bullets", () => {
  it("reads a note written before bullets existed as one bullet", () => {
    expect(toLines("Gate code is 4821, ask for Dave")).toEqual(["Gate code is 4821, ask for Dave"]);
  });

  it("is empty for an empty note, and for no note at all", () => {
    expect(toLines(null)).toEqual([]);
    expect(toLines(undefined)).toEqual([]);
    expect(toLines("")).toEqual([]);
    expect(toLines("   \n\n  ")).toEqual([]);
  });

  it("drops blank lines rather than making blank bullets", () => {
    expect(toLines("first\n\n\nsecond\n")).toEqual(["first", "second"]);
  });

  it("eats markers someone typed or pasted, so a list doesn't grow a second dash", () => {
    expect(toLines("- gate code\n• ask for Dave\n* ladder\n1. roof hatch\n2) alarm code")).toEqual([
      "gate code",
      "ask for Dave",
      "ladder",
      "roof hatch",
      "alarm code",
    ]);
  });

  it("leaves a hyphen that is part of the words alone", () => {
    expect(toLines("re-check the belt tension")).toEqual(["re-check the belt tension"]);
  });

  it("round-trips: what fromLines writes, toLines reads back unchanged", () => {
    const lines = ["gate code is 4821", "ask for Dave at reception"];
    expect(toLines(fromLines(lines))).toEqual(lines);
  });

  it("linesEqual ignores whitespace-only differences, so saving twice is a no-op", () => {
    expect(linesEqual(["a", "b"], ["a ", " b"])).toBe(true);
    expect(linesEqual(["a", "b"], ["a", "b", ""])).toBe(true);
    expect(linesEqual(["a", "b"], ["a", "c"])).toBe(false);
  });
});
