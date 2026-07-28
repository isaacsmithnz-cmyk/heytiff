import { readNumberRun, spokenToDigits } from "../spoken-numbers";

describe("readNumberRun", () => {
  it("reads bare units as a digit string", () => {
    // The job-number case: "three three seven" is 337, not 3+3+7.
    expect(readNumberRun(["three", "three", "seven"])).toBe("337");
    expect(readNumberRun(["four", "four", "seven", "one"])).toBe("4471");
  });

  it("reads a structured run as a cardinal value", () => {
    expect(readNumberRun(["thirty", "six"])).toBe("36");
    expect(readNumberRun(["three", "hundred", "and", "thirty", "seven"])).toBe("337");
    expect(readNumberRun(["two", "thousand", "and", "five"])).toBe("2005");
  });

  it("lands the same job number whichever way it was said", () => {
    expect(readNumberRun(["three", "three", "seven"])).toBe(
      readNumberRun(["three", "hundred", "and", "thirty", "seven"]),
    );
  });

  it("keeps a single word as its own value", () => {
    // "ten" must not become "10" by concatenation of a 1 and a 0.
    expect(readNumberRun(["ten"])).toBe("10");
    expect(readNumberRun(["seven"])).toBe("7");
  });

  it("reads oh and o as zero, the way a number is spoken aloud", () => {
    expect(readNumberRun(["four", "oh", "two"])).toBe("402");
    expect(readNumberRun(["three", "o", "three"])).toBe("303");
  });
});

describe("spokenToDigits", () => {
  it("replaces runs in place and leaves everything else alone", () => {
    expect(spokenToDigits("job three three seven is done")).toBe("job 337 is done");
  });

  it("handles a street number followed by a street name", () => {
    expect(spokenToDigits("working at thirty six wyndham street")).toBe(
      "working at 36 wyndham street",
    );
  });

  it("expands double and triple", () => {
    expect(spokenToDigits("job double three seven")).toBe("job 337");
    expect(spokenToDigits("unit triple seven")).toBe("unit 777");
  });

  it("does not swallow a conjunction that was not part of the number", () => {
    // "two and the outdoor unit" — the `and` belongs to the sentence.
    expect(spokenToDigits("ordered two and the outdoor unit is next")).toBe(
      "ordered 2 and the outdoor unit is next",
    );
  });

  it("keeps an `and` that sits inside a spoken number", () => {
    expect(spokenToDigits("job three hundred and thirty seven")).toBe("job 337");
  });

  it("handles several separate numbers in one sentence", () => {
    expect(spokenToDigits("two heads at thirty six wyndham for job three three seven")).toBe(
      "2 heads at 36 wyndham for job 337",
    );
  });

  it("passes text with no numbers through untouched", () => {
    expect(spokenToDigits("condensate line still to run")).toBe("condensate line still to run");
  });

  it("leaves digits already written as digits alone", () => {
    expect(spokenToDigits("job 337 at 36 wyndham street")).toBe("job 337 at 36 wyndham street");
  });
});
