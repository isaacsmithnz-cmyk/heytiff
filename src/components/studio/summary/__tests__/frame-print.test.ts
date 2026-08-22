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

  /* THE CLAIM. Every rule that paints part of the frame must out-specify every
     part of that reset — otherwise it loses silently and prints nothing. */
  it("paints every part of the frame with a selector that beats the reset", () => {
    const painters = [
      ...selectorsDeclaring(CSS, /background:\s*var\(--doc-ink/),
      ...selectorsDeclaring(CSS, /padding:\s*0\s+var\(--doc-gutter/),
      ...selectorsDeclaring(CSS, /border-radius:\s*var\(--doc-radius/),
      ...selectorsDeclaring(CSS, /padding:\s*calc\(var\(--doc-clear/),
    ].filter((s) => s.includes(".dsd-frame"));

    // the two bands, the inked cell (background + side padding) and the well
    // (radius + clear) — nothing may be missed
    expect(painters.length).toBeGreaterThanOrEqual(5);

    for (const painter of painters) {
      for (const zeroed of reset) {
        expect({ painter, beats: beats(specificity(painter), specificity(zeroed)) })
          .toEqual({ painter, beats: true });
      }
    }
  });

  /* The head and the foot are what make it a frame per PAGE rather than per
     document. If either stops being a repeating row group the sheet goes back
     to two bars on page two, which is what this whole mechanism exists to
     stop — and it would look correct on screen, where they are hidden. */
  it("prints the head and the foot as repeating row groups", () => {
    expect(CSS).toMatch(/\.dsd-frame\s*>\s*thead\s*\{\s*display:\s*table-header-group/);
    expect(CSS).toMatch(/\.dsd-frame\s*>\s*tfoot\s*\{\s*display:\s*table-footer-group/);
  });

  /* THE FRAME OWNS THE PAPER EDGE, and only when there is one. The themed
     cover prints on a named page with no margin — inset inside the default
     margin the frame reads as a border drawn on the paper. The name is the
     whole mechanism: an @page rule cannot see a CSS variable, so the print
     chrome injects `@page cover { margin: 0 }` for a themed brand and nothing
     otherwise. If the cover loses its name, themed sheets quietly go back to
     floating in a white ring. */
  it("puts the cover on the named page the themed margin is stripped from", () => {
    const studio = readFileSync(
      join(__dirname, "../../studio.css"),
      "utf8"
    );
    expect(studio).toMatch(/\.ds-print-cover\s*\{[^}]*page:\s*cover/);
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

  /* The two mechanisms must never both draw. The screen layers are one
     rectangle behind the whole document; left on in print they would paint a
     second, unclosed frame over the pages the table is framing properly. */
  it("hides the screen layers on paper", () => {
    const printBlock = CSS.slice(CSS.indexOf("@media print"));
    expect(printBlock).toMatch(/\.dsd-bband,\s*\n?\s*\.dsd-bwell\s*\{\s*display:\s*none/);
  });
});
