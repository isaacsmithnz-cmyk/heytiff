import { readFileSync } from "fs";
import { join } from "path";

/* SAVE HAS TO BE REACHABLE.

   The Journal panel pins itself and hands scrolling to `.hm-jscroll`, so the
   debrief BAR stays put while the record scrolls under it (#370). That is
   right for a bar. It is wrong the moment the bar becomes the capture card:
   open, the debrief is the panel's content, and at the review stage it is
   several times the panel's height — so a pinned panel puts `Save these`
   below the visible area with `overflow:hidden` and no way to scroll to it.

   Measured on the shipped build before this fix: 1,680px of card in a 346px
   panel, the button 1,061px out of reach. You could capture, press Go, read
   the review and be unable to save it.

   NOBODY WROTE THAT BUG. The inline debrief (#360) and the Home card's height
   rework (#370) landed a day apart and neither knew about the other — which
   is exactly the kind of thing no test in this repo could see, because jsdom
   performs no layout and lightningcss happily parses both rules. So this
   guards the RELATIONSHIP: if the panel is ever pinned again, the
   debrief-is-open case has to keep its own way out.

   Comments are stripped first — the paragraph you are reading names both
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

describe("the open debrief", () => {
  it("is only pinned while it is a bar", () => {
    // the pin exists — if this ever stops being true the rest is moot
    const pinned = declarationsFor((s) => s.includes(".hm-panel") && s.includes(":has(> .hm-jscroll)"));
    expect(pinned).toMatch(/overflow\s*:\s*hidden/);

    // …and the open card undoes it
    const open = declarationsFor((s) => s.includes(".hm-panel") && s.includes(":has(.hm-cap)"));
    expect(open).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("hands the day list's scroller back while it is open", () => {
    /* Two scrollers inside one another is how you get a card that scrolls the
       wrong list under your finger; the fade belongs to a scroller too. */
    const inner = declarationsFor(
      (s) => s.includes(":has(.hm-cap)") && s.includes(".hm-jscroll"),
    );
    expect(inner).toMatch(/overflow\s*:\s*visible/);
    expect(inner).toMatch(/mask-image\s*:\s*none/);
  });
});
