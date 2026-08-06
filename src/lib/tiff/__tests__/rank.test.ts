/* Fusing the two search legs.

   This is where a wrong answer is INVISIBLE: nothing errors, the answer just
   quietly cites the second-best page, or the trace tells the screen a shelf
   was searched when it wasn't. So the arithmetic, the tie-breaking and the
   counting are all pinned here rather than inferred from a green screen. */

import {
  buildTrace,
  capByBudget,
  citationOrder,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_CHUNKS,
  RRF_K,
  rrfMerge,
  type LegRow,
  type TraceDoc,
} from "../rank";

const leg = (...ids: string[]): LegRow[] => ids.map((id) => ({ id, documentId: `d-${id[0]}` }));

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("reciprocal rank fusion", () => {
  it("scores by position, 1-based, in each leg", () => {
    const [first] = rrfMerge(leg("a"), [], 60);
    expect(first.score).toBeCloseTo(1 / 61, 10);
    expect(first.ftsRank).toBe(1);
    expect(first.vecRank).toBeNull();
  });

  /* The whole reason for RRF: a chunk both legs liked beats a chunk one leg
     put first. With k=1, second place in both legs (1/3 + 1/3) outranks a
     single first place (1/2). */
  it("a chunk both legs found beats a chunk only one leg ranked first", () => {
    const merged = rrfMerge(leg("x", "both", "y"), leg("z", "both", "w"), 1);
    expect(merged[0].id).toBe("both");
    expect(merged[0].ftsRank).toBe(2);
    expect(merged[0].vecRank).toBe(2);
  });

  it("interleaves the two legs by fused score", () => {
    // fts: a(1) b(2) c(3) · vec: c(1) d(2) a(3)
    const merged = rrfMerge(leg("a", "b", "c"), leg("c", "d", "a"), 1);
    expect(ids(merged)).toEqual(["a", "c", "b", "d"]);
  });

  it("dedupes by chunk id — one row per chunk, both ranks on it", () => {
    const merged = rrfMerge(leg("a", "b"), leg("b", "a"));
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.id === "b")).toMatchObject({ ftsRank: 2, vecRank: 1 });
  });

  it("keeps the better position when one leg lists a chunk twice", () => {
    const merged = rrfMerge(leg("a", "b", "a"), []);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.id === "a")?.ftsRank).toBe(1);
  });

  /* Ties are the common case, not the exotic one — two chunks found only by
     the keyword leg at adjacent positions differ in the sixth decimal. The
     order must not wobble between runs. */
  it("breaks ties by insertion order, keyword leg first", () => {
    const merged = rrfMerge(leg("k1", "k2"), leg("v1", "v2"));
    expect(ids(merged)).toEqual(["k1", "v1", "k2", "v2"]);
    expect(ids(rrfMerge(leg("k1", "k2"), leg("v1", "v2")))).toEqual(ids(merged));
  });

  it("carries the whole of a leg through when the other is empty", () => {
    expect(ids(rrfMerge(leg("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
    expect(ids(rrfMerge([], leg("a", "b", "c")))).toEqual(["a", "b", "c"]);
  });

  it("both empty is an empty merge, not a throw", () => {
    expect(rrfMerge([], [])).toEqual([]);
  });

  it("drops rows with no id rather than fusing a hole", () => {
    expect(rrfMerge([{ id: "", documentId: "d-1" }, ...leg("a")], [])).toHaveLength(1);
  });

  it("defaults k to the published constant", () => {
    expect(RRF_K).toBe(60);
    expect(rrfMerge(leg("a"), [])[0].score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });
});

describe("the context budget", () => {
  const chunk = (id: string, size: number) => ({ id, content: "x".repeat(size) });

  it("takes everything when it fits", () => {
    const out = capByBudget([chunk("a", 100), chunk("b", 100)]);
    expect(ids(out)).toEqual(["a", "b"]);
  });

  it("stops at the count ceiling", () => {
    const many = Array.from({ length: 30 }, (_, i) => chunk(`c${i}`, 10));
    expect(capByBudget(many)).toHaveLength(MAX_CONTEXT_CHUNKS);
  });

  it("stops at the character ceiling, keeping ranking order", () => {
    const out = capByBudget([chunk("a", 60), chunk("b", 60), chunk("c", 10)], 125);
    expect(ids(out)).toEqual(["a", "b"]);
  });

  /* "The best match was too long to show you" is not an answer, and an empty
     context reads as "nothing in your library covered this" — a lie. */
  it("always keeps the first chunk, even alone over budget", () => {
    const out = capByBudget([chunk("huge", 5_000), chunk("b", 10)], 100);
    expect(ids(out)).toEqual(["huge"]);
  });

  it("has a budget in the ballpark the answer call can afford", () => {
    expect(MAX_CONTEXT_CHARS).toBe(48_000);
    expect(MAX_CONTEXT_CHUNKS).toBe(12);
  });

  it("nothing in, nothing out", () => {
    expect(capByBudget([])).toEqual([]);
  });
});

describe("the trace", () => {
  const docs: Record<string, TraceDoc> = {
    "d-1": { title: "City Multi fault codes", category: "faults" },
    "d-2": { title: "PUZ install manual", category: "install" },
    "d-3": { title: "Second fault book", category: "faults" },
  };
  const c = (id: string, documentId: string) => ({ id, documentId, content: "x" });

  it("counts hits per category across the whole merged set", () => {
    const trace = buildTrace([c("a", "d-1"), c("b", "d-3"), c("e", "d-2")], docs);
    expect(trace.categories.faults.hits).toBe(2);
    expect(trace.categories.install.hits).toBe(1);
    expect(trace.categories.specs.hits).toBe(0);
    expect(trace.categories.sops.hits).toBe(0);
  });

  it("names the best-ranked document per category, and null where there is none", () => {
    const trace = buildTrace([c("a", "d-3"), c("b", "d-1"), c("e", "d-2")], docs);
    expect(trace.categories.faults.topDoc).toBe("Second fault book");
    expect(trace.categories.install.topDoc).toBe("PUZ install manual");
    expect(trace.categories.sops.topDoc).toBeNull();
  });

  /* Two different questions: "did this shelf have anything to say" versus
     "is this shelf in the answer". A category whose only hits fell off the
     budget is reported as searched, not as cited. */
  it("wins are the capped set's categories; hits stay the merged set's", () => {
    const merged = [c("a", "d-2"), c("b", "d-1")];
    const trace = buildTrace(merged, docs, [merged[0]]);
    expect(trace.winners).toEqual(["install"]);
    expect(trace.categories.faults.hits).toBe(1);
  });

  it("orders winners by best rank and lists each once", () => {
    const capped = [c("a", "d-1"), c("b", "d-2"), c("e", "d-3")];
    expect(buildTrace(capped, docs).winners).toEqual(["faults", "install"]);
  });

  it("ignores a chunk whose document went away mid-question", () => {
    const trace = buildTrace([c("a", "gone"), c("b", "d-1")], docs);
    expect(trace.categories.faults.hits).toBe(1);
    expect(trace.winners).toEqual(["faults"]);
  });

  it("an empty search still reports all four shelves at zero", () => {
    const trace = buildTrace([], docs);
    expect(trace.winners).toEqual([]);
    expect(Object.keys(trace.categories).sort()).toEqual(["faults", "field", "install", "sops", "specs"]);
    expect(trace.categories.install).toEqual({ hits: 0, topDoc: null });
  });
});

describe("renumbering into citation order", () => {
  const sources = [{ id: "s0" }, { id: "s1" }, { id: "s2" }];

  it("keeps only what was cited, in the order it was first cited", () => {
    expect(citationOrder(sources, [2, 0])).toEqual([sources[2], sources[0]]);
  });

  it("a source cited twice appears once", () => {
    expect(citationOrder(sources, [1, 1, 0, 1])).toEqual([sources[1], sources[0]]);
  });

  it("an answer that cited nothing leaves no chips behind", () => {
    expect(citationOrder(sources, [])).toEqual([]);
  });

  it("ignores an index that isn't one of ours", () => {
    expect(citationOrder(sources, [9, -1, 1.5, 1])).toEqual([sources[1]]);
  });
});
