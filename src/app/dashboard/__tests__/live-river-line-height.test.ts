import fs from "node:fs";
import path from "node:path";

/* ── THE RIVER'S LINE HEIGHT IS THE PAGE'S, AND MUST STAY UNWRITTEN ──

   `.wb2-lwbox.one` is the one-line field mic: a paragraph standing in for an
   <input> while the words arrive. It has to be exactly as tall as the field
   it replaces, or the row it lives in twitches at the first word — the exact
   jump the river exists to remove.

   It shipped for one release with `line-height:normal`, on the reasoning that
   `normal` is what an <input> uses. On a bare harness page that is true and
   the boxes agreed to the pixel. On the REAL sheet it is not: `line-height`
   is INHERITED, `.fg` sets 1.5, and an <input> takes it like anything else —
   20.25px in the strip, 19.5px on `.wb2-fi`. The declaration made the
   paragraph 3px shorter than the field, and only a walk on prod found it.

   So this is a stylesheet-text guard, like the others in this folder: it
   cannot measure a line box, but it can hold the shape of the rule that was
   wrong. The block posture is the same fact from the other side — `1lh` asks
   for whatever line box this element HAS rather than naming one, which is why
   that posture survived the mistake untouched. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

/** The body of one rule, by its exact selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

it("does not name a line height on the one-line river", () => {
  expect(rule(".wb2-lwbox.one")).not.toMatch(/line-height/);
});

it("sizes the block river in `lh`, not in a length it has guessed", () => {
  /* `calc(var(--lwrows) * 1lh + 26px)`. A hard px-per-line here would be the
     same mistake wearing a number: it would be right until the page's
     typography moved under it. */
  expect(rule(".wb2-notes.wb2-lwbox")).toMatch(/height:calc\(var\(--lwrows\) \* 1lh/);
});
