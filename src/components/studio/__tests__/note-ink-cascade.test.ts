/* Guard for the note-ink swatches' place in the cascade (found in the harness,
   2026-08-25).

   The Note flyout is a `.ds-roomfly` wearing a second class, and `.ds-roomfly`
   is built for MENUS: a column of full-width rows with a 150px floor. Eight
   round swatches need the opposite of all three, and every one of those
   overrides is an EQUAL-SPECIFICITY fight (two classes against two classes) —
   which nothing but source order decides.

   Written where the rest of the note styles live, ~5,000 lines earlier in the
   file, the whole block parsed, validated, matched its element and did
   NOTHING: the swatches stacked into a tower and the first probe measured them
   138×22. The same class of silent failure as a `@media` block placed above
   the rules it overrides.

   Two things are therefore pinned here, and only a filesystem test can pin
   either: jest never renders CSS, lightningcss parses both orders happily, and
   jsdom cannot resolve this through a 260kB sheet. If the sheet is ever
   reorganised, this fails rather than the swatches quietly stacking again. */

import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(__dirname, "../studio.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

const at = (selector: string) => {
  const i = css.indexOf(selector);
  expect(i).toBeGreaterThan(-1);
  return i;
};

describe("note ink swatches win their cascade", () => {
  it("declares .ds-notefly AFTER the .ds-roomfly it overrides", () => {
    expect(at(".ds-notefly {")).toBeGreaterThan(at(".ds-roomfly {"));
  });

  it("undoes all three of the menu flyout's column habits", () => {
    const block = css.slice(at(".ds-notefly {"), at(".ds-notefly {") + 260);
    // a row, not a column; no 150px floor to wrap eight swatches against
    expect(block).toMatch(/flex-direction:\s*row/);
    expect(block).toMatch(/min-width:\s*0/);
  });

  /* `.dstudio .ds-roomfly button` is (0,2,1) and beats any two-class rule, so
     the swatch geometry has to be named THROUGH the flyout to survive inside
     it — width, padding and corner are the three it takes. */
  it("restates the three properties .ds-roomfly button would steal", () => {
    const i = at(".ds-notefly .ds-note-ink {");
    const block = css.slice(i, i + 200);
    expect(block).toMatch(/width:\s*22px/);
    expect(block).toMatch(/padding:\s*0/);
    expect(block).toMatch(/border-radius:\s*50%/);
  });

  /* the swatch is a circle everywhere, so the base rule must survive the
     `.fg button` reset family — which does NOT reset padding */
  it("zeroes the UA button padding on the base swatch rule", () => {
    const i = at(".ds-note-ink {");
    expect(css.slice(i, i + 260)).toMatch(/padding:\s*0/);
  });
});
