/* THE SCREEN'S DENSITY MUST NEVER REACH PAPER, AND MUST NEVER BEAT THE
   NARROW FORMS.

   The sheet was spaced for an A4 page and read on a screen: a two-system
   design ran 3,360px in a 698px panel at 1440, the whole first screen spent on
   the letterhead. The density pass brought it to 2,069px — and it is three
   facts about WHERE the rules sit, none of which a render can show and all of
   which a tidy-up would break without a sound:

     1. Every density rule is inside `@media screen`. Hoisted out of it, the
        same numbers tighten the printed A4, which was spaced on purpose.
     2. The block sits BEFORE the container queries. `@media` adds no
        specificity, so placed after them it would beat the narrow forms where
        they restate a property: the block-form table would get its row padding
        back, and the stacked consumables would flow in columns they have no
        room for.
     3. The wide form gives way at 1023, WITH the table — not at 1100. A 1440
        window hands the document 1,033px, so at 1100 the owner read the narrow
        form every day on a sheet wide enough for the table.

   Read off the stylesheet, because jsdom computes no layout and evaluates no
   container query. */

import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(__dirname, "../sheet-doc.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** the body of the block that opens at `at`, braces balanced */
function blockAt(at: number): string {
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced block");
}

const screenAt = css.indexOf("@media screen");
const printAt = css.indexOf("@media print");
const firstNarrowAt = css.search(/@container\s*\(max-width/);

describe("the screen's density", () => {
  it("lives in one @media screen block", () => {
    expect(screenAt).toBeGreaterThan(-1);
    expect(css.indexOf("@media screen", screenAt + 1)).toBe(-1);
  });

  it("holds every tightened gap inside it, so paper keeps its own", () => {
    const screen = blockAt(screenAt);
    const outside = css.replace(screen, "");
    /* the numbers the pass chose, each of which also exists at paper scale
       outside the block — it is the SCREEN value that must not escape */
    const tightened: [RegExp, string][] = [
      [/\.dsd-sys\s*\{\s*padding-top:\s*32px/, "a system's lead-in"],
      [/\.dsd-rt td\s*\{\s*padding-top:\s*8px/, "a room row"],
      [/\.dsd-grp li\s*\{\s*padding:\s*6px 0/, "a component line"],
      [/\.dsd-pick\s*\{\s*margin-top:\s*48px/, "the picklist's lead-in"],
      [/\.dsd-close\s*\{\s*margin-top:\s*48px/, "the close"],
    ];
    for (const [rule, what] of tightened) {
      expect([what, rule.test(screen)]).toEqual([what, true]);
      expect([what, rule.test(outside)]).toEqual([what, false]);
    }
  });

  it("sits before the narrow forms, which must still win where they restate a property", () => {
    expect(firstNarrowAt).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(firstNarrowAt);
    expect(firstNarrowAt).toBeLessThan(printAt);
  });

  it("flows the consumables only where there is room to", () => {
    /* below 768 the narrow form stacks the groups one to a row; a flex row
       stated outside a min-width query would ignore that grid entirely */
    const screen = blockAt(screenAt);
    const roomy = blockAt(screen.indexOf("@container (min-width: 768px)") + screenAt + "@media screen".length);
    expect(roomy).toMatch(/\.dsd-consum\s*\{\s*display:\s*flex/);
    expect(screen.replace(roomy, "")).not.toMatch(/\.dsd-consum\s*\{[^}]*display:\s*flex/);
  });
});

describe("the wide form", () => {
  it("gives way with the table at 1023, not on the owner's own screen at 1100", () => {
    expect(css).not.toMatch(/@container\s*\(max-width:\s*1100px\)/);
    const folds = [...css.matchAll(/@container\s*\(max-width:\s*1023px\)/g)].map((m) =>
      blockAt(m.index!)
    );
    expect(folds.some((b) => /\.dsd-figs\s*\{\s*grid-template-columns:\s*repeat\(3/.test(b))).toBe(true);
    expect(folds.some((b) => /\.dsd-band\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/.test(b))).toBe(true);
  });
});
