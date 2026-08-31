import fs from "node:fs";
import path from "node:path";

/* ── THE WORKBOARD'S THREE SIDES ARE ONE WIDTH ──

   All jobs / Projects / Maintenance were content-sized: 81, 119 and 149px,
   because the labels differ in length and two of the three carry a count.
   Isaac, 2026-08-20: "maintenance is much bigger than projects, and projects
   is bigger than all jobs. I just wanna have an even spacing."

   Equal columns is the only way three different labels come out the same
   width without clipping one, so the tray is a grid whose columns are all
   `1fr` — which sizes every seat to the widest of them. A later tidy-up that
   put `display:flex` back would silently restore the ragged version, and
   nothing else in the suite renders this strip. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

it("gives every side an equal column", () => {
  const seg = rule(".wb2-seg");
  expect(seg).toMatch(/display:grid/);
  expect(seg).toMatch(/grid-auto-flow:column/);
  expect(seg).toMatch(/grid-auto-columns:1fr/);
});

/* `minmax(0,1fr)` would make them equal all the way down by letting every
   label clip at once. The auto minimum is deliberate: under a squeezed header
   the seats give up being equal one at a time instead, and the words survive. */
it("keeps the auto minimum, so a squeezed header loses evenness and not the labels", () => {
  expect(rule(".wb2-seg")).not.toMatch(/minmax\(\s*0/);
});

/* The seat is wider than its label now, so the label has to be centred in it —
   left-aligned text in an equal column puts three labels at three different
   distances from the thumb that slides under them. */
it("centres the label in its seat", () => {
  expect(rule(".wb2-segb")).toMatch(/justify-content:center/);
});
