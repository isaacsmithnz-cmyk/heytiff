/* Guards for three cascade bugs that made the Summary sheet look broken while
   every test stayed green — because none of them is visible to jsdom, which
   does not resolve inherited custom properties or specificity through a 240kB
   stylesheet. They are stated against the SOURCE instead.

   1. `.dstudio .ds-job` was declared twice: once for a topbar job pill
      (`font: 700 10.5px`, `white-space: nowrap`, a 999px radius) and once for
      the Summary sheet's root. Same selector, same specificity, so the sheet
      inherited the pill's typography — every table cell came out 700, which
      made the model-column and quantity-column emphasis rules no-ops.
      The pill had no consumer left at all; it was deleted.

   2. `.ds-tbbtn` sat in the `.dstudio.editing` GLASS block with the genuinely
      dark chrome. Its only consumers render on the white page plate, where a
      white 7% fill and a white 12% border are invisible and a 40%-black glass
      shadow drew the entire button — and its hover was invisible too.

   3. `.ds-mat-table td` now states the body weight, which is (0,2,1). A bare
      `.ds-mat-model` is (0,2,0) and would silently lose to it, so the model
      column must be selected as `td.ds-mat-model`. This is the same shape as
      the `.fg button` reset trap: an element in the selector outranks a lone
      class.

   Each assertion was validated by reverting its fix and watching it fail. */

import { readFileSync } from "fs";
import { join } from "path";

/* comments stripped: the fixes' own comments NAME the things being asserted
   against, so a substring match would pass on reverted code */
const css = readFileSync(join(__dirname, "../studio.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** every selector that opens a rule block, flattened one per line */
const selectors = css
  .split("}")
  .map((block) => block.slice(block.lastIndexOf("{") === -1 ? 0 : 0))
  .flatMap((block) => {
    const i = block.indexOf("{");
    return i === -1 ? [] : [block.slice(0, i).replace(/\s+/g, " ").trim()];
  })
  .filter(Boolean);

describe("Summary sheet cascade", () => {
  it("no rule targets a bare .ds-job — the sheet must not inherit a pill", () => {
    /* `.ds-job-form` and friends are fine; a BARE `.ds-job` is the collision.
       Matched on the selector list rather than the raw text so that
       `.ds-job-fields` can never satisfy it. */
    const bare = selectors.filter((sel) =>
      sel.split(",").some((s) => /\.ds-job(?![\w-])/.test(s))
    );
    expect(bare).toEqual([]);
  });

  it("the New design landing owns .ds-hero alone", () => {
    /* The same collision as `.ds-job`, one class along, and it shipped: the
       sheet's cover was written as `.ds-hero`, which the landing already owns
       at the identical specificity (0,2,0). The later rule won, so the LANDING
       — not the sheet — became a `1fr 340px` grid wearing the sheet's ink and
       shadow: badge and pitch in one column, the clamp(38px,4.4vw,58px) title
       wrapped into the other. The sheet's cover is `.ds-cover`.

       Only rules that TARGET the hero itself count: `.ds-hero h2` and
       `.ds-hero p` style its children and cannot collide with another root.
       `ds-hero-badge` and the rest are excluded by the word boundary. */
    const targeted = selectors.filter((sel) =>
      sel.split(",").some((s) => /\.ds-hero(?![\w-])[^ >+~]*$/.test(s.trim()))
    );
    expect(targeted).toEqual([".dstudio .ds-hero"]);
  });

  it("the Summary cover is a grid, and the landing hero is not", () => {
    /* States the shape the collision inverted, so a future re-merge of the two
       fails here rather than on the landing page in production. */
    expect(css).toMatch(
      /\.dstudio \.ds-cover \{[^}]*grid-template-columns:\s*1fr 340px/
    );
    const hero = css.match(/\.dstudio \.ds-hero \{[^}]*\}/);
    expect(hero).not.toBeNull();
    expect(hero![0]).not.toMatch(/grid-template-columns/);
    expect(hero![0]).toMatch(/display:\s*flex/);
  });

  it("the Summary root is styled by its own class", () => {
    const root = selectors.filter((s) => /\.ds-summary(?![\w-])/.test(s));
    expect(root.length).toBeGreaterThan(0);
  });

  it("the dark glass primitives never reach .ds-tbbtn", () => {
    /* .ds-tbbtn renders on the WHITE page plate — Summary's action cards and
       the Design step's "no floors yet" empty state. Any `.dstudio.editing`
       rule that paints it glass is the leak coming back. */
    const glassy = selectors.filter(
      (sel) =>
        sel.includes(".dstudio.editing") &&
        sel.split(",").some((s) => /\.ds-tbbtn(?![\w-])/.test(s))
    );
    expect(glassy).toEqual([]);
  });

  it("the model column outranks the table's body weight", () => {
    /* `.dstudio .ds-mat-table td` is (0,2,1); the emphasis rule must carry an
       element too or it loses. */
    const emphasis = selectors.filter((s) => s.includes(".ds-mat-model"));
    expect(emphasis.length).toBeGreaterThan(0);
    for (const sel of emphasis) {
      expect(sel).toMatch(/td\.ds-mat-model/);
    }
  });

  it("the table states a body weight, so emphasis rules mean something", () => {
    const body = css.match(
      /\.dstudio \.ds-mat-table td \{[^}]*font-weight:\s*500/
    );
    expect(body).not.toBeNull();
  });
});
