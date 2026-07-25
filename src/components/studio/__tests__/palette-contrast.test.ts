/* Guard for a bug that hid in plain sight: the component palette rendered as
   a BLANK WHITE BOX.

   .ds-pal is a child of .ds-toolrail, and the rail's editing treatment sets
   the inverted ink ramp (--ink:#fff). CSS variables inherit, so the palette's
   labels came out white — on the palette's own white background. Every other
   popover (.ds-menu-pop, .ds-layers-menu, .ds-variant-menu, .ds-sys-menu) is
   restyled dark in editing mode; .ds-pal was simply missing from that list.

   Nobody caught it because the palette also sat BEHIND the canvas, so the
   blank box was invisible until that stacking bug was fixed.

   Asserted against the stylesheet source: jsdom won't resolve inherited
   custom properties through a 200kB sheet, so a render test can't see this.
   The rule is simple enough to state directly — anything inheriting the
   rail's white ink must not keep a white background. */

import { readFileSync } from "fs";
import { join } from "path";

/* comments STRIPPED: the fix's own comment names .ds-pal, and matching that
   made an earlier version of this guard pass against reverted code. Assert
   on the rules, never on the prose about them. */
const css = readFileSync(join(__dirname, "../studio.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

describe("component palette contrast", () => {
  it("is restyled dark in the SAME rule as the other popovers", () => {
    // one rule, one look — a divergent copy is how these drift apart
    const group = css.match(
      /\.dstudio\.editing \.ds-menu-pop,[\s\S]{0,600}?\{[^{}]*background:\s*rgba\(18,\s*20,\s*27[^{}]*\}/
    );
    expect(group).not.toBeNull();
    /* EXACT selector, not a substring: ".ds-pal-anything" contains ".ds-pal"
       and would sail through a toContain check — verified by reverting the
       fix and watching a looser assertion still pass. */
    const exactly = (sel: string) => new RegExp(`\\${sel}(?![\\w-])`);
    expect(group![0]).toMatch(exactly(".ds-pal"));
    for (const sel of [".ds-layers-menu", ".ds-variant-menu", ".ds-sys-menu"]) {
      expect(group![0]).toMatch(exactly(sel));
    }
  });

  it("palette rows get the dark hover, not the light one", () => {
    const hover = css.match(
      /\.dstudio\.editing[^{}]*\.ds-pal-item:hover:not\(:disabled\)[^{}]*\{([^{}]*)\}/
    );
    expect(hover).not.toBeNull();
    expect(hover![1]).toMatch(/background:\s*rgba\(255,\s*255,\s*255/);
  });
});
