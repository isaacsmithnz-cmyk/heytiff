import {
  endsWithCue,
  hasWholeWord,
  hasWord,
  isLooseScript,
  looseWordCount,
  opensClause,
  startsWithCue,
  westernDigits,
} from "../text";

/* The script rules the three gates share. Everything pinned here was a
   silent wrong answer in production before it existed: a Chinese note that
   counted as one word, a Vietnamese cue that matched mid-word because the
   boundary test only knew about ASCII. */

describe("word boundaries in any script", () => {
  it("still refuses the English traps the sieve was built around", () => {
    expect(hasWord("the recorder in the plant room", "order")).toBe(false);
    expect(hasWord("no recall of that data", "call")).toBe(false);
    expect(hasWord("order the grilles", "order")).toBe(true);
  });

  it("treats an accented letter as part of the word, not as a gap", () => {
    /* `[a-z0-9]` read "é" as a boundary, so "sit" matched inside "así té"
       and every cue matched somewhere in Vietnamese. */
    expect(hasWord("necesitamos rejillas", "sita")).toBe(false);
    expect(hasWord("cần thay lọc gió", "cần")).toBe(true);
    expect(hasWord("bảo Luke gọi lại", "gọi")).toBe(true);
  });

  it("matches Chinese and Arabic loosely, because a boundary is a Latin idea", () => {
    expect(isLooseScript("检查")).toBe(true);
    expect(isLooseScript("يجب")).toBe(true);
    expect(isLooseScript("check")).toBe(false);
    // no spaces to anchor to
    expect(hasWord("明天要检查风机", "检查")).toBe(true);
    // Arabic prefixes its conjunction onto the word: و + يجب
    expect(hasWord("ويجب تغيير الفلتر", "يجب")).toBe(true);
  });

  it("the whole-word test keeps a past tense out of the imperatives", () => {
    expect(hasWholeWord("ordered the grilles last week", "order")).toBe(false);
    expect(hasWholeWord("order the grilles", "order")).toBe(true);
  });
});

describe("where a cue sits", () => {
  it("start means start, and the whole text counts", () => {
    expect(startsWithCue("dónde está la unidad", "dónde")).toBe(true);
    expect(startsWithCue("dónde", "dónde")).toBe(true);
    expect(startsWithCue("la unidad dónde está", "dónde")).toBe(false);
  });

  it("end is a real position — Vietnamese and Chinese trail their markers", () => {
    expect(endsWithCue("máy lạnh sửa xong chưa", "chưa")).toBe(true);
    expect(endsWithCue("chưa sửa máy lạnh", "chưa")).toBe(false);
    expect(endsWithCue("空调修好了吗", "吗")).toBe(true);
  });
});

describe("clause openers", () => {
  it("counts start of text, punctuation and a coordinator", () => {
    expect(opensClause("order the grilles", "order")).toBe(true);
    expect(opensClause("gate code changed, order the grilles", "order")).toBe(true);
    expect(opensClause("gate code changed and order the grilles", "order")).toBe(true);
    expect(opensClause("did a check on the belts", "check")).toBe(false);
  });

  it("reads the other languages' coordinators and stops", () => {
    expect(opensClause("cambié el filtro y pide rejillas", "pide")).toBe(true);
    expect(opensClause("thay lọc rồi gọi cho khách", "gọi")).toBe(true);
    // 。 and ，are the only sentence breaks Chinese has
    expect(opensClause("空调不工作了，检查风机", "检查")).toBe(true);
  });
});

describe("counting words without spaces", () => {
  it("counts English exactly as splitting on whitespace did", () => {
    expect(looseWordCount("gate code 4417")).toBe(3);
    expect(looseWordCount("   ")).toBe(0);
    expect(looseWordCount("tell Luke to order the grilles")).toBe(6);
  });

  it("counts a dense script by character, two to the word", () => {
    /* THE BUG THIS EXISTS FOR: the sieve drops out below four words, and
       splitting on whitespace makes this whole sentence one. */
    expect("空调不工作了，明天要检查".split(/\s+/).filter(Boolean).length).toBe(1);
    expect(looseWordCount("空调不工作了，明天要检查")).toBeGreaterThanOrEqual(4);
    // a gate code stays cheap in any script
    expect(looseWordCount("门码 4417")).toBeLessThan(4);
  });
});

describe("digits that arrive in another script", () => {
  it("normalises Arabic-Indic and Persian digits", () => {
    expect(westernDigits("رقم ٣٣٧")).toBe("رقم 337");
    expect(westernDigits("۳۶")).toBe("36");
    expect(westernDigits("job 337")).toBe("job 337");
  });
});
