import { readFileSync } from "fs";
import { join } from "path";

/* SAVE HAS TO BE REACHABLE.

   Home's list column keeps its head still and hands scrolling to the rows
   under it. That is right for a list. It is wrong the moment the composer in
   that head becomes the capture card: open, the card is the column's
   content, and at the review stage it is several times the column's height
   — so a scroller that stayed on the rows would put `Save these` below the
   visible area with no way to scroll to it.

   The first time this shape shipped (#360 × #370, on the old card) it was
   measured on the build: 1,680px of card in a 346px panel, the button
   1,061px out of reach. You could capture, press Go, read the review and be
   unable to save it. NOBODY WROTE THAT BUG: two changes landed a day apart
   and neither knew about the other — which is exactly the kind of thing no
   test in this repo could see, because jsdom performs no layout and
   lightningcss happily parses both rules. So this guards the RELATIONSHIP:
   while the card is open, the column scrolls as a whole and the rows give
   their scroller up.

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

describe("the open capture card in Home's list column", () => {
  it("is only pinned while it is a row", () => {
    // the rows scroll on their own — if this ever stops being true the rest is moot
    const rows = declarationsFor((s) => s === ".fg .hm-rows");
    expect(rows).toMatch(/overflow-y\s*:\s*auto/);
    // …and the open card makes the whole column the scroller
    const open = declarationsFor((s) => s.includes(".hm-list:has(.hm-cap)") && !s.includes(".hm-rows"));
    expect(open).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("hands the rows' scroller back while it is open", () => {
    /* Two scrollers inside one another is how you get a card that scrolls the
       wrong list under your finger. */
    const inner = declarationsFor((s) => s.includes(".hm-list:has(.hm-cap)") && s.includes(".hm-rows"));
    expect(inner).toMatch(/overflow\s*:\s*visible/);
    expect(inner).toMatch(/flex\s*:\s*none/);
  });

  it("stands the card in the column rather than over the page", () => {
    const cap = declarationsFor((s) => s === ".fg .hm-cap");
    expect(cap).toMatch(/position\s*:\s*static/);
    expect(cap).toMatch(/max-height\s*:\s*none/);
    expect(cap).toMatch(/box-shadow\s*:\s*none/);
  });
});
