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

/* The same number, spoken in the other languages on site. Every one of these
   used to pass through as words and match no job at all. */

describe("spokenToDigits in the other languages", () => {
  it("reads a job number digit by digit, the way one is always said", () => {
    expect(spokenToDigits("công việc ba ba bảy")).toBe("công việc 337");
    expect(spokenToDigits("trabajo tres tres siete")).toBe("trabajo 337");
  });

  it("reads a street number as a cardinal", () => {
    expect(spokenToDigits("treinta y seis calle wyndham")).toBe("36 calle wyndham");
    expect(spokenToDigits("ba mươi sáu wyndham")).toBe("36 wyndham");
  });

  it("multiplies the digit in hand, not the running total", () => {
    /* Vietnamese and Chinese build their tens as "two ten", and the first
       version of the accumulator read this as 1030. */
    expect(spokenToDigits("một trăm ba mươi bảy")).toBe("137");
    expect(spokenToDigits("mười sáu")).toBe("16");
    expect(spokenToDigits("ciento treinta y siete")).toBe("137");
  });

  it("reads Han numerals, which splitting on spaces would never find", () => {
    expect(spokenToDigits("三三七")).toBe("337");
    expect(spokenToDigits("三十六号")).toBe("36号");
    expect(spokenToDigits("一百三十七")).toBe("137");
  });

  it("leaves a lone Han numeral alone, because it is usually a word", () => {
    // 一起 is "together" and 十分 is "very" — neither is a number
    expect(spokenToDigits("一起检查")).toBe("一起检查");
    expect(spokenToDigits("十分好")).toBe("十分好");
  });

  it("normalises Arabic digits and reads Arabic number words", () => {
    expect(spokenToDigits("رقم ٣٣٧")).toBe("رقم 337");
    // the "and" of "six and thirty" is a prefix on the next word
    expect(spokenToDigits("ستة وثلاثون")).toBe("36");
  });

  it("a word that is a number somewhere else is still a word on its own", () => {
    /* THE TRAP one merged table brings: "once" is eleven in Spanish, "lima"
       is five in Tagalog, "ba" is three in Vietnamese. */
    expect(spokenToDigits("once the unit is off")).toBe("once the unit is off");
    expect(spokenToDigits("lima street")).toBe("lima street");
    // inside a run of numbers they are digits again
    expect(spokenToDigits("lima anim pito")).toBe("567");
  });

  it("Tagalog contracts its `and` onto the tens word", () => {
    expect(spokenToDigits("tatlumpu't anim")).toBe("36");
    // and the same two letters in English are not a number at all
    expect(spokenToDigits("don't forget the belts")).toBe("don't forget the belts");
  });
});
