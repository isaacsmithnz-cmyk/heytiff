/** @jest-environment jsdom */
import { blockHtml, blocksOf, inlineOf, inlinePlain, markOf, markOfBlocks, photosIn, plainOf, restyle, withPhoto } from "../proposal-marks";
import { plainWords, proposalOf } from "../lines-proposal";

/* The proposal's formatting, kept in its words (Isaac, 20 November 2026:
   "format should be a header like googe docs", "Build all three"). */

describe("inlineOf", () => {
  it("reads bold, italic and underline, and words with none", () => {
    expect(inlineOf("a **b** *c* __d__")).toEqual([{ text: "a " }, { text: "b", b: true }, { text: " " }, { text: "c", i: true }, { text: " " }, { text: "d", u: true }]);
  });
  it("nests them", () => {
    expect(inlineOf("**bold *both***")).toEqual([{ text: "bold ", b: true }, { text: "both", b: true, i: true }]);
  });
  it("keeps a mark with no partner as the character", () => {
    expect(inlinePlain("2.5mm* cable, 5 * 3")).toBe("2.5mm* cable, 5 * 3");
    expect(inlinePlain("a ** b")).toBe("a ** b");
  });
});

describe("blocksOf", () => {
  it("reads paragraphs, a heading, both lists and a photo", () => {
    const md = "# What we found\nThe leak is at the **flare**.\n- Find it\n- Fix it\n1. First\n2. Then\n![](photo:abc-123)";
    expect(blocksOf(md).map((b) => b.kind)).toEqual(["h", "p", "ul", "ol", "photo"]);
    expect(photosIn(md)).toEqual(["abc-123"]);
    /* a photo of ours goes by doc:<uuid> (bug 123) */
    expect(photosIn("![](photo:doc:6f1c2b9e-1111-4222-8333-944455556666)")).toEqual(["doc:6f1c2b9e-1111-4222-8333-944455556666"]);
  });
  it("reads words kept before formatting as they were: a line a paragraph", () => {
    expect(blocksOf("We have two ways forward.\nOption 1 installs a split.")).toEqual([
      { kind: "p", runs: [{ text: "We have two ways forward." }] },
      { kind: "p", runs: [{ text: "Option 1 installs a split." }] },
    ]);
  });
});

describe("plainOf, for ServiceM8, the Scope and the phone", () => {
  it("takes the marks off, keeps the lists' marks, and leaves the photo out", () => {
    expect(plainOf("# Heading\nThe **leak** is *here*.\n- one\n- __two__\n1. a\n![](photo:p1)")).toBe("Heading\nThe leak is here.\n- one\n- two\n1. a");
  });
  it("takes the marks off a whole proposal", () => {
    const p = plainWords(proposalOf({ title: "**Air**", intro: "Hi *Jo*", options: [{ summary: "A **split**", areas: [{ name: "__Units__", items: ["**MSZ**"] }], included: ["*All*"] }], notIncluded: ["__Paint__"] }));
    expect([p.title, p.intro, p.options[0]!.summary, p.options[0]!.areas[0]!.name, p.options[0]!.areas[0]!.items[0], p.options[0]!.included[0], p.notIncluded[0]]).toEqual([
      "Air",
      "Hi Jo",
      "A split",
      "Units",
      "MSZ",
      "All",
      "Paint",
    ]);
  });
});

describe("the box's markup, both ways", () => {
  const box = (html: string) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };
  it("comes back as the words it was filled with", () => {
    const md = "# What we found\nThe leak is at the **flare** *joint* __here__.\n- Find it\n- Fix **it**\n1. First\n![](photo:p1)";
    expect(markOf(box(blockHtml(md, () => "https://x/p1.jpg")))).toBe(md);
  });
  it("reads what the browser draws: strong, em, a styled span, divs and line breaks", () => {
    expect(markOf(box('<div>One <strong>two</strong></div><div><span style="font-style: italic">three</span><br>four</div>'))).toBe("One **two**\n*three*\nfour");
  });
  it("puts a mark round the words, never their spaces", () => {
    expect(markOf(box("<p>a<b> b </b>c</p>"))).toBe("a **b** c");
  });
  it("escapes what's typed", () => {
    expect(blockHtml('a <script> & "b"', () => null)).toBe("<p>a &lt;script&gt; &amp; &quot;b&quot;</p>");
  });
  it("reads a list's item as one line of inline marks", () => {
    expect(markOf(box("Pipe <i>and</i> cable"), true)).toBe("Pipe *and* cable");
  });
});

describe("the bar's style menu and Add a photo", () => {
  const md = "Intro line\n- a\n- b\nLast";
  it("turns a paragraph into a heading or a list, and a list into paragraphs", () => {
    expect(restyle(md, 0, "h")).toBe("# Intro line\n- a\n- b\nLast");
    expect(restyle(md, 2, "ol")).toBe("Intro line\n- a\n- b\n1. Last");
    expect(restyle(md, 1, "p")).toBe("Intro line\na\nb\nLast");
    expect(restyle(md, 1, "ol")).toBe("Intro line\n1. a\n2. b\nLast");
  });
  it("puts a photo after the block the caret was in, or at the end", () => {
    expect(withPhoto(md, 0, "p9")).toBe("Intro line\n![](photo:p9)\n- a\n- b\nLast");
    expect(withPhoto(md, -1, "p9")).toBe(`${md}\n![](photo:p9)`);
    expect(withPhoto("", 0, "p9")).toBe("![](photo:p9)");
  });
  it("keeps the marks through a change of style", () => {
    expect(markOfBlocks(blocksOf("A **b** *c*"))).toBe("A **b** *c*");
  });
});
