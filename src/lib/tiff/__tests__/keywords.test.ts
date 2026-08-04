/**
 * @jest-environment node
 *
 * Keyword tagging. The model's output is never trusted — `shapeKeywords` is
 * the layer that turns whatever came back into rows that line up with the
 * chunks they were made from.
 *
 * ALIGNMENT IS THE WHOLE CONTRACT. Row i belongs to chunk i. A short, long or
 * ragged response must still produce exactly as many rows as there were
 * chunks, because a keyword list attached to the wrong chunk sends a search to
 * the wrong page — which is worse than no keywords at all.
 *
 * Nothing here calls the API: the offline branch is exercised through the real
 * function, and the shaping is pure. (House rule: no test mocks the Anthropic
 * SDK; the lib is what gets mocked, one level up.)
 */

import { KEYWORD_MAX_CHARS, MAX_KEYWORDS, shapeKeywords, tagChunks } from "../keywords";

describe("shaping — alignment", () => {
  it("keeps well-formed rows as they are", () => {
    expect(shapeKeywords({ keywords: [["P8", "PUZ-ZM250VKA"], ["TXV"]] }, 2)).toEqual([
      ["P8", "PUZ-ZM250VKA"],
      ["TXV"],
    ]);
  });

  it("pads a short answer rather than shifting rows up", () => {
    expect(shapeKeywords({ keywords: [["P8"]] }, 3)).toEqual([["P8"], [], []]);
  });

  it("drops the tail of a long answer", () => {
    expect(shapeKeywords({ keywords: [["a"], ["b"], ["c"]] }, 2)).toEqual([["a"], ["b"]]);
  });

  it("turns a row that isn't a list into an empty one, in place", () => {
    expect(shapeKeywords({ keywords: [["a"], "P8", null, ["d"]] }, 4)).toEqual([
      ["a"],
      [],
      [],
      ["d"],
    ]);
  });

  it("survives an answer with no keywords field, or no object at all", () => {
    for (const junk of [{}, { keywords: "P8" }, null, undefined, 7, [], "text"]) {
      expect(shapeKeywords(junk, 2)).toEqual([[], []]);
    }
  });

  it("returns nothing when nothing was asked for", () => {
    expect(shapeKeywords({ keywords: [["a"]] }, 0)).toEqual([]);
  });
});

describe("shaping — the terms themselves", () => {
  it("trims, and drops empties and non-strings", () => {
    expect(shapeKeywords({ keywords: [["  P8  ", "", "   ", 42, null, "TXV"]] }, 1)).toEqual([
      ["P8", "TXV"],
    ]);
  });

  it("dedupes case-insensitively, keeping the first spelling", () => {
    expect(shapeKeywords({ keywords: [["PUZ-ZM250", "puz-zm250", "Puz-Zm250"]] }, 1)).toEqual([
      ["PUZ-ZM250"],
    ]);
  });

  it(`caps a row at ${MAX_KEYWORDS} terms`, () => {
    const many = Array.from({ length: 30 }, (_, i) => `term${i}`);
    expect(shapeKeywords({ keywords: [many] }, 1)[0]).toHaveLength(MAX_KEYWORDS);
  });

  /* A keyword is a term, not a sentence — a model that starts explaining
     itself would otherwise write prose into the tsvector's 'A' weight, which
     is the highest-ranked band in the whole index. */
  it("cuts a term to a term's length", () => {
    const essay = "the reversing valve on this unit sticks when the outdoor coil ices over";
    expect(shapeKeywords({ keywords: [[essay]] }, 1)[0][0]).toHaveLength(KEYWORD_MAX_CHARS);
  });
});

describe("without a key", () => {
  const KEY = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = KEY;
  });

  /* Not an error. Ingestion is supposed to keep working with no keywords at
     all — the chunks still match on their own content — so this returns ok
     with empty rows rather than a failure the loop would have to interpret. */
  it("returns aligned empty rows and calls it a success", async () => {
    expect(await tagChunks(["one", "two", "three"])).toEqual({
      ok: true,
      keywords: [[], [], []],
    });
  });

  it("answers an empty batch without going near the API", async () => {
    expect(await tagChunks([])).toEqual({ ok: true, keywords: [] });
  });
});
