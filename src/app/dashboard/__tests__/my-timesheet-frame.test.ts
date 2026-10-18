import fs from "node:fs";
import path from "node:path";

/* ── THE FRAME AROUND YOUR TIMESHEET (v2, the board 6-timesheet) ──

   The week on the left, the open day's card on the right at 400, and the
   reference (the key, the pay rules, the month's holidays) under the week.
   What the old `.mts2-*` guards held, held again for the `.ts2-*` page:
   the day column hugs its own content, the rules are labels and values on
   the type floor under a hairline, and the page goes to one column when it
   can't hold two. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
/** The rules with the comments stripped, so a note about a deletion can't
    fail a "stays deleted" check. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim();
}

/* The card is as tall as its day, and the week as tall as its rows: two
   columns that start together and never stretch each other. */
it("sets the week beside a 400 card, each as tall as itself", () => {
  const cols = rule(".fg .ts2-cols");
  expect(cols).toMatch(/grid-template-columns:minmax\(0,1fr\) 400px/);
  expect(cols).toMatch(/align-items:start/);
});

it("puts the card under the week when the page can't hold both", () => {
  const stacked = CODE.match(/@media \(max-width:1100px\) \{\s*\.fg \.ts2-cols \{([^}]*)\}/);
  expect(stacked?.[1]).toMatch(/grid-template-columns:minmax\(0,1fr\)/);
});

/* The pay rules are labels and values, a group under a hairline, on the
   type floor's 13 for labels: never a line of dot-joined fragments. */
it("sets the pay rules as labels and values, under a hairline", () => {
  const rules = rule(".fg .ts2-rules");
  expect(rules).toMatch(/display:grid/);
  expect(rules).toMatch(/font-size:13px/);
  expect(rule(".fg .ts2-rules > div")).toMatch(/display:contents/);
  expect(rule(".fg .ts2-ref")).toMatch(/border-top:1px solid var\(--line\)/);
});

/* The head and the rows share their columns, so a time lines up under
   "Times" and an hour under "Hours". */
it("lays every row of the week, the head included, on one set of columns", () => {
  expect(rule(".fg .ts2-table")).toMatch(/--ts2-cols:/);
  expect(rule(".fg .ts2-day")).toMatch(/grid-template-columns:var\(--ts2-cols\)/);
  expect(rule(".fg .ts2-num")).toMatch(/font-variant-numeric:tabular-nums/);
});

/* Rule 21: no bars and no tints. A day is a dot or a small white card,
   and the open day is the selection's fill, never a coloured edge. */
it("draws a day away as a white card, and the open day as a fill", () => {
  expect(rule(".fg .ts2-away")).toMatch(/background:var\(--white\)/);
  expect(rule(".fg button.ts2-day.ts2-day--on")).toMatch(/background:var\(--sel\)/);
  expect(CODE).not.toMatch(/\.ts2-[a-z-]+[^{]*\{[^}]*border-left:[^}]*\}/);
});

/* One big figure per screen (rule 14): what the week comes to. */
it("has one 32 on the page, the week's payroll hours", () => {
  const ts2 = CODE.slice(CODE.indexOf(".fg .wrap.ts2 {"));
  expect(ts2.match(/font-size:32px/g)).toHaveLength(1);
  expect(rule(".fg .ts2-big-v")).toMatch(/font-size:32px/);
});

/* The old screen's frame is gone with it. */
it("keeps the old my-timesheet sheet deleted", () => {
  expect(CODE).not.toMatch(/\.mts2/);
  expect(CODE).not.toMatch(/mtsDrop/);
});
