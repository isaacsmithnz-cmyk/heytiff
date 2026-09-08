import fs from "node:fs";
import path from "node:path";

/* ── WORKED / NOT WORKED READ AS ONE BUTTON ──

   Isaac, 2026-09-08: "fix up the worked not worked button on time sheet" —
   singular, which is the finding. It is two seats of one switch and it read
   as a single object with two words on it.

   Three separate causes, measured in a browser against the real sheet, and
   each is guarded here as a PROPERTY rather than as the value that fixed it,
   so re-tuning either side re-checks the whole thing:

   1. the tray was the same value as the panel it sat on, so there was no tray
   2. the seats were content-sized, so the two answers were different objects
   3. the ask colour out-ranked the hover colour, so the unanswered control —
      the one state the panel is waiting on a press in — was the only one that
      never acknowledged the pointer

   The last is the one a reader can't see: it is pure cascade, it was valid
   CSS, and no amount of looking at the rules in isolation shows it. See
   [[project-css-never-validated-locally]]. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

/** One rule's declarations, by its exact selector. Multi-line rules included. */
function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim();
}
/** Where a selector's rule sits in the sheet — the tie-breaker when two rules
    weigh the same. */
const at = (selector: string) => {
  const i = CSS.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`${selector} is not declared in shell.css`);
  return i;
};

/** Specificity's class column: classes, attributes and pseudo-CLASSES, which
    is the only column any of these selectors uses. `::before` is a pseudo-
    ELEMENT and counts in a different column, so it is excluded. */
const spec = (selector: string) =>
  (selector.match(/\.[a-z0-9_-]+/gi) ?? []).length +
  (selector.match(/(?<!:):[a-z-]+(?![a-z-]*\()/gi) ?? []).length;

const KINDS = ".fg .mts2-kinds";
const KIND = ".fg .mts2-kind";
const HOVER = ".fg .mts2-kinds .mts2-kind:hover";
const ASK_INK = ".fg .mts2-kinds.ask .mts2-kind";
const ASK_HOVER = ".fg .mts2-kinds.ask .mts2-kind:hover";
const ON = ".fg .mts2-kinds .mts2-kind.on, .fg .mts2-kinds .mts2-kind.on:hover";

/* ── 1. THERE IS A TRAY ──

   The old track was #f4f5f7 sitting inside `.mts2-panel`, whose rgba(5,5,5,
   .03) over the card composites to #f8f8f8: a ratio of 1.027, which is
   nothing. So at rest the control was two words on the panel with no shape
   around them, and the moment one was chosen the white pill under it became
   the only shape in the control — one button, with a word beside it.

   THE ASSERTION LIVES IN segmented-tray-contrast.test.ts, with every other
   tray in the app. It moved there when the same sweep found four more
   controls at or below the line: a law that applies to all of them should not
   be stated once per control, or the next one gets written without it. */

/* ── 2. THE TWO ANSWERS ARE ONE SIZE ──

   Measured at 76.7px and 100.3px, so the white pill changed size as you
   pressed across it. Equal columns is the `.wb2-seg` answer to the same
   complaint — see seg-even-seats.test.ts — and it is the only way two labels
   of different lengths come out the same width without clipping one. */
it("sizes both answers to the wider of them", () => {
  const kinds = rule(KINDS);
  expect(kinds).toMatch(/display:inline-grid/);
  expect(kinds).toMatch(/grid-auto-flow:column/);
  expect(kinds).toMatch(/grid-auto-columns:1fr/);
  /* the auto minimum, for the reason `.wb2-seg` keeps it: a squeezed panel
     should lose evenness before it loses either word */
  expect(kinds).not.toMatch(/minmax\(\s*0/);
});

it("centres each label in its seat, now the seat is wider than the label", () => {
  expect(rule(KIND)).toMatch(/justify-content:center/);
});

/* ── 3. THE POINTER IS ACKNOWLEDGED IN EVERY STATE, THE ASK ONE INCLUDED ──

   `.fg .mts2-kinds.ask .mts2-kind` weighs 4 and the hover rule was `.fg
   .mts2-kind:hover`, which weighs 3 — so the unanswered control, the one
   moment the panel is waiting for a press, was the only state where nothing
   happened under the pointer.

   THE GUARD IS THE ASK-SCOPED HOVER, not the plain one. A hover rule that
   merely ties with the ask colour is decided by source order, which is the
   kind of thing a tidy-up moves without noticing; a rule scoped to `.ask`
   itself weighs more than the ask colour can and cannot be reordered out of
   effect. It also has to keep the amber — inheriting the plain hover's ink
   would drop a seat out of the state it is announcing, mid-press. */
it("acknowledges the pointer in the state that is asking", () => {
  expect(spec(ASK_HOVER)).toBeGreaterThan(spec(ASK_INK));
  expect(rule(ASK_HOVER)).toMatch(/background:/);
  expect(rule(ASK_HOVER)).toMatch(/color:var\(--warn-t\)/);
});

/* …and in the ordinary one. The seat is TRACK at rest and lifts under the
   pointer, the way `.wb2-segb` does — without this the answered control has
   one white pill and one word, and the word gives no sign it can be pressed. */
it("lifts the resting seat under the pointer", () => {
  expect(spec(HOVER)).toBeGreaterThan(spec(KIND));
  expect(rule(HOVER)).toMatch(/background:/);
});

/* The chosen seat has to beat the hover it now shares a weight class with, or
   pressing the answer you already gave fades it to three-quarter white. */
it("keeps the chosen seat solid under the pointer", () => {
  const on = ON.split(", ").map(spec);
  expect(Math.min(...on)).toBeGreaterThanOrEqual(spec(HOVER));
  expect(at(ON)).toBeGreaterThan(at(HOVER));
});

/* ── THE ASK STATE STILL READS AS A CHOICE ──

   Washing the tray amber (`background:rgba(240,164,49,.1)`) replaced the one
   surface that told the two seats apart, so the state that most needs to read
   as a choice between two things was a single amber lozenge with two words on
   it. The ring asks; the tray stays a tray. */
it("puts the asking on the ring, not in the tray", () => {
  const ask = rule(".fg .mts2-kinds.ask");
  expect(ask).toMatch(/outline:/);
  expect(ask).not.toMatch(/(?:^|[ ;])background:/);
});

/* The seam, and only while nothing is chosen: with an answer given the white
   pill is the boundary, and a rule beside it draws the same edge twice. */
it("draws a seam between the seats only while neither is chosen", () => {
  const seam = ".fg .mts2-kinds.ask .mts2-kind + .mts2-kind::before";
  expect(rule(seam)).toMatch(/content:""/);
  expect(CSS).not.toMatch(/\.fg \.mts2-kinds \.mts2-kind \+ \.mts2-kind::before/);
});
