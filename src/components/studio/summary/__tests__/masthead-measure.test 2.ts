/* THE MARK MUST FILL THE COLUMN IT WAS GIVEN A COLUMN FOR.

   The identity column exists so the business's mark hangs off the sheet's own
   right margin, like every other line on the page. Three numbers decide
   whether it does — the column's width track, and the two height caps that
   stop a SQUARE badge from setting the masthead's height — and they are
   coupled by arithmetic nobody can see while editing one of them:

       a wordmark of ratio R fills a column of width W only if cap >= W / R

   Shipped uncoupled, the screen cap was 64px against a 290px column, and
   Diamond Air's 3.55:1 mark letterboxed to 227px inside it: 63px of dead
   space between the mark and the margin, which is what "the logo looks small
   and out of line" turned out to be. Print had the same bug at 52px.

   R = 3.45 is the floor this holds for — narrower than any wordmark in use
   (Diamond Air is 3.55) and wide enough that the cap still bites on a badge.

   Read off the stylesheet, because there is no layout to measure: jsdom
   computes no widths, and the bug is arithmetic between three declarations
   rather than anything a render would show. */

import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(__dirname, "../sheet-doc.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** the widest wordmark ratio the column has to fill without letterboxing */
const RATIO = 3.45;

function num(re: RegExp): number {
  const m = css.match(re);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe("the identity column and the mark that fills it", () => {
  const [floor, ceiling] = (() => {
    const m = css.match(
      /--dsd-ident-w:\s*clamp\((\d+)px,\s*\d+%,\s*(\d+)px\)/
    );
    expect(m).not.toBeNull();
    return [Number(m![1]), Number(m![2])];
  })();

  it("the screen cap does not bind on a wordmark at the column's ceiling", () => {
    const cap = num(/\.dsd-idlogo\s*\{[^}]*max-height:\s*(\d+)px/);
    expect(cap).toBeGreaterThanOrEqual(ceiling / RATIO);
  });

  it("the print cap does not bind on a wordmark at the column's floor", () => {
    /* paper puts the column on its floor — 23% of A4 is well under it */
    const caps = [...css.matchAll(/\.dsd-idlogo\s*\{\s*max-height:\s*(\d+)px/g)];
    const print = Number(caps[caps.length - 1]![1]);
    expect(print).toBeGreaterThanOrEqual(floor / RATIO);
  });

  it("the column's floor holds the contact lines it was measured for", () => {
    /* the floor's whole job is one line per contact, and the longest of them
       is an email — `service@diamondairsolutions.com`, 217px at 13px/500.
       Set the lines bigger without moving the floor and the printed sheet
       breaks an address mid-word. */
    const size = num(/\.dsd-idc\s*\{[^}]*font-size:\s*([\d.]+)px/);
    const LONGEST_AT_13PX = 217;
    expect(floor).toBeGreaterThanOrEqual((LONGEST_AT_13PX * size) / 13);
  });

  it("both sides of the masthead set their address lines the same", () => {
    const idc = css.match(/\.dsd-idc\s*\{[^}]*\}/)![0];
    const to = css.match(/\.dsd-to-l\s*\{[^}]*\}/)![0];
    for (const prop of ["font-size", "font-weight", "line-height"]) {
      const re = new RegExp(`${prop}:\\s*([^;]+);`);
      expect(idc.match(re)![1].trim()).toBe(to.match(re)![1].trim());
    }
  });
});

/* AND THE LINES UNDER THE MARK HANG OFF THE SAME MARGIN.

   The identity block ranges right so its contact lines finish where the mark
   finishes — the sheet's own right edge. Two rules narrow that, and the order
   between them is the whole trap:

     @container (max-width: 767px)  ranges it LEFT — stacked, there is no
                                    opposite column to hang off
     @media print                   ranges it RIGHT again

   A4 is ~703px, which is UNDER 767, so PAPER MATCHES THE PHONE unless print
   restates it — and `@media print` adds no specificity, so it only wins by
   coming later in the file. Reorder the two blocks and every printed sheet
   quietly goes back to a ragged right edge, which is the one copy nobody
   re-reads. Read off the stylesheet: jsdom neither cascades nor paginates. */
describe("the identity block hangs off the right margin", () => {
  const at = (re: RegExp): number => {
    const i = css.search(re);
    expect(i).toBeGreaterThan(-1);
    return i;
  };
  const block = (re: RegExp): string => css.slice(at(re)).match(/\{[\s\S]*?\n\}/)![0];

  it("ranges right on a wide sheet", () => {
    expect(css.match(/\.dsd-idc\s*\{[^}]*\}/)![0]).toMatch(/text-align:\s*right/);
  });

  it("ranges left once the masthead stacks, with the rest of the column", () => {
    expect(block(/@container \(max-width: 767px\)/)).toMatch(
      /\.dsd-idc\s*\{\s*text-align:\s*left/
    );
  });

  it("print restates right, AFTER the stacked block — its only way of winning", () => {
    const stacked = at(/@container \(max-width: 767px\)/);
    const print = at(/@media print/);
    expect(print).toBeGreaterThan(stacked);
    expect(css.slice(print)).toMatch(/\.dsd-idc\s*\{\s*text-align:\s*right/);
  });

  it("the initials badge goes with the lines, not against them", () => {
    /* the one child that does not fill the column: left-parked it would be
       the only thing in the block off the margin */
    expect(css.match(/\.dsd-idlogo\.org-initials\s*\{[^}]*\}/)![0]).toMatch(
      /align-self:\s*flex-end/
    );
    expect(block(/@container \(max-width: 767px\)/)).toMatch(
      /\.dsd-idlogo\.org-initials\s*\{\s*align-self:\s*flex-start/
    );
  });
});
