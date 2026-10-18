import fs from "node:fs";
import path from "node:path";

/* ── THE DAY'S ANSWER, AND THE CLOCKS UNDER IT (v2) ──

   This file guarded today's `.mts2-dsw` switch and the clock that dropped
   out of a field. In v2 both are parts: Worked or Off is the Tray (rule 30),
   and Started and Finished are the TimeField, whose wheel portals itself and
   is dressed by the parts' own sheet. What is left for the page to hold is
   what was always true of the screen's own pieces:

   - the two times are two fields with air between them, never one box with
     a seam down it;
   - what is portalled out of `.fg` (the two dialogs) is styled unscoped,
     and restates the button reset `.fg button` would have given it. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim();
}

it("keeps the two times as two separate fields, in the card and in a dialog", () => {
  const times = rule(".fg .ts2-times, .pt-dialog .ts2-times");
  expect(times).toMatch(/display:grid/);
  expect(times).toMatch(/grid-template-columns:1fr 1fr/);
  expect(times).toMatch(/gap:16px/);
});

/* The dialogs portal to <body>, outside `.fg`, so a `.fg`-scoped rule never
   reaches them (the trap the old drop hit first). */
it("does not scope the dialogs' own pieces under .fg", () => {
  expect(CODE).toMatch(/(?:^|\n)\.ts2-dow \.ts2-dowb \{/);
  expect(CODE).not.toMatch(/\.fg \.ts2-(?:form|dow)\b/);
});

it("restates the button reset the portal cannot inherit", () => {
  const b = rule(".ts2-dow .ts2-dowb");
  expect(b).toMatch(/background:var\(--white\)/);
  expect(b).toMatch(/border:1px solid var\(--edge\)/);
  expect(b).toMatch(/font:inherit/);
});

/* A day you normally work is a selection: the light fill, never blue (rule
   17) and never a colour of its own. */
it("fills a chosen day light, as a tray's seat is", () => {
  expect(rule('.ts2-dow .ts2-dowb[aria-pressed="true"]')).toMatch(/background:var\(--sel\)/);
});

/* The old drop and its wheel overrides went with the screen. */
it("keeps the old drop and the side-by-side wheels deleted", () => {
  expect(CODE).not.toMatch(/\.mts2-drop\b/);
  expect(CODE).not.toMatch(/\.mts2-wheels\b/);
  expect(CODE).not.toMatch(/\.mts2-dsw\b/);
});
