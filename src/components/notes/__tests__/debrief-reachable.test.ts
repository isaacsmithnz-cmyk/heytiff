import { readFileSync } from "fs";
import { join } from "path";

/* SAVE HAS TO BE REACHABLE.

   The capture card, opened in place of the entry row, is several times its
   row's height at the review stage — so a card pinned over the page, or
   clipped to a row, would put `Save these` below the visible area with no
   way to scroll to it.

   The first time this shape shipped (#360 × #370, on the old card) it was
   measured on the build: 1,680px of card in a 346px panel, the button
   1,061px out of reach. NOBODY WROTE THAT BUG: two changes landed a day
   apart and neither knew about the other — which is exactly the kind of
   thing no test in this repo could see, because jsdom performs no layout
   and lightningcss happily parses both rules.

   The old Home's list column, which handed its scroller to the open card,
   went with that Home (2026-09-26), and its two rules with it. What is left
   is the card's own: it stands where it is drawn rather than over the page.

   Comments are stripped first — the paragraph you are reading names the
   selectors, and a scan that matched its own prose would pass on an empty
   stylesheet. */

const CSS = join(__dirname, "..", "..", "..", "app", "dashboard", "shell.css");
const code = () => readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the rule whose selector matches, joined. */
function declarationsFor(test: (selector: string) => boolean): string {
  let out = "";
  for (const m of code().matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (test(m[1].trim().replace(/\s+/g, " "))) out += m[2] + ";";
  }
  return out;
}

describe("the open capture card", () => {
  it("stands the card where it is drawn rather than over the page", () => {
    const cap = declarationsFor((s) => s === ".fg .hm-cap");
    expect(cap).toMatch(/position\s*:\s*static/);
    expect(cap).toMatch(/max-height\s*:\s*none/);
    expect(cap).toMatch(/box-shadow\s*:\s*none/);
  });
});
