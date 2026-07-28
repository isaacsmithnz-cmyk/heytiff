import {
  findPhrase,
  findSite,
  MATCH_THRESHOLD,
  normalise,
  scoreCase,
  similarity,
  summarise,
  wordErrorRate,
} from "../score";

describe("normalise", () => {
  it("puts both sides in the same shape so formatting is not counted as error", () => {
    expect(normalise("Thirty-six Wyndham Street.")).toBe(normalise("36 wyndham street"));
  });

  it("keeps apostrophes inside words", () => {
    expect(normalise("it didn't run")).toBe("it didn't run");
  });
});

describe("wordErrorRate", () => {
  it("is zero for an identical transcript", () => {
    expect(wordErrorRate("the condensate line is done", "The condensate line is done.")).toBe(0);
  });

  it("is zero when only the number FORMATTING differs", () => {
    // This is the whole reason both sides are normalised: the transcriber
    // writing 337 where the human wrote it out is not a mistake.
    expect(wordErrorRate("job three three seven", "job 337")).toBe(0);
  });

  it("counts a substitution against the reference length", () => {
    expect(wordErrorRate("order the grills", "order the grilles")).toBeCloseTo(1 / 3);
  });

  it("treats invented speech over silence as a total miss", () => {
    expect(wordErrorRate("", "hello")).toBe(1);
    expect(wordErrorRate("", "")).toBe(0);
  });
});

describe("similarity", () => {
  it("scores a near-miss high and an unrelated word low", () => {
    expect(similarity("wyndham", "windham")).toBeGreaterThan(0.8);
    expect(similarity("luke", "bunnings")).toBeLessThan(0.3);
  });

  it("is unforgiving on short words, which is deliberate", () => {
    // "luke" vs "look" is only 0.25 — three of four characters differ. Short
    // names have no redundancy to spare, so a mishearing of one is a genuine
    // miss and the picker should open rather than the harness inventing a hit.
    expect(similarity("luke", "look")).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("findPhrase", () => {
  it("finds a term anywhere in the transcript", () => {
    const m = findPhrase("we still need to run the condensate line", "condensate");
    expect(m.hit).toBe(true);
  });

  it("matches multi-word terms across a window", () => {
    expect(findPhrase("fitted a bosch 5000 upstairs", "bosch 5000").hit).toBe(true);
  });

  it("reports what was heard instead when it misses", () => {
    const m = findPhrase("we went to smith and sons today", "wyndham");
    expect(m.hit).toBe(false);
    expect(m.closest).not.toBe("");
  });

  it("does not invent a match between different words", () => {
    expect(findPhrase("order the grills for mick", "luke").hit).toBe(false);
  });

  it("finds a name through a plausible mishearing only if it is close enough", () => {
    expect(findPhrase("tell mick to order them", "mick").hit).toBe(true);
    expect(findPhrase("tell nick to order them", "mick").hit).toBe(false);
  });
});

describe("findSite", () => {
  it("requires the street number exactly and allows the name to be approximate", () => {
    const [number, street] = findSite("working at 36 windham street today", "36 Wyndham Street");
    expect(number.hit).toBe(true);
    expect(street.hit).toBe(true);
  });

  it("fails a wrong street number even when the name is perfect", () => {
    // 36 and 38 are different houses; fuzzy-matching them is worse than useless.
    const [number] = findSite("working at 38 wyndham street", "36 Wyndham Street");
    expect(number.hit).toBe(false);
  });

  it("matches a spoken street number against digits", () => {
    const [number] = findSite("working at thirty six wyndham street", "36 Wyndham Street");
    expect(number.hit).toBe(true);
  });
});

describe("scoreCase", () => {
  const truth = "at 36 Wyndham Street for job 337, Luke needs to order the grills";

  it("is routable when every hard expectation survives", () => {
    const score = scoreCase("c1", truth, truth, {
      job: "337",
      site: "36 Wyndham Street",
      people: ["Luke"],
      terms: ["grills"],
    });
    expect(score.routable).toBe(true);
    expect(score.wer).toBe(0);
  });

  it("is NOT routable when the site is lost, however good the words were", () => {
    const heard = "at 36 Kingston Street for job 337, Luke needs to order the grills";
    const score = scoreCase("c2", truth, heard, {
      job: "337",
      site: "36 Wyndham Street",
      people: ["Luke"],
    });
    expect(score.routable).toBe(false);
    expect(score.wer).toBeLessThan(0.2); // word-perfect enough to look fine
  });

  it("stays routable when only a trade term is mangled", () => {
    const heard = "at 36 Wyndham Street for job 337, Luke needs to order the girls";
    const score = scoreCase("c3", truth, heard, {
      job: "337",
      site: "36 Wyndham Street",
      people: ["Luke"],
      terms: ["grills"],
    });
    expect(score.routable).toBe(true);
    expect(score.soft.filter((m) => m.hit)).toHaveLength(0);
  });

  it("counts a job number as heard whichever way it was spoken", () => {
    const heard = "at 36 Wyndham Street for job three three seven, Luke needs the grills";
    expect(scoreCase("c4", truth, heard, { job: "337" }).routable).toBe(true);
  });
});

describe("summarise", () => {
  it("counts routable cases and averages the error rate", () => {
    const scores = [
      scoreCase("a", "job 337", "job 337", { job: "337" }),
      scoreCase("b", "job 337", "job 338", { job: "337" }),
    ];
    const s = summarise("run", scores);
    expect(s.cases).toBe(2);
    expect(s.routable).toBe(1);
    // 0 for the clean case, 0.5 for the one wrong token out of two.
    expect(s.meanWer).toBeCloseTo(0.25);
  });
});
