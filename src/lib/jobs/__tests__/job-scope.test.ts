import { SCOPE_SCHEMA, scopeOf, scopePrompt, scopeWanted } from "../job-scope";

/* A job's scope, as Tiff's written brief (Isaac, 28 October 2026: "a common
   point where a quote can get built from"): what she's handed, and how her
   answer is read back. */

const brief = {
  lede: "Four systems for the Carney Residence, from Anna Vaughan Architects' tender set.",
  systems: [
    { area: "Ground floor", kind: "ducted, under the floor", text: "Living/Dining, Kids Play and Guest Bed.", from: ["A200", "A202", ""] },
    { area: "", kind: "", text: "", from: [] },
  ],
  added: [{ text: "Exhaust fans in the three bathrooms", from: "The builder's call, 28 Oct" }, { text: " ", from: "x" }],
  notOurs: ["Solar panels off and back on", 7],
  clarify: [{ q: "Who removes the old units?", who: "Builder" }],
  updates: [{ on: "Wed 28 Oct", from: "Isaac Smith's note", said: "Added the exhaust fans." }],
};

describe("reading Tiff's brief back", () => {
  it("keeps what she wrote and drops what's empty", () => {
    expect(scopeOf(brief)).toEqual({
      lede: brief.lede,
      systems: [{ area: "Ground floor", kind: "ducted, under the floor", text: "Living/Dining, Kids Play and Guest Bed.", from: ["A200", "A202"] }],
      added: [{ text: "Exhaust fans in the three bathrooms", from: "The builder's call, 28 Oct" }],
      notOurs: ["Solar panels off and back on"],
      clarify: [{ q: "Who removes the old units?", who: "Builder" }],
      updates: [{ on: "Wed 28 Oct", from: "Isaac Smith's note", said: "Added the exhaust fans." }],
    });
  });

  it("is no scope at all when she wrote nothing, or something that isn't one", () => {
    expect(scopeOf({ lede: "", systems: [], added: [], notOurs: [], clarify: [], updates: [] })).toBeNull();
    expect(scopeOf(null)).toBeNull();
    expect(scopeOf("a paragraph")).toBeNull();
  });

  it("keeps at most four latest updates and squeezes the spaces out", () => {
    const updates = Array.from({ length: 6 }, (_, i) => ({ on: `${i}`, from: "x", said: `  said\n ${i} ` }));
    const read = scopeOf({ ...brief, updates })!;
    expect(read.updates.map((u) => u.said)).toEqual(["said 0", "said 1", "said 2", "said 3"]);
  });
});

describe("what Tiff is handed", () => {
  it("is the job's own words and its record, newest first", () => {
    const p = scopePrompt({
      status: "Quote",
      clientName: "Tandem Projects",
      scope: "Fw: Quote 6 Bishops avenue, Randwick",
      workDone: null,
      lines: ['2026-10-28 14:40 — note by Isaac Smith: "Builder rang"', "2026-10-08 — 1 document added"],
    });
    expect(p).toContain("Client: Tandem Projects");
    expect(p).toContain("The job, in the office's own words:\nFw: Quote 6 Bishops avenue, Randwick");
    expect(p).toContain('newest first:\n2026-10-28 14:40 — note by Isaac Smith: "Builder rang"\n2026-10-08');
    expect(p).not.toContain("invoice description");
  });

  it("asks for no nullable field, so the schema stays within what structured outputs take", () => {
    expect(JSON.stringify(SCOPE_SCHEMA)).not.toContain("null");
  });
});

describe("whose jobs get one", () => {
  it("a job being quoted or worked, and no other", () => {
    expect(scopeWanted("Quote")).toBe(true);
    expect(scopeWanted(" work order ")).toBe(true);
    expect(scopeWanted("Completed")).toBe(false);
    expect(scopeWanted("Unsuccessful")).toBe(false);
    expect(scopeWanted(null)).toBe(false);
  });
});
