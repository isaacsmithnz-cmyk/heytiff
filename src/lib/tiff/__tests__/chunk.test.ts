/* The chunker. Deterministic by design, so a re-run of a failed batch produces
   the same rows — which is what makes retrying a 300-page manual safe.

   The two things that matter are EDGES and PAGES: a chunk cut mid-sentence
   answers a question with half a fact, and a chunk whose page range is wrong
   cites a page the answer isn't on. */

import { chunkPages, headingOf } from "../chunk";

const para = (n: number, ch = "x") => `${ch.repeat(n)}`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("headings", () => {
  it("takes a numbered clause line", () => {
    expect(headingOf("6.2 Refrigerant charge")).toBe("6.2 Refrigerant charge");
    expect(headingOf("3) Wiring the outdoor unit")).toBe("3) Wiring the outdoor unit");
    expect(headingOf("10.1.4 Pump-down")).toBe("10.1.4 Pump-down");
  });

  it("takes a short shouted line", () => {
    expect(headingOf("WARNING")).toBe("WARNING");
    expect(headingOf("  INDOOR UNIT INSTALLATION  ")).toBe("INDOOR UNIT INSTALLATION");
  });

  it("refuses ordinary prose, and shouting that goes on too long", () => {
    expect(headingOf("Refrigerant charge must be measured before")).toBeNull();
    expect(headingOf("A".repeat(120))).toBeNull();
    expect(headingOf("")).toBeNull();
    expect(headingOf("   ")).toBeNull();
    // digits alone aren't a clause number — a page footer isn't a heading
    expect(headingOf("42")).toBeNull();
  });

  it("hangs the heading off the chunk it opens", () => {
    const [chunk] = chunkPages([
      { page: 1, text: `6.2 Refrigerant charge\n\n${words(20)}` },
    ]);
    expect(chunk.heading).toBe("6.2 Refrigerant charge");
    // and it stays IN the content — the heading is real text, not metadata
    expect(chunk.content.startsWith("6.2 Refrigerant charge")).toBe(true);
  });

  it("leaves a chunk that opens mid-prose with no heading at all", () => {
    const [chunk] = chunkPages([{ page: 1, text: words(30) }]);
    expect(chunk.heading).toBeUndefined();
  });
});

describe("sizing and boundaries", () => {
  it("keeps a tiny document as one chunk", () => {
    const chunks = chunkPages([{ page: 1, text: "Set the charge to 3.4 kg." }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ content: "Set the charge to 3.4 kg.", pageFrom: 1, pageTo: 1 });
  });

  it("returns nothing for a document with nothing in it", () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ page: 1, text: "   \n\n  " }])).toEqual([]);
  });

  it("packs whole paragraphs up to the target and breaks between them", () => {
    const text = [para(500, "a"), para(500, "b"), para(500, "c")].join("\n\n");
    const chunks = chunkPages([{ page: 1, text }], { target: 1200, overlap: 0 });

    expect(chunks).toHaveLength(2);
    // two paragraphs fit (500 + 2 + 500), the third does not
    expect(chunks[0].content).toBe(`${para(500, "a")}\n\n${para(500, "b")}`);
    expect(chunks[1].content).toBe(para(500, "c"));
  });

  it("never cuts a paragraph that fits", () => {
    const source = [words(60), words(60), words(60)];
    const chunks = chunkPages([{ page: 1, text: source.join("\n\n") }], {
      target: 400,
      overlap: 50,
    });

    for (const c of chunks) {
      expect(c.content.trim()).toBe(c.content);
      // every paragraph in every chunk is one of the originals, whole
      for (const p of c.content.split("\n\n")) expect(source).toContain(p);
    }
  });

  /* A paragraph bigger than a whole chunk is the case the paragraph rule can't
     answer. It falls back to sentences — never to a fixed character count that
     would sever "do not exceed 500 microns" in the middle. */
  it("splits an oversized paragraph at sentence ends", () => {
    const sentence = (n: number) => `${words(20)} number ${n}.`;
    const text = [sentence(1), sentence(2), sentence(3), sentence(4)].join(" ");
    const chunks = chunkPages([{ page: 4, text }], { target: 200, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content).toMatch(/\.$/);
  });

  it("hard-splits at whitespace when one sentence is longer than a chunk", () => {
    const chunks = chunkPages([{ page: 1, text: words(400) }], { target: 300, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(300);
      // every token is a whole word — the cut landed on whitespace
      for (const token of c.content.split(/\s+/)) expect(token).toMatch(/^w\d+$/);
    }
    // nothing is lost — every word survives somewhere
    expect(chunks.map((c) => c.content).join(" ").split(/\s+/)).toContain("w399");
  });
});

describe("overlap", () => {
  it("re-opens the next chunk with the tail of the last one", () => {
    const text = [para(300, "a"), para(300, "b"), para(150, "c"), para(300, "d")].join("\n\n");
    const chunks = chunkPages([{ page: 1, text }], { target: 800, overlap: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    // the 150-char paragraph fits the overlap budget and appears in both
    expect(chunks[0].content).toContain(para(150, "c"));
    expect(chunks[1].content).toContain(para(150, "c"));
  });

  it("always advances, even when nothing fits the overlap budget", () => {
    // every paragraph is bigger than the overlap, so no tail can be carried
    const text = Array.from({ length: 6 }, (_, i) => para(400, String.fromCharCode(97 + i))).join("\n\n");
    const chunks = chunkPages([{ page: 1, text }], { target: 500, overlap: 200 });

    expect(chunks).toHaveLength(6);
    expect(new Set(chunks.map((c) => c.content)).size).toBe(6);
  });

  it("terminates on a document made of one enormous unbroken run", () => {
    const chunks = chunkPages([{ page: 1, text: words(2000) }], { target: 250, overlap: 240 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(200); // it made progress, it didn't loop
  });
});

describe("pages", () => {
  it("records the range a chunk actually spans", () => {
    const chunks = chunkPages(
      [
        { page: 7, text: para(400, "a") },
        { page: 8, text: para(400, "b") },
        { page: 9, text: para(400, "c") },
      ],
      { target: 1400, overlap: 0 }
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageFrom: 7, pageTo: 9 });
  });

  it("keeps a single-page chunk single-page", () => {
    const chunks = chunkPages(
      [
        { page: 7, text: para(1300, "a") },
        { page: 8, text: para(1300, "b") },
      ],
      { target: 1400, overlap: 0 }
    );
    expect(chunks.map((c) => [c.pageFrom, c.pageTo])).toEqual([
      [7, 7],
      [8, 8],
    ]);
  });

  /* Page numbers come off the batch window, not off a counter — pages 41–43 of
     a manual must cite 41–43, not 1–3. */
  it("uses the page numbers it was given, not positions in the array", () => {
    const chunks = chunkPages([
      { page: 41, text: "Set the charge." },
      { page: 42, text: "Then close the valve." },
    ]);
    expect(chunks[0]).toMatchObject({ pageFrom: 41, pageTo: 42 });
  });

  it("skips blank pages without breaking the range around them", () => {
    const chunks = chunkPages(
      [
        { page: 1, text: para(300, "a") },
        { page: 2, text: "" }, // a scanned page: counted elsewhere, absent here
        { page: 3, text: para(300, "b") },
      ],
      { target: 1400, overlap: 0 }
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageFrom: 1, pageTo: 3 });
    expect(chunks[0].content).toBe(`${para(300, "a")}\n\n${para(300, "b")}`);
  });
});

describe("determinism", () => {
  it("produces byte-identical chunks for the same pages twice", () => {
    const pages = [
      { page: 1, text: `6.1 Pump-down\n\n${words(120)}\n\n${words(90)}` },
      { page: 2, text: `${words(200)}\n\nWARNING\n\n${words(40)}` },
    ];
    expect(chunkPages(pages)).toEqual(chunkPages(pages));
  });
});
