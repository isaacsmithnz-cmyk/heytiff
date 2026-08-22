import fs from "node:fs";
import path from "node:path";

/* A TAB SWITCH MOVES THE THUMB AND NOTHING ELSE.

   Every card switcher in the app shares one strip, and for a while they did
   not share one behaviour: six screens wore `.psec2` on their panel, which was
   `animation:fgUp .4s backwards` — the face started at opacity 0 and rose 12px
   into place on every click. Isaac, comparing two of them side by side: "the
   team one is static and slides nicely. timesheet and time and pay flash the
   content below each switch."

   The component-level guards (same panel node, no fade class) live beside
   their screens. This one covers the two that KEEP the class — Organisation
   and the staff card — because `.psec2` is also a styling hook there (`:focus`,
   `.pdl`, `.pdnone`, `.liccards` all hang off it), so the fade had to come off
   the stylesheet rather than the markup. Asserting on the sheet is the only
   way to hold that. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
// comments carry the history and name the animation; only rules matter here
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block whose selector list mentions `sel`. */
function blocksFor(sel: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(RULES))) {
    if (m[1].includes(sel)) out.push(m[2]);
  }
  return out;
}

describe("the tab panel does not animate", () => {
  it("`.psec2` carries no animation — the panel appears, it does not arrive", () => {
    const blocks = blocksFor(".psec2");
    // the class still exists: it styles focus and three descendants
    expect(blocks.length).toBeGreaterThan(0);
    for (const body of blocks) {
      expect(body).not.toMatch(/(^|[^-])animation\s*:/);
    }
  });

  /* The panel of a screen that switches on the client must not be a direct
     child of `.stg` either — that selector fades its children on page entry,
     which is right for a page load and wrong for a tab click. The shells put
     the panel there deliberately (it is the third child, after the heading and
     the strip), so what saves them is that the node is never remounted; this
     pins the animation to the page-entry scope it belongs to. */
  it("the staggered entrance stays scoped to a page that is entering", () => {
    const staggered = RULES.match(/\.fg \.page\.in \.stg > \*[^{]*\{[^}]*\}/g) ?? [];
    expect(staggered.length).toBeGreaterThan(0);
    for (const rule of staggered) {
      expect(rule).toMatch(/\.page\.in/);
    }
  });
});
