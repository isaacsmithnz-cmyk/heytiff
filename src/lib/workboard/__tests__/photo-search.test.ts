import {
  PHOTO_SEARCH_MIN,
  parsePhotoQuery,
  rankPhotos,
  scoreMatch,
  searchSummary,
  type PhotoMatch,
} from "@/lib/workboard/photo-search";

const match = (over: Partial<PhotoMatch> = {}): PhotoMatch => ({
  text: false,
  transcript: false,
  caption: false,
  tag: false,
  ...over,
});

describe("parsePhotoQuery", () => {
  /* THE RAW STRING SURVIVES INTACT. Splitting `PUZ-M125` and searching for
     the halves separately is how you match every Mitsubishi in the account
     instead of the one photograph somebody wanted. */
  it("keeps a model number whole", () => {
    expect(parsePhotoQuery("  PUZ-M125  ").raw).toBe("PUZ-M125");
  });

  it("also offers the words, lowercased, for the tag match", () => {
    expect(parsePhotoQuery("Flexible Duct").words).toEqual(["flexible", "duct"]);
  });

  /* A hyphen stays inside a word — `roof-mounted` is one tag, not two. */
  it("treats a hyphenated term as one word", () => {
    expect(parsePhotoQuery("roof-mounted").words).toEqual(["roof-mounted"]);
  });

  it("drops single characters from the word list", () => {
    expect(parsePhotoQuery("a duct").words).toEqual(["duct"]);
  });

  /* One character matches most of the bank and tells nobody anything. */
  it("refuses to run on anything shorter than the minimum", () => {
    expect(parsePhotoQuery("x").usable).toBe(false);
    expect(parsePhotoQuery("xy").usable).toBe(true);
    expect(PHOTO_SEARCH_MIN).toBe(2);
  });

  it("survives an empty or absent query", () => {
    expect(parsePhotoQuery("").usable).toBe(false);
    expect(parsePhotoQuery("   ").raw).toBe("");
  });

  /* A query long enough to be an attack is a query long enough to be a
     mistake — it is bounded rather than refused. */
  it("bounds a very long query", () => {
    expect(parsePhotoQuery("x".repeat(500)).raw).toHaveLength(120);
  });
});

describe("scoreMatch", () => {
  /* THE TRANSCRIPTION OUTWEIGHS EVERYTHING. If the typed string is literally
     printed on the equipment in the frame, that is not a near-miss. */
  it("puts a transcription hit above any other single matcher", () => {
    expect(scoreMatch(match({ transcript: true }))).toBeGreaterThan(
      scoreMatch(match({ text: true }))
    );
    expect(scoreMatch(match({ transcript: true }))).toBeGreaterThan(
      scoreMatch(match({ caption: true }))
    );
    expect(scoreMatch(match({ transcript: true }))).toBeGreaterThan(
      scoreMatch(match({ tag: true }))
    );
  });

  /* A tag is the weakest alone — tags are broad by design — but it LIFTS a
     photo that also matched some other way. That ensemble behaviour is what
     makes a search feel like it works. */
  it("lets a tag lift a photo that matched another way", () => {
    expect(scoreMatch(match({ caption: true, tag: true }))).toBeGreaterThan(
      scoreMatch(match({ caption: true }))
    );
  });

  it("scores no match as nothing", () => {
    expect(scoreMatch(match())).toBe(0);
  });
});

describe("rankPhotos", () => {
  const row = (id: string, m: Partial<PhotoMatch>, readAt: string) => ({
    id,
    match: match(m),
    readAt,
  });

  it("orders by how well each photo matched", () => {
    const ordered = rankPhotos([
      row("tag-only", { tag: true }, "2026-08-29T00:00:00Z"),
      row("transcript", { transcript: true }, "2026-08-01T00:00:00Z"),
      row("caption", { caption: true }, "2026-08-15T00:00:00Z"),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["transcript", "caption", "tag-only"]);
  });

  /* A fresh photograph should not be buried under an identical older one. */
  it("breaks a tie on the most recently read", () => {
    const ordered = rankPhotos([
      row("older", { caption: true }, "2026-08-01T00:00:00Z"),
      row("newer", { caption: true }, "2026-08-29T00:00:00Z"),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [
      row("a", { tag: true }, "2026-08-01T00:00:00Z"),
      row("b", { transcript: true }, "2026-08-01T00:00:00Z"),
    ];
    rankPhotos(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("searchSummary", () => {
  /* "Nothing found" against a bank of twelve means something completely
     different from nothing found against four thousand, so the sentence
     always says how much has been read. */
  it("says how big the bank is, so an empty result is honest", () => {
    expect(searchSummary(0, 12, "ductwork")).toContain("12 photos read so far");
    expect(searchSummary(0, 12, "ductwork")).toContain("Nothing");
  });

  it("counts one photo as one photo", () => {
    expect(searchSummary(1, 40, "puz")).toContain("1 photo matching");
    expect(searchSummary(1, 1, "puz")).toContain("1 photo read so far");
  });

  it("quotes the term back so the reader can see what was actually asked", () => {
    expect(searchSummary(3, 90, "PUZ-M125")).toContain("PUZ-M125");
  });
});
