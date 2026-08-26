/* THE FRAME PRINTS — a static guard on the one thing no screen check can see.

   The document's frame is drawn twice, by two different mechanisms, because
   the two media want different things:

   - on screen, two absolutely positioned layers behind the sheet: one filled
     rectangle with a white well over it. A scrolling document has no pages,
     so one frame around the whole thing is right.
   - on paper, a table. `thead` and `tfoot` are the only boxes a print engine
     repeats on every page, so they are the top and bottom of the frame and
     the cell holding the document draws the sides with its own borders.
     Without that, page two of a themed sheet is two bare strips — the
     head-and-foot band this treatment was chosen over.

   The screen half has to UNDO the table (`display: block`, no background, no
   border) and the print half has to put it back. Both halves live in the same
   stylesheet, and `@media print` adds no specificity — so the print rules only
   win if their selectors are heavier than the screen reset's. Written the
   obvious way (`.dsd-fr-t { background: … }`) they are not, and the frame
   silently does not print while every screen check says the sheet is fine.

   That is unobservable in jsdom and unobservable in a browser. So it is
   asserted here the only way it can be: by reading the sheet off disk and
   comparing the two selectors' specificity, which is what the cascade will
   do. Same shape as the repo's contrast guards, and for the same reason. */

import { readFileSync } from "fs";
import { join } from "path";

const CSS = readFileSync(join(__dirname, "../sheet-doc.css"), "utf8");

/** (id, class, type) for a compound selector — enough for the selectors this
    sheet actually uses, which are classes, child combinators and element
    names. `*` counts nothing, which is the case that matters here. */
function specificity(selector: string): [number, number, number] {
  const s = selector.trim();
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[[^\]]+\]/g) ?? []).length +
    (s.match(/:(?!:)[\w-]+/g) ?? []).length;
  const types = s
    .split(/[\s>+~]+/)
    .filter(Boolean)
    .filter((part) => /^[a-z]/i.test(part)).length;
  return [ids, classes, types];
}

const beats = (a: [number, number, number], b: [number, number, number]) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};

/** every selector in the sheet that carries the given declaration */
function selectorsDeclaring(css: string, declaration: RegExp): string[] {
  const out: string[] = [];
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, sel, body] of rules) {
    if (declaration.test(body)) {
      for (const one of sel.split(",")) {
        const clean = one.replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (clean && !clean.startsWith("@")) out.push(clean);
      }
    }
  }
  return out;
}

describe("the frame on paper", () => {
  /* The reset that has to be beaten. It exists so the table is not a table on
     screen, and it zeroes exactly the three things the frame is made of. */
  const reset = selectorsDeclaring(CSS, /background:\s*none/).filter((s) =>
    s.includes(".dsd-frame")
  );

  it("resets the frame table to a block for the screen", () => {
    expect(reset.length).toBeGreaterThan(0);
    // the cell selector is the one that matters — it is what the bands and the
    // bordered content cell must out-specify
    expect(reset.some((s) => s.endsWith("td"))).toBe(true);
  });

  /* THE CLAIM. Every spacer that holds the frame's room open must
     out-specify every part of that reset — otherwise it loses silently, the
     content prints under the fixed paint, and nothing on screen can tell. */
  it("holds every spacer open with a selector that beats the reset", () => {
    const spacers = [
      ...selectorsDeclaring(CSS, /height:\s*calc\(var\(--dsd-edge\)/),
      ...selectorsDeclaring(CSS, /padding:\s*0\s+calc\(var\(--dsd-edge\)/),
      ...selectorsDeclaring(CSS, /padding:\s*var\(--doc-clear/),
    ].filter((s) => s.includes(".dsd-frame"));

    // the two band rows, the side-padded cell and the well's clear —
    // nothing may be missed
    expect(spacers.length).toBeGreaterThanOrEqual(4);

    for (const spacer of spacers) {
      for (const zeroed of reset) {
        expect({ spacer, beats: beats(specificity(spacer), specificity(zeroed)) })
          .toEqual({ spacer, beats: true });
      }
    }
  });

  /* THE PAINT IS THE FIXED LAYERS, stamped once per page. A table ends where
     its rows end, so only these can frame the tail of a last page whose
     content stops early — lose the position override and the tail goes back
     to bare paper. And the table must never paint again: a second copy of
     the ink or the well would sit ON TOP of the fixed layers and notch its
     own corners against them. */
  it("paints the frame with the fixed per-page layers, not the table", () => {
    const printBlock = CSS.slice(CSS.indexOf("@media print"));
    expect(printBlock).toMatch(
      /\.dsd-bband,\s*\n?\s*\.dsd-bwell\s*\{\s*position:\s*fixed/
    );
    // the well's fill must survive an ink-saving print — it is what carves
    // the page back out of the brand colour
    expect(CSS).toMatch(
      /\.dsd-bwell\s*\{[^}]*print-color-adjust:\s*exact/
    );
    // and the spacers carry no paint of their own
    const framePaint = [
      ...selectorsDeclaring(printBlock, /background:\s*var\(--doc-ink/),
      ...selectorsDeclaring(printBlock, /background:\s*var\(--doc-well/),
    ].filter((s) => s.includes(".dsd-frame"));
    expect(framePaint).toEqual([]);
  });

  /* The head and the foot are what make it a frame per PAGE rather than per
     document. If either stops being a repeating row group the sheet goes back
     to two bars on page two, which is what this whole mechanism exists to
     stop — and it would look correct on screen, where they are hidden. */
  it("prints the head and the foot as repeating row groups", () => {
    expect(CSS).toMatch(/\.dsd-frame\s*>\s*thead\s*\{\s*display:\s*table-header-group/);
    expect(CSS).toMatch(/\.dsd-frame\s*>\s*tfoot\s*\{\s*display:\s*table-footer-group/);
  });

  /* THE SHEET DRAWS ITS OWN PAPER MARGIN. Every chrome prints on a page box
     with no margin — that is the only place a browser will print its own
     date/title/URL/page-number furniture, and a customer's copy must not
     carry ours — so the inset that keeps the frame off the paper's corner has
     to come from the document. Lose `--dsd-edge` and the band prints bled to
     all four edges again, which is the shape Isaac asked to be rid of. */
  it("insets the frame from the paper itself, on both layers and the spacers", () => {
    const printBlock = CSS.slice(CSS.indexOf("@media print"));
    const bare = printBlock.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare).toMatch(/\.dsd\s*\{[^}]*--dsd-edge:\s*\d/);
    // the band sits at the edge, the well one gutter further in
    expect(bare).toMatch(/\.dsd-bband\s*\{\s*inset:\s*var\(--dsd-edge\)/);
    expect(bare).toMatch(
      /\.dsd-bwell\s*\{\s*inset:\s*calc\(\s*var\(--dsd-edge\)\s*\+\s*var\(--doc-gutter/
    );
    /* and the table spacers hold the SAME distance open, or the content
       prints over the band it is meant to clear */
    for (const re of [
      /td\.dsd-fr-b\s*\{\s*height:\s*calc\(\s*var\(--dsd-edge\)\s*\+\s*var\(--doc-gutter/,
      /td\.dsd-fr-c\s*\{\s*padding:\s*0\s+calc\(\s*var\(--dsd-edge\)\s*\+\s*var\(--doc-gutter/,
    ])
      expect(bare).toMatch(re);
  });

  /* THE FRAME IS CONCENTRIC WITH ITS WELL, on paper as well as on screen.

     The band was a plain rectangle with a rounded well inside it, which reads
     as a block someone has cut a rounded hole in — Isaac called it unfinished
     the first time a real brand colour was set, and it had looked that way
     since the frame shipped. Concentric means outer = radius + gutter, or the
     frame runs thick at the corners and thin down the sides. */
  it("rounds the band concentrically with its well", () => {
    /* comments stripped first: this file's prose quotes CSS, and a `}` inside
       a comment ends a naive `[^}]*` scan of the rule it sits in — which is
       exactly what happened writing this test. */
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare).toMatch(
      /\.dsd-bband\s*\{[^}]*border-radius:\s*calc\(\s*var\(--doc-radius[^)]*\)\s*\+\s*var\(--doc-gutter/
    );
  });

  /* AND NO CHROME SQUARES IT ANY MORE — the reversal, pinned so it cannot
     drift back one chrome at a time.

     The old law was "whoever injects `@page { margin: 0 }` injects the
     square-off with it", because the frame bled to the paper and a radius at
     the paper's own corner draws four white notches. Isaac looked at a real
     PDF of it and asked for the opposite: the band curved the whole way
     round, as the Summary screen draws it. So the margin strip is now about
     the BROWSER'S furniture, not about bleeding, and the inset that keeps the
     corner off the paper is `--dsd-edge` in the sheet. A square-off in either
     chrome that renders this document would put the hard corners back. */
  it("leaves the band rounded in every chrome that renders this sheet", () => {
    const chromes = [
      "src/components/studio/summary/print-doc.tsx",
      "src/app/live/[token]/live-sheet.tsx",
    ];
    for (const rel of chromes) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const bare = src.replace(/\/\*[\s\S]*?\*\//g, "");
      expect({
        rel,
        strips: /@page[^{]*\{\s*(?:size:[^;]*;\s*)?margin:\s*0/.test(bare),
        squares: /dsd-bband\s*\{\s*border-radius:\s*0/.test(bare),
      }).toEqual({ rel, strips: true, squares: false });
    }
  });

  /* EVERY PAGE CLOSES AS ITS OWN BOX. Without clone, border-radius and
     padding exist only at the well's true start and end: every intermediate
     page break is squared off and its content starts flush against the band.
     Isaac saw both from his phone. */
  it("clones the well so every page fragment is a complete, padded box", () => {
    expect(CSS).toMatch(
      /\.dsd-fr-w\s*\{[^}]*box-decoration-break:\s*clone/
    );
  });

});
