import type { StoryEntry } from "@/lib/workboard/job-story";
import { SCOPE_SCHEMA, newlyAdded, priceThemWords, scopeMoved, scopeOf, scopePrompt, scopeStamp, scopeWanted, stillAdded, wordsWithoutMoney } from "../job-scope";

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
      undoSaid: "",
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
  it("a job being quoted or worked, made since the first of October", () => {
    expect(scopeWanted("Quote", "2026-10-01 00:00:00")).toBe(true);
    expect(scopeWanted(" work order ", "2026-10-29")).toBe(true);
    expect(scopeWanted("Quote", "2026-09-30 00:00:00")).toBe(false);
    expect(scopeWanted("Quote", null)).toBe(false);
    expect(scopeWanted("Completed", "2026-10-29")).toBe(false);
    expect(scopeWanted("Unsuccessful", "2026-10-29")).toBe(false);
    expect(scopeWanted(null, "2026-10-29")).toBe(false);
  });
});

describe("what a rewrite is due on", () => {
  const note = (key: string, removed = false) => ({ kind: "note", key, day: "2026-10-28", at: "2026-10-28 14:40:00", text: "x", removed }) as unknown as StoryEntry;
  const booking = { kind: "booking", key: "booking:1", day: "2026-11-04", at: null, start: "2026-11-04 11:30:00", crew: [] } as unknown as StoryEntry;
  const photos = { kind: "photos", key: "photos:1", day: "2026-11-01", at: null, count: 2, shown: [] } as unknown as StoryEntry;

  it("moves on a new note and not on a booking or a photo", () => {
    const stamp = scopeStamp([note("a")]);
    expect(scopeStamp([booking, photos, note("a")])).toBe(stamp);
    expect(scopeStamp([note("b"), note("a")])).not.toBe(stamp);
  });

  it("moves when a note is taken back off the job", () => {
    expect(scopeStamp([note("b", true), note("a")])).toBe(scopeStamp([note("a")]));
    expect(scopeStamp([note("b", true), note("a")])).not.toBe(scopeStamp([note("b"), note("a")]));
  });

  it("still gives a job with no note its first brief, and nothing without a story", () => {
    expect(scopeStamp([booking])).toBe("no-notes");
    expect(scopeStamp([])).toBeNull();
  });
});

describe("whether a rewrite changed anything", () => {
  const base = { lede: "L", systems: [], added: [], notOurs: [], clarify: [], updates: [], undoSaid: "" };
  it("doesn't count its words on the change itself", () => {
    expect(scopeMoved(base, { ...base, undoSaid: "Took it out.", updates: [{ on: "x", from: "y", said: "z" }] })).toBe(false);
    expect(scopeMoved(base, { ...base, added: [{ text: "Exhaust fans", from: "a note" }] })).toBe(true);
  });
});

describe("the brief as it stands", () => {
  const was = { lede: "As it stands.", systems: [], added: [], notOurs: [], clarify: [], updates: [], undoSaid: "Took it out." };
  const read = { status: "Quote", clientName: "C", scope: null, workDone: null, lines: [] };
  it("is handed over with what was taken out", () => {
    const p = scopePrompt({ ...read, previous: was, setAside: [{ on: "Sun 1 Nov", said: "Added exhaust fans." }] });
    expect(p).toContain("As it stands.");
    expect(p).toContain("Sun 1 Nov: Added exhaust fans.");
    expect(p).not.toContain("undoSaid");
  });
  it("never hands over a priced line of the quote's scope", () => {
    const p = scopePrompt({ ...read, workDone: "Slab penetrations.\nTotal: $55,011.00 + GST\nOption: decommissioning." });
    expect(p).toContain("Slab penetrations.");
    expect(p).toContain("Option: decommissioning.");
    expect(p).not.toContain("55,011");
  });
});

describe("the scope on the quote", () => {
  const scope = (added: string[]) => ({ lede: "A job.", systems: [], added: added.map((text) => ({ text, from: "A note" })), notOurs: [], clarify: [], updates: [], undoSaid: "" });

  it("finds what a rewrite added, however it's spaced or cased", () => {
    expect(newlyAdded(scope(["New trunking"]), scope(["new  trunking", "A pump"])).map((a) => a.text)).toEqual(["A pump"]);
  });

  it("keeps waiting only what the brief still has", () => {
    expect(stillAdded(scope(["A pump", "Gone", "A pump"]).added, scope(["A pump"])).map((a) => a.text)).toEqual(["A pump"]);
  });

  it("drops a person's line that names a price", () => {
    expect(wordsWithoutMoney("Unit 2 gets trunking\n$85 for it\n350 ex for the removal\nUnit 12 too")).toBe("Unit 2 gets trunking\nUnit 12 too");
  });

  it("says what Price them asks for", () => {
    expect(priceThemWords(scope(["New trunking", "A pump"]).added)).toBe("Price what's been added: New trunking; A pump.");
  });
});
