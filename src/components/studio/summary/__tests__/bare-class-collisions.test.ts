/* THE SHEET RENDERS INSIDE `.fg`, AND `.fg` OWNS A LOT OF SHORT NAMES.

   The design sheet is drawn on the owner's Summary step and on paper, both of
   which sit inside the dashboard shell — so every `.fg <name>` rule in
   shell.css can reach it. Most of this document's classes are prefixed `dsd-`
   and are safe by construction, but the rooms table's cells are short bare
   words (`rm`, `mdl`, `sty`, `num`), and one of them collided:

     shell.css  .fg .odu { padding:24px; border-radius:24px; background:#f9fafb;
                           border:1px solid #f3f4f6; box-shadow:inset … }

   — an unrelated outdoor-unit CARD from the workboard. `.dsd-rt td.odu` is
   heavier, so the three properties the sheet restates (weight, colour, wrap)
   came out right and everything it does NOT restate came through: every
   Outdoor cell in the rooms table was drawn as a padded grey card, at over
   twice the row height, in a column down the middle of a printed table. It
   survived because a collision that only ADDS paint looks deliberate.

   This is the second time the same shell rule has hit the studio (studio.css
   ~1952 records it landing on the canvas legend), so it is worth a guard
   rather than a third rename. Cheap to satisfy: prefix the class.

   NOT A RENDER TEST ON PURPOSE — jsdom neither loads nor cascades these
   stylesheets, and the collision is a cascade fact. Read the sheet and the
   markup off disk and compare names, the same shape as the contrast guards. */

import { readFileSync } from "fs";
import { join } from "path";

const SHELL = readFileSync(
  join(__dirname, "../../../../app/dashboard/shell.css"),
  "utf8"
);

/** every class shell.css styles as a DESCENDANT of `.fg` — the set that can
    reach anything the dashboard renders */
function shellDescendantClasses(): Set<string> {
  const out = new Set<string>();
  for (const m of SHELL.matchAll(/\.fg\s+\.([\w-]+)/g)) out.add(m[1]);
  return out;
}

/** every class name written into a `className` in the given component, minus
    the ones prefixed to be unique */
function bareClasses(file: string): Set<string> {
  const src = readFileSync(join(__dirname, "..", file), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/className=\{?[`"]([^`"]+)[`"]/g)) {
    for (const raw of m[1].split(/[\s${}]+/)) {
      const c = raw.trim();
      // template holes leave fragments; keep plain, whole class names only
      if (/^[a-z][\w-]*$/.test(c) && !c.startsWith("dsd")) out.add(c);
    }
  }
  return out;
}

describe("the sheet's bare class names never meet a .fg rule", () => {
  const shell = shellDescendantClasses();

  it.each(["sheet-doc.tsx", "sheet-tables.tsx"])(
    "%s",
    (file) => {
      const collisions = [...bareClasses(file)].filter((c) => shell.has(c));
      expect(collisions).toEqual([]);
    }
  );

  /* the guard is only worth its line if it would have caught the real one */
  it("would have caught `.odu` — the collision it was written for", () => {
    expect(shell.has("odu")).toBe(true);
  });
});
