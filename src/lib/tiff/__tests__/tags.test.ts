import {
  asKbTagColor,
  asKbTagKind,
  checkKbTagLabel,
  filterByTags,
  guessKbTags,
  KB_TAG_COLORS,
  KB_TAG_GUESS_MAX,
  KB_TAG_SEEDS,
  KB_TAGS_PER_DOC_MAX,
  kbTagColorFor,
  kbTagLabel,
  kbTagSlug,
  sanitiseTagIds,
} from "../tags";

/* Tags: the rules a label goes through, and the filename's opening offer.

   What these pin: the SLUG is the identity (so "daikin" and "Daikin" are one
   tag, and the server's dedupe agrees with the picker's), trade acronyms come
   back in capitals, the filename guess is a guess that stays small, and the
   filter is AND. */

const tag = (id: string, slug: string) => ({ id, slug });

const TAGS = [
  tag("t-daikin", "daikin"),
  tag("t-mitsi", "mitsubishi-electric"),
  tag("t-vrv", "vrv"),
  tag("t-split", "split"),
  tag("t-multi", "multi-split"),
  tag("t-ducted", "ducted"),
  tag("t-r32", "r32"),
  tag("t-x", "x"),
];

describe("the slug is the identity", () => {
  it("collapses case and punctuation to one key", () => {
    expect(kbTagSlug("Daikin")).toBe("daikin");
    expect(kbTagSlug(" DAIKIN ")).toBe("daikin");
    expect(kbTagSlug("Mitsubishi Electric")).toBe("mitsubishi-electric");
    expect(kbTagSlug("Multi-split")).toBe("multi-split");
  });

  it("never leaves a leading or trailing hyphen to collide on", () => {
    expect(kbTagSlug("  — VRV —  ")).toBe("vrv");
    expect(kbTagSlug("R410A/R32")).toBe("r410a-r32");
  });
});

describe("the label is the print", () => {
  /* "vrf" typed into a box is VRF, and a chip reading "Vrf" beside a citation
     reading "VRF" is one word in two spellings. */
  it("puts trade acronyms back into capitals", () => {
    expect(kbTagLabel("vrv")).toBe("VRV");
    expect(kbTagLabel("vrf")).toBe("VRF");
    expect(kbTagLabel("bms")).toBe("BMS");
    expect(kbTagLabel("daikin vrv")).toBe("Daikin VRV");
  });

  /* Anything with a capital in it was typed deliberately. Re-casing it would
     turn "ActronAir" into "Actronair", which is not the company's name. */
  it("leaves a word that already carries a capital alone", () => {
    expect(kbTagLabel("ActronAir")).toBe("ActronAir");
    expect(kbTagLabel("R410A")).toBe("R410A");
    expect(kbTagLabel("daikin VRV")).toBe("Daikin VRV");
  });

  it("trims and collapses the whitespace a paste brings with it", () => {
    expect(kbTagLabel("  heat   pump  ")).toBe("Heat Pump");
  });

  it("caps a label rather than letting it become a paragraph", () => {
    expect(kbTagLabel("x".repeat(200))).toHaveLength(40);
  });
});

describe("what may be stored as a tag", () => {
  it("refuses a name that is only whitespace", () => {
    const res = checkKbTagLabel("   ");
    expect(res).toEqual({ ok: false, error: "Give the tag a name." });
  });

  /* Punctuation cleans to a label but slugs to nothing — and an empty slug
     would collide with the next one. There is no name in it to store. */
  it("refuses a name with no letters or numbers in it", () => {
    const res = checkKbTagLabel("—--");
    expect(res.ok).toBe(false);
  });

  it("hands back both halves for a real one", () => {
    expect(checkKbTagLabel(" mitsubishi electric ")).toEqual({
      ok: true,
      value: { label: "Mitsubishi Electric", slug: "mitsubishi-electric" },
    });
  });
});

describe("the palette", () => {
  /* #00A389 and #e0264f are ok/danger everywhere in this app. A tag that
     happened to be that teal would read as a status on a row whose whole job
     is to report status honestly. */
  it("holds no semantic state colour", () => {
    expect(KB_TAG_COLORS).not.toContain("#00a389");
    expect(KB_TAG_COLORS).not.toContain("#00A389");
    expect(KB_TAG_COLORS).not.toContain("#e0264f");
  });

  it("accepts a stored colour and normalises its case", () => {
    expect(asKbTagColor("#2563EB")).toBe("#2563eb");
    expect(asKbTagColor("red")).toBeNull();
    expect(asKbTagColor("#fff")).toBeNull();
  });

  it("gives the same label the same colour every time", () => {
    expect(kbTagColorFor("Daikin")).toBe(kbTagColorFor("Daikin"));
    expect(KB_TAG_COLORS).toContain(kbTagColorFor("Daikin"));
  });

  it("knows its three groups and nothing else", () => {
    expect(asKbTagKind("brand")).toBe("brand");
    expect(asKbTagKind("manufacturer")).toBeNull();
  });
});

describe("the starter set", () => {
  it("has no two tags that would be the same row", () => {
    const slugs = KB_TAG_SEEDS.map((s) => kbTagSlug(s.label));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("survives its own label rules unchanged", () => {
    for (const seed of KB_TAG_SEEDS) expect(kbTagLabel(seed.label)).toBe(seed.label);
  });
});

describe("what the filename offers", () => {
  it("ticks the gear the file names", () => {
    expect(guessKbTags("daikin-vrv-service-manual.pdf", TAGS)).toEqual(["t-daikin", "t-vrv"]);
  });

  it("reads separators the way the category guesser does", () => {
    expect(guessKbTags("Daikin_Ducted R32 Install.PDF", TAGS)).toEqual([
      "t-daikin",
      "t-ducted",
      "t-r32",
    ]);
  });

  /* "multi-split-manual" contains both "multi split" and "split"; ticking both
     says the same thing twice with the vaguer one last. */
  it("drops a phrase that sits inside a longer one it also matched", () => {
    expect(guessKbTags("multi-split-install.pdf", TAGS)).toEqual(["t-multi"]);
  });

  it("takes them in the order the filename says them", () => {
    expect(guessKbTags("vrv-daikin.pdf", TAGS)).toEqual(["t-vrv", "t-daikin"]);
  });

  it("matches whole words, so a model number isn't a brand", () => {
    expect(guessKbTags("PUZ-ZM250-datasheet.pdf", TAGS)).toEqual([]);
    // and a one-character tag never matches at all
    expect(guessKbTags("model x 400.pdf", TAGS)).toEqual([]);
  });

  it("stays a guess rather than filling the row", () => {
    const many = Array.from({ length: 9 }, (_, i) => tag(`t-${i}`, `word${i}`));
    const name = many.map((t) => t.slug).join("-");
    expect(guessKbTags(name, many)).toHaveLength(KB_TAG_GUESS_MAX);
  });

  it("says nothing about a file whose name says nothing", () => {
    expect(guessKbTags("scan-0043.pdf", TAGS)).toEqual([]);
    expect(guessKbTags("", TAGS)).toEqual([]);
  });
});

describe("filtering by tag", () => {
  const docs = [
    { id: "a", tags: [{ id: "t-daikin" }, { id: "t-vrv" }] },
    { id: "b", tags: [{ id: "t-daikin" }, { id: "t-ducted" }] },
    { id: "c", tags: [] },
  ];

  it("is every document when nothing is picked", () => {
    expect(filterByTags(docs, [])).toHaveLength(3);
  });

  /* AND, not OR: the second chip is "…and VRV", and it composes with the
     category chip above it, which also narrows. */
  it("narrows with each tag rather than widening", () => {
    expect(filterByTags(docs, ["t-daikin"]).map((d) => d.id)).toEqual(["a", "b"]);
    expect(filterByTags(docs, ["t-daikin", "t-vrv"]).map((d) => d.id)).toEqual(["a"]);
    expect(filterByTags(docs, ["t-vrv", "t-ducted"])).toEqual([]);
  });
});

describe("ids arriving from a browser", () => {
  const known = [{ id: "t-1" }, { id: "t-2" }, { id: "t-3" }];

  it("drops anything that isn't one of this org's tags", () => {
    expect(sanitiseTagIds(["t-1", "t-someone-elses"], known)).toEqual(["t-1"]);
  });

  it("dedupes, and refuses to take more than a document may wear", () => {
    expect(sanitiseTagIds(["t-1", "t-1", "t-2"], known)).toEqual(["t-1", "t-2"]);

    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x-${i}` }));
    expect(sanitiseTagIds(many.map((t) => t.id), many)).toHaveLength(KB_TAGS_PER_DOC_MAX);
  });

  it("treats anything that isn't a list as no tags at all", () => {
    expect(sanitiseTagIds("t-1", known)).toEqual([]);
    expect(sanitiseTagIds(undefined, known)).toEqual([]);
  });
});
