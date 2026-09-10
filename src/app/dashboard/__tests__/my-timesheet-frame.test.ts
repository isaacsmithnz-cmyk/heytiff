import fs from "node:fs";
import path from "node:path";

/* ── THE FRAME AROUND MY TIMESHEET ──

   What a signed-in walk of the live screen found on 2026-09-10 that jsdom
   could not see: ~130px of air under the day panel whenever the rail grew,
   the pay rules in an 11.5px grey line under the holiday card, and a clock
   that ran off the foot of the window from My normal week. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
/** The rules with the comments stripped — the sheet explains its deletions in
    prose, and a "stays deleted" check must not fail on the note about it. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim();
}

/* The rail spans both rows, and a spanning item taller than the rows it
   crosses shares its extra height out between them — so the week's row grew
   whenever My normal week opened. A flexible second row takes the slack. */
it("gives the rail's extra height to the reference row, not to the week", () => {
  expect(rule(".fg .mts2-cols")).toMatch(/grid-template-rows:auto 1fr/);
});

it("puts the one-column layout back on plain rows", () => {
  const stacked = CODE.match(/@media \(max-width:960px\)\{\s*\.fg \.mts2-cols \{([^}]*)\}/);
  expect(stacked?.[1]).toMatch(/grid-template-rows:none/);
});

/* "Give that more of a structure." The rules were one grey 11.5px line of
   middot-joined fragments. They are labels and values now, in the week's
   card under the payroll figures — a group you read, so a hairline and no
   box (docs/design.md), on the type floor. */
it("sets the pay rules as labels and values on the type floor, under a hairline", () => {
  const rules = rule(".fg .mts2-rules");
  expect(rules).toMatch(/display:grid/);
  expect(rules).toMatch(/border-top:1px solid var\(--line\)/);
  expect(rules).toMatch(/font-size:12px/);
  expect(rule(".fg .mts2-rules > div")).toMatch(/display:contents/);
  expect(CODE).not.toMatch(/\.mts2-rules[^{]*\{[^}]*font-size:11\.5px/);
  // and nothing places them in the reference row any more
  expect(CODE).not.toMatch(/\.mts2-ref > \.mts2-rules/);
});

/* A clock that opens upward grows out of its field, not away from it. */
it("grows a clock that opens upward from its foot", () => {
  const up = rule(".mts2-drop.up");
  expect(up).toMatch(/transform-origin:bottom center/);
  expect(up).toMatch(/animation-name:mtsDropUp/);
  expect(CSS).toMatch(/@keyframes mtsDropUp \{ from \{ opacity:0; transform:translateY\(6px\)/);
});
