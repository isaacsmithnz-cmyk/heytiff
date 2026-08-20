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

   The third of these was about the sheet's own table (`.ds-mat-table`), and
   that table has moved out with the rest of the document — its guards moved
   with it, to sheet-doc-cascade.test.ts. What is left here is studio.css's:
   the collisions between the Summary step's chrome and the rest of the
   editor, which is what this file is now for.

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

  it("the landing hero stays a flex column, and the ink cover stays dead", () => {
    /* The 2026-08-16 document redesign DELETED the ink cover, and the
       document itself has since moved to sheet-doc.css. A returning
       `.ds-cover` rule means someone resurrected the old sheet (or its name),
       which is exactly how the .ds-hero collision shipped. The landing hero
       must also stay a flex column — the collision's symptom was it becoming
       the cover's grid. */
    const coverish = selectors.filter((sel) =>
      sel.split(",").some((s) => /\.ds-cover(?![\w-])/.test(s))
    );
    expect(coverish).toEqual([]);
    const hero = css.match(/\.dstudio \.ds-hero \{[^}]*\}/);
    expect(hero).not.toBeNull();
    expect(hero![0]).not.toMatch(/grid-template-columns/);
    expect(hero![0]).toMatch(/display:\s*flex/);
  });

  it("the Summary root is styled by its own class", () => {
    const root = selectors.filter((s) => /\.ds-summary(?![\w-])/.test(s));
    expect(root.length).toBeGreaterThan(0);
  });

  it("PRINT HIDES THE PAGE ONLY WHEN THERE IS A PRINT DOCUMENT TO REVEAL", () => {
    /* FOUND IN PRODUCTION, on the customer's own link.

       The print block hides everything and reveals `#ds-printdoc`, which is
       right for the studio's Export. But this stylesheet is imported by more
       than the studio — `/live/[token]` pulls it in for the dead-link dress
       and the simulation viewer — and that page never mounts a print
       document. A bare `body *` therefore hid every element on the customer's
       sheet and revealed nothing: THE PRINT BUTTON PRODUCED A BLANK PAGE.

       Invisible to every other check. jsdom has no print medium, the rule is
       valid CSS, and no screen rendering of any page shows it. */
    const hide = css.match(/@media print \{[\s\S]*?visibility:\s*hidden[^;]*;/);
    expect(hide).not.toBeNull();
    /* SELECTS THE SIBLINGS, not everything-then-reveal. Scoping the old bare
       `body *` as `body:has(#ds-printdoc) *` fixed the customer's blank page
       and broke the studio's own print, because `:has()` CONTRIBUTES ITS
       ARGUMENT'S SPECIFICITY — the hide became (1,0,1) and out-ranked the
       (1,0,0) reveal it was paired with, both `!important`, so the print
       document hid itself. A blank PDF, found by rendering one. */
    expect(hide![0]).toMatch(/body:has\(#ds-printdoc\) > \*:not\(#ds-printdoc\)/);
    /* the bare form must not come back under any selector */
    const bare = selectors.filter((sel) =>
      sel.split(",").some((one) => /^body \*$/.test(one.trim()))
    );
    expect(bare).toEqual([]);
    /* and there must be no hide/reveal pair to lose a specificity race with:
       nothing inside the print document is hidden, so nothing needs revealing */
    expect(css).not.toMatch(/#ds-printdoc \*\s*\{[^}]*visibility:\s*visible/);
  });

  it("the recents skeleton PAINTS — its block outranks the card it sits in", () => {
    /* `.ds-rthumb` carries its own fill and border at (0,2,0) and is written
       LATER in this file, so a lone `.dstudio .ds-skb` loses to it and the
       thumb animated an empty box: a sweep over nothing. Same shape as the
       `.fg button` reset trap. The paint is one declaration block written at
       both specificities rather than restated. */
    const paint = selectors.filter((sel) =>
      sel.split(",").some((one) => /\.ds-skb(?![\w-])\s*$/.test(one.trim()))
    );
    expect(paint.length).toBeGreaterThan(0);
    for (const sel of paint)
      expect(sel).toMatch(/\.ds-rcard\.skel \.ds-rthumb\.ds-skb/);
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
});
