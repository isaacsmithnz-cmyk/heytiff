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
 * THE PADDING IS ALSO COUNTED. A short answer used to be indistinguishable
 * from a page with nothing searchable on it, which is where the library's
 * untagged chunks came from — so `countKeywordRows` is what the retry and the
 * log both read, and `mergeKeywordRows` is how a retry's rows get combined
 * with the first answer's WITHOUT moving any of them.
 *
 * Nothing here calls the API: the offline branch is exercised through the real
 * function, and the shaping is pure. (House rule: no test mocks the Anthropic
 * SDK; the lib is what gets mocked, one level up.)
 */

import {
  countKeywordRows,
  KEYWORD_MAX_CHARS,
  MAX_KEYWORDS,
  mergeKeywordRows,
  shapeKeywords,
  tagChunks,
} from "../keywords";

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

/* The live shape of the failure: 25 excerpts went out, `{"keywords":[["P8"]]}`
   came back. It is complete, schema-valid JSON, so nothing throws and nothing
   fails to parse — the only thing that can tell it apart from a genuinely
   untaggable batch is the row count. */
describe("counting what the model actually answered", () => {
  it("counts the lists in a short answer, not the rows we asked for", () => {
    expect(countKeywordRows({ keywords: [["P8"]] })).toBe(1);
  });

  it("counts a full answer in full", () => {
    expect(countKeywordRows({ keywords: [["P8"], [], ["TXV"]] })).toBe(3);
  });

  it("does not count a row that isn't a list — that row gets padded too", () => {
    expect(countKeywordRows({ keywords: [["a"], "P8", null, ["d"]] })).toBe(2);
  });

  it("counts nothing in junk", () => {
    for (const junk of [{}, { keywords: "P8" }, null, undefined, 7, [], "text"]) {
      expect(countKeywordRows(junk)).toBe(0);
    }
  });
});

describe("merging a retry into the first answer", () => {
  it("fills the padded rows and leaves the answered ones alone", () => {
    expect(mergeKeywordRows([["P8"], [], []], [["X"], ["TXV"], ["R32"]])).toEqual([
      ["P8"],
      ["TXV"],
      ["R32"],
    ]);
  });

  /* The alignment contract again, one layer up: both calls were asked about
     the same chunks in the same order, so a gap can only ever be filled from
     the row that was about that same chunk. */
  it("fills row i from row i and never from its neighbour", () => {
    expect(mergeKeywordRows([[], ["b"], []], [["A"], ["B"], ["C"]])).toEqual([
      ["A"],
      ["b"],
      ["C"],
    ]);
  });

  it("keeps its length when the retry died half way through", () => {
    expect(mergeKeywordRows([[], [], []], [["A"]])).toEqual([["A"], [], []]);
  });

  it("changes nothing when the retry found nothing", () => {
    expect(mergeKeywordRows([["P8"], []], [[], []])).toEqual([["P8"], []]);
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

  /* The document id is for the log line and nothing else — it must not change
     what comes back, and it must stay optional for the callers that have none. */
  it("takes a document id without it reaching the rows", async () => {
    expect(await tagChunks(["one", "two"], "doc_123")).toEqual({
      ok: true,
      keywords: [[], []],
    });
  });
});
