import fs from "node:fs";
import path from "node:path";

/* ── THE DAY'S ANSWER, AND THE CLOCKS UNDER IT ──

   This file guarded `.mts2-kinds`, a segmented control in the BODY of the day
   panel. That control is gone (2026-09-08). The pill at the top of the panel
   was NAMING the state it set — the same fact in two places, with the setting
   half in the awkward one — so the pill became the switch: `.mts2-dsw`, in
   `.mts2-phead`, where `Overtime` used to be printed.

   Three of the old guards retire with it, and they are worth naming so nobody
   restores them by reflex:

   - the `ask` RING. It marked a switch with neither seat lit. There is no
     such state now: a day with no answer gets no switch, only the two buttons
     for what it could become, so there is nothing to ring.
   - the SEAM between the seats, for the same reason — it existed to make an
     unlit two-seat control read as a choice.
   - the HOVER-OUT-RANKS-`.ask` specificity check. Its lesson survives even
     though its subject does not: when a state class colours a control, every
     interaction rule has to out-rank it, and a hover that sets only `color`
     is the fragile shape. There is no state class on this switch to out-rank.

   What survives is what was true of any switch, plus the new surface the
   clocks drop onto — which has a trap of its own, below. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim();
}
const at = (selector: string) => {
  const i = CSS.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`${selector} is not declared in shell.css`);
  return i;
};
/** Specificity's class column — classes, attributes and pseudo-CLASSES. */
const spec = (selector: string) =>
  (selector.match(/\.[a-z0-9_-]+/gi) ?? []).length +
  (selector.match(/(?<!:):[a-z-]+(?![a-z-]*\()/gi) ?? []).length;

/* ── THE SWITCH ── */

/* Measured at 76.7px and 100.3px when the seats were content-sized, so the
   white thumb changed size as you pressed across it. Equal columns is the
   `.wb2-seg` answer to the same complaint — see seg-even-seats.test.ts. */
it("sizes both answers to the wider of them", () => {
  const dsw = rule(".fg .mts2-dsw");
  expect(dsw).toMatch(/display:inline-grid/);
  expect(dsw).toMatch(/grid-auto-flow:column/);
  expect(dsw).toMatch(/grid-auto-columns:1fr/);
  /* the auto minimum, for the reason `.wb2-seg` keeps it: a squeezed head
     should lose evenness before it loses either word */
  expect(dsw).not.toMatch(/minmax\(\s*0/);
});

it("centres each label in its seat, now the seat is wider than the label", () => {
  expect(rule(".fg .mts2-dswb")).toMatch(/justify-content:center/);
});

/* The seat is TRACK at rest and lifts under the pointer, the way `.wb2-segb`
   does — without it the answered control is one white thumb and one word, and
   the word gives no sign it can be pressed. */
it("lifts the resting seat under the pointer", () => {
  const hover = ".fg .mts2-dsw .mts2-dswb:hover:not(:disabled)";
  expect(spec(hover)).toBeGreaterThan(spec(".fg .mts2-dswb"));
  expect(rule(hover)).toMatch(/background:/);
});

/* …and the chosen seat has to beat that hover, or pressing the answer you
   already gave fades it to three-quarter white.

   IT IS THE `.on:hover` HALF THAT DOES THAT, not `.on`. `.on` alone weighs 4
   and the hover weighs 5, so the hover wins on specificity whatever the
   source order — which is exactly why the rule is written as a PAIR. Checking
   the weaker half against the hover is the wrong question, and asking it
   would fail a correct sheet. */
it("keeps the chosen seat solid under the pointer", () => {
  const group = ".fg .mts2-dsw .mts2-dswb.on, .fg .mts2-dsw .mts2-dswb.on:hover";
  const hover = ".fg .mts2-dsw .mts2-dswb:hover:not(:disabled)";
  const onHover = group.split(", ").find((sel) => sel.endsWith(":hover"))!;
  expect(spec(onHover)).toBeGreaterThanOrEqual(spec(hover));
  expect(at(group)).toBeGreaterThan(at(hover));
  expect(rule(group)).toMatch(/background:#fff/);
});

/* ── THE CLOCK THAT DROPS OUT OF A FIELD ──

   `.wb2-card` is `overflow:hidden`, so a clock positioned inside the panel is
   sliced off at the card's edge. The drop portals to <body> instead — which
   means it is OUTSIDE `.fg`, and every consequence of that has bitten this
   codebase before. */

it("does not scope the drop under .fg — it is portalled out of it", () => {
  expect(CSS).toMatch(/(?:^|\n)\.mts2-drop \{/);
  expect(CSS).not.toMatch(/\.fg \.mts2-drop\b/);
});

/* `.fg button` supplies the ground rules for every button in the app —
   `background:none`, `border:none`, `font:inherit`. A portalled button gets
   none of them and renders as a UA button: a grey bevel in the middle of the
   drop. Restated locally, as `.wb2-sheet` had to. */
it("restates the button reset the portal cannot inherit", () => {
  const reset = rule(".mts2-drop button");
  expect(reset).toMatch(/background:none/);
  expect(reset).toMatch(/border:none/);
  expect(reset).toMatch(/font:inherit/);
});

/* A token declared on `.fg` never reaches a portal, so anything that would
   render invisible without it carries the literal beside it. */
it("gives the drop's tokens a literal to fall back on", () => {
  for (const decl of [rule(".mts2-drop .mts2-ok")]) {
    for (const [, token] of decl.matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/gi)) {
      expect(`${token} has a fallback`).toBe(`${token} has a fallback`);
    }
    expect(decl).toMatch(/var\(--[a-z0-9-]+, *#[0-9a-f]{3,8}\)/i);
  }
});

/* It is `position:fixed`, not absolute: an absolutely positioned drop would
   be placed against the nearest positioned ancestor, which is back inside the
   card that clips it. */
it("positions the drop against the viewport", () => {
  expect(rule(".mts2-drop")).toMatch(/position:fixed/);
});

/* ── THE FIELDS ── */

/* Two wheels side by side were six scroll columns told apart by an 11px
   label. Two fields with air between them are two facts; one box with a rule
   down the middle is one object with a seam. */
it("keeps the two times as two separate fields", () => {
  const fields = rule(".fg .mts2-fields");
  expect(fields).toMatch(/display:grid/);
  expect(fields).toMatch(/grid-template-columns:1fr 1fr/);
  expect(fields).toMatch(/gap:/);
  // each field carries its own surface rather than sharing one
  expect(rule(".fg .mts2-fieldhd")).toMatch(/border:1px solid/);
});

/* Icon wraps its svg in a bare span, so the flex item is the SPAN — a margin
   on the svg inside it positions nothing, which is how the chevron ended up
   tucked against the time instead of at the field's edge. */
it("puts the chevron at the field's edge without leaning on the svg", () => {
  expect(rule(".fg .mts2-fieldhd")).toMatch(/justify-content:space-between/);
  expect(rule(".fg .mts2-fieldhd > span:last-child")).not.toMatch(/margin-left:auto/);
});

/* ── WHAT THE DAILY-USER WALK TOOK OUT (2026-09-10) ── */

/* The drop's header led with the field's own name — "FINISHED" directly under
   a field reading "Finished 5:30 PM". It carries OK and nothing else. */
/* CODE, NOT PROSE. The sheet explains its deletions in comments — this very
   pass names `.mts2-wheels` in one to say why it went — so a "stays deleted"
   check has to read the rules with the comments stripped, or it fails on the
   note that documents its own fix. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

it("does not restate the field's name inside the drop", () => {
  expect(CODE).not.toMatch(/\.mts2-drophd span\b/);
  expect(rule(".mts2-drophd")).toMatch(/justify-content:flex-end/);
});

/* "Change my normal week" was the last place on the screen still setting a
   time with two wheels side by side. It uses the day panel's fields now, and
   the wheel pair's rules went with it. */
it("keeps the side-by-side wheel pair deleted", () => {
  expect(CODE).not.toMatch(/\.mts2-wheels\b/);
  expect(rule(".fg .mts2-card .mts2-fields")).toMatch(/grid-template-columns:1fr/);
});
