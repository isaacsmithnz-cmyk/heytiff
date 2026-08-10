/**
 * @jest-environment node
 *
 * Find-in-document: the part that decides what a person SEES.
 *
 * Postgres does the matching, so nothing here re-implements it. What is pure —
 * and what these pin — is the window: a 1,400-character chunk whose term sits
 * near the end must show the term, not the chunk's opening; the marks must land
 * on what was typed and nowhere else; and the whole thing must survive a term
 * Postgres matched by STEM that appears nowhere literally.
 */

import {
  isSearchable,
  normaliseQuery,
  pageLabel,
  searchTerms,
  snippetOf,
  SNIPPET_CHARS,
  type Segment,
} from "../doc-search";

/** The text of a snippet, as a reader sees it. */
const read = (segs: Segment[]) => segs.map((s) => s.text).join("");
/** Just the marked runs. */
const marks = (segs: Segment[]) => segs.filter((s) => s.hit).map((s) => s.text);

describe("what is worth sending", () => {
  it("trims, collapses whitespace and caps length", () => {
    expect(normaliseQuery("  drain   pump \n")).toBe("drain pump");
    expect(normaliseQuery("x".repeat(500))).toHaveLength(120);
  });

  it("survives junk instead of a string", () => {
    for (const junk of [null, undefined, 7, {}, []]) {
      expect(normaliseQuery(junk as unknown as string)).toBe("");
    }
  });

  /* One character would match a prefix of half the manual, and a list of
     everything is not a search result. */
  it("refuses a query too short to mean anything", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("  ")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable("P1")).toBe(true);
  });
});

describe("the terms to mark", () => {
  it("keeps a quoted phrase whole", () => {
    expect(searchTerms('"drain pump" P1')).toEqual(["drain pump", "P1"]);
  });

  /* Marking longest-first stops "zone" claiming the start of "zone
     controller" and leaving the rest unmarked. */
  it("offers the longest term first", () => {
    expect(searchTerms("zone controller zone")).toEqual(["controller", "zone"]);
  });

  it("drops the operators, which are grammar rather than words", () => {
    expect(searchTerms("drain OR pump")).toEqual(["drain", "pump"]);
    expect(searchTerms("pump -drain")).toEqual(["pump"]);
  });

  it("dedupes", () => {
    expect(searchTerms("P1 p1 P1")).toEqual(["P1"]);
  });
});

describe("the window", () => {
  const filler = (n: number) => "lorem ipsum dolor sit amet ".repeat(n);

  it("marks the term and keeps the text either side", () => {
    const segs = snippetOf("Set the drain pump to manual.", ["drain pump"]);
    expect(read(segs)).toBe("Set the drain pump to manual.");
    expect(marks(segs)).toEqual(["drain pump"]);
  });

  /* THE REASON THIS FUNCTION EXISTS. A term 1,200 characters into a chunk
     would otherwise be off the end of the snippet, and the hit would have to
     be taken on trust. */
  it("centres on the match rather than the start of the chunk", () => {
    const content = `${filler(50)} the P1 intake sensor error ${filler(50)}`;
    const segs = snippetOf(content, ["P1"]);

    expect(marks(segs)).toEqual(["P1"]);
    expect(read(segs)).toContain("intake sensor error");
    expect(read(segs).length).toBeLessThanOrEqual(SNIPPET_CHARS + 40);
    // and says it is a window, at both ends
    expect(read(segs).startsWith("…")).toBe(true);
    expect(read(segs).endsWith("…")).toBe(true);
  });

  it("marks every occurrence inside the window, not just the first", () => {
    const segs = snippetOf("P1 here and P1 there", ["P1"]);
    expect(marks(segs)).toEqual(["P1", "P1"]);
  });

  it("merges terms that overlap rather than nesting them", () => {
    const segs = snippetOf("the drain pump is loud", ["drain pump", "pump"]);
    expect(marks(segs)).toEqual(["drain pump"]);
  });

  /* Postgres matched the STEM — "charging" found by "charge" — so the literal
     term is absent. The snippet must still render, unmarked, rather than
     collapsing to nothing. */
  it("shows the head of the chunk when the term appears nowhere literally", () => {
    const segs = snippetOf("Refrigerant charging procedure follows.", ["charge"]);
    expect(marks(segs)).toEqual([]);
    expect(read(segs)).toContain("Refrigerant charging");
  });

  it("does not mark a term buried inside a longer word", () => {
    const segs = snippetOf("The pumpkin is not a pump.", ["pump"]);
    expect(marks(segs)).toEqual(["pump"]);
    expect(read(segs)).toContain("pumpkin");
  });

  /* A model number's edges aren't word characters all round, and a naive \b on
     both sides drops the match entirely. */
  it("marks a model number whole", () => {
    const segs = snippetOf("Fit the PUZ-ZM250VKA outdoor unit.", ["PUZ-ZM250VKA"]);
    expect(marks(segs)).toEqual(["PUZ-ZM250VKA"]);
  });

  it("matches case-insensitively but shows the document's own casing", () => {
    const segs = snippetOf("The Drain Pump is fitted.", ["drain pump"]);
    expect(marks(segs)).toEqual(["Drain Pump"]);
  });

  it("collapses the whitespace a PDF text layer leaves behind", () => {
    expect(read(snippetOf("Set   the\n\n drain  pump", ["drain"]))).toBe("Set the drain pump");
  });

  it("has nothing to show for an empty chunk", () => {
    expect(snippetOf("", ["P1"])).toEqual([]);
  });

  it("survives no terms at all", () => {
    expect(read(snippetOf("Some content here.", []))).toBe("Some content here.");
  });
});

describe("the page label", () => {
  it("says one page as one page", () => {
    expect(pageLabel({ pageFrom: 42, pageTo: 42 })).toBe("p.42");
  });

  it("says a range when the passage straddles two", () => {
    expect(pageLabel({ pageFrom: 42, pageTo: 43 })).toBe("p.42–43");
  });
});
