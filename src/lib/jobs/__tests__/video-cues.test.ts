/* A job video's captions: short lines, broken where a caption breaks, and
   the one under the playhead found. */

import { cueAt, cuesOf, parseVideoWords, wordsRefOf } from "../video-cues";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("cuesOf", () => {
  it("breaks after a sentence, at a pause, and past seven words", () => {
    const cues = cuesOf([
      w("The", 0, 0.2), w("condenser", 0.2, 0.8), w("goes", 0.8, 1), w("here.", 1, 1.3),
      w("Bracket", 1.4, 1.9), w("on", 1.9, 2), w("the", 2, 2.1), w("wall,", 2.1, 2.4),
      w("then", 4, 4.2), w("one", 4.2, 4.4), w("two", 4.4, 4.6), w("three", 4.6, 4.8), w("four", 4.8, 5), w("five", 5, 5.2), w("six", 5.2, 5.4), w("seven", 5.4, 5.6), w("eight", 5.6, 5.8),
    ]);
    expect(cues.map((c) => c.text)).toEqual([
      "The condenser goes here.",
      "Bracket on the wall,",
      "then one two three four five six",
      "seven eight",
    ]);
    expect(cues[0]).toMatchObject({ start: 0, end: 1.3 });
  });

  it("never lets a line run past three and a bit seconds", () => {
    const slow = [w("Coming", 0, 1), w("off", 1.2, 2.2), w("the", 2.4, 3), w("roof", 3.2, 4)];
    expect(cuesOf(slow).map((c) => c.text)).toEqual(["Coming off the", "roof"]);
  });

  it("is nothing for nothing said", () => {
    expect(cuesOf([])).toEqual([]);
  });
});

describe("cueAt", () => {
  const cues = [{ start: 0, end: 1.3, text: "a" }, { start: 2, end: 3, text: "b" }];
  it("finds the line under the playhead, and holds it a moment after", () => {
    expect(cueAt(cues, 0.5)?.text).toBe("a");
    expect(cueAt(cues, 1.5)?.text).toBe("a");
    expect(cueAt(cues, 1.8)).toBeNull();
    expect(cueAt(cues, 2.5)?.text).toBe("b");
  });
});

describe("the words file", () => {
  it("sits beside the video and reads back, or is nothing", () => {
    expect(wordsRefOf("org/o/job_photo/d.mp4")).toBe("org/o/job_photo/d.mp4.words.txt");
    expect(parseVideoWords(JSON.stringify({ v: 1, text: "hi", cues: [{ start: 0, end: 1, text: "hi" }, { nope: 1 }] }))).toEqual({
      v: 1,
      text: "hi",
      cues: [{ start: 0, end: 1, text: "hi" }],
    });
    expect(parseVideoWords("not json")).toBeNull();
    expect(parseVideoWords(JSON.stringify({ v: 2, text: "x", cues: [] }))).toBeNull();
  });
});
