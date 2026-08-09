/* Turning a question into a query.

   Two rules carry the whole feature: the query must be OR-joined (an AND of an
   expanded term list matches nothing, and the failure is silent — the answer
   just doesn't cite the page that had it), and a multi-word term must be
   quoted (otherwise "reversing valve" matches a chunk that says "valve" in one
   paragraph and "reversing" in another). Both are pinned below, along with the
   clamps on whatever the model sends back. */

import {
  ftsQueryOf,
  historyLines,
  MAX_QUERY_ATOMS,
  MAX_TERMS,
  PREP_HISTORY_TURNS,
  shapePrep,
  shapeStandalone,
  STANDALONE_MAX_CHARS,
  TERM_MAX_CHARS,
} from "../query-prep";

/* ── the follow-up, put back into words that can be searched ──────────────
   "Can you give me step by step?" is a complete sentence and a useless query:
   its subject is two turns up the conversation. Retrieval searched for
   "step by step", found pages about nothing, and the answer read as if the
   topic had been dropped and restarted (reported live, 2026-08-08). */

describe("the standalone question", () => {
  it("takes the rewrite when the model gives one", () => {
    expect(
      shapeStandalone(
        { standalone: "What is the step-by-step vacuum procedure?" },
        "can you give me step by step?"
      )
    ).toBe("What is the step-by-step vacuum procedure?");
  });

  /* THE ORIGINAL IS ALWAYS THE SAFE ANSWER. Searching for itself is how this
     worked before condensation existed; a broken condenser must never do
     worse than that. */
  it("falls back to the question on anything unusable", () => {
    const asked = "can you give me step by step?";
    expect(shapeStandalone({ standalone: "   " }, asked)).toBe(asked);
    expect(shapeStandalone({ standalone: 42 }, asked)).toBe(asked);
    expect(shapeStandalone({}, asked)).toBe(asked);
    expect(shapeStandalone(null, asked)).toBe(asked);
  });

  it("clamps an essay and flattens the whitespace", () => {
    const long = shapeStandalone({ standalone: "a".repeat(900) }, "q");
    expect(long).toHaveLength(STANDALONE_MAX_CHARS);
    expect(shapeStandalone({ standalone: " what  is\nthe  setting " }, "q")).toBe(
      "what is the setting"
    );
  });
});

describe("the turns the condenser reads", () => {
  it("labels each side and keeps the last few, oldest first", () => {
    const lines = historyLines([
      { role: "user", text: "does it have a vacuum setting?" },
      { role: "assistant", text: "Yes — on the VRV it is under service mode." },
    ]);
    expect(lines).toEqual([
      "Tech: does it have a vacuum setting?",
      "Tiff: Yes — on the VRV it is under service mode.",
    ]);
  });

  it("reads the subject, not the whole transcript", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ role: "user", text: `q${i}` }));
    const lines = historyLines(many);
    expect(lines).toHaveLength(PREP_HISTORY_TURNS);
    // the ones nearest the question, which are the ones carrying its subject
    expect(lines[lines.length - 1]).toBe("Tech: q11");
  });

  it("says nothing about a first question", () => {
    expect(historyLines([])).toEqual([]);
    expect(historyLines([{ role: "user", text: "   " }])).toEqual([]);
  });
});

describe("shaping what the model sends back", () => {
  it("keeps the terms, in order", () => {
    expect(shapePrep({ terms: ["P8", "piping temperature", "thermistor"] })).toEqual([
      "P8",
      "piping temperature",
      "thermistor",
    ]);
  });

  it("caps the list, keeping the most specific first", () => {
    const many = Array.from({ length: 40 }, (_, i) => `term-${i}`);
    const out = shapePrep({ terms: many });
    expect(out).toHaveLength(MAX_TERMS);
    expect(out[0]).toBe("term-0");
  });

  it("trims a term to a term rather than a sentence", () => {
    const [term] = shapePrep({ terms: ["x".repeat(300)] });
    expect(term).toHaveLength(TERM_MAX_CHARS);
  });

  it("collapses whitespace and drops what's left of an empty one", () => {
    expect(shapePrep({ terms: ["  reversing   valve  ", "   ", ""] })).toEqual(["reversing valve"]);
  });

  it("dedupes case-insensitively", () => {
    expect(shapePrep({ terms: ["TXV", "txv", "Txv"] })).toEqual(["TXV"]);
  });

  it.each([
    ["not an object", 7],
    ["no terms key", {}],
    ["terms that aren't an array", { terms: "P8" }],
    ["null", null],
  ])("%s is an empty list, never a throw", (_label, raw) => {
    expect(shapePrep(raw)).toEqual([]);
  });

  it("skips items that aren't strings rather than stringifying them", () => {
    expect(shapePrep({ terms: [1, null, "P8", {}] })).toEqual(["P8"]);
  });
});

describe("composing the query", () => {
  it("OR-joins the terms — recall is the point", () => {
    expect(ftsQueryOf("", ["P8", "thermistor"])).toBe("P8 OR thermistor");
  });

  it("quotes a multi-word term so it stays a phrase", () => {
    expect(ftsQueryOf("", ["reversing valve"])).toBe('"reversing valve"');
  });

  it("carries the question's own distinctive words, after the model's terms", () => {
    expect(ftsQueryOf("Why is the compressor short cycling?", ["P8"])).toBe(
      "P8 OR compressor OR short OR cycling"
    );
  });

  it("drops stop words and the operator words that would change the query's shape", () => {
    expect(ftsQueryOf("what is the and or not of it", [])).toBe("");
  });

  it("keeps a short token that is pure signal", () => {
    // "P8" and "R32" are two characters of meaning; "is" is two of noise
    expect(ftsQueryOf("is it P8 on R32", [])).toBe("P8 OR R32");
  });

  it("keeps a model number whole rather than splitting it", () => {
    expect(ftsQueryOf("PUZ-ZM250VKA wiring", [])).toBe("PUZ-ZM250VKA OR wiring");
  });

  it("dedupes the question against the terms, case-insensitively", () => {
    expect(ftsQueryOf("thermistor fault", ["Thermistor"])).toBe("Thermistor OR fault");
  });

  /* A quote inside a term would close the phrase early and hand
     websearch_to_tsquery a query with a different shape than intended. */
  it("strips quotes out of a term rather than letting it reshape the query", () => {
    expect(ftsQueryOf("", ['say "hello"'])).toBe('"say hello"');
  });

  it("strips a leading minus, which is NOT in websearch syntax", () => {
    expect(ftsQueryOf("", ["-compressor"])).toBe("compressor");
  });

  it("caps the atoms so one long question can't become a hundred-clause query", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    expect(ftsQueryOf(words, []).split(" OR ")).toHaveLength(MAX_QUERY_ATOMS);
  });

  it("is deterministic — same inputs, same string", () => {
    const q = "Mitsubishi U4 in heating";
    const terms = ["U4", "serial communication"];
    expect(ftsQueryOf(q, terms)).toBe(ftsQueryOf(q, terms));
  });

  it("an empty question with no terms is an empty query, not a crash", () => {
    expect(ftsQueryOf("", [])).toBe("");
  });
});
