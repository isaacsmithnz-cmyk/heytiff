import fs from "node:fs";
import path from "node:path";

/* ── THE TOPBAR'S POPOVERS HAVE OPAQUE GROUNDS, AND HAVE TO KEEP THEM ──

   The bell panel shipped as `rgba(14,15,20,.92)` + `backdrop-filter`, copied
   from the user menu, which had worn that pair for a year without trouble.
   Then the user menu turned out to have the bug too — which is the reason this
   file is about the CONSTRUCTION and not about one component.

   A translucent ground is not a ground. It is 8% of whatever happens to be
   behind it — and unlike the user menu, which opens over the topbar and the
   dark sidebar, this panel hangs over the content well, which is the LIGHT
   card. Over the shell's own #050505 the ground composited to rgb(13,14,19);
   over Home it composited to rgb(32,33,38). Nineteen levels, on a surface
   whose quiet ink is `--on-ink-q` — white at .5, calibrated against the dark
   chrome and nothing else.

   On a HOVERED row, where a .08 white tint lifts the ground a second time, the
   subject line measured **4.44** on prod. Under AA. Every harness reading had
   said 5.03, because the harness only ever put the panel over the dark ground
   — the bug was invisible to the thing built to catch it, and only a walk on
   the real screen found it. It is the "hover LIFTS the ground while the ink
   stays put" shape, which has now cost time twice.

   These are stylesheet-text guards. They cannot composite a colour, but they
   can hold the two properties that made the composite knowable at all: the
   ground names ONE opaque colour, and no filter samples what is behind it. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

/** The body of one rule, by its exact selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not declared in shell.css`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

const PANEL = ".fg .topbar .bell-panel";
const USER_MENU = ".fg .topbar .me-menu";

/* BOTH popovers that hang off the topbar, checked as a SET rather than one at
   a time. The bell panel copied its glass from the user menu, so the defect
   was never one component's — it belonged to the construction. When the panel
   was fixed the menu was left alone on the reasoning that it "opens over the
   topbar and the sidebar, not the card". That reasoning was wrong: the topbar
   is 80px tall and the menu drops to y=204, so 124 of its 133px hang over the
   light card and its subtitle measured the same 4.44 on hover. Measuring took
   thirty seconds; believing took none.

   So the list is the guard. Anything else that hangs off this row belongs in
   it, and a new popover that copies the glass fails here rather than on
   somebody's screen a month later. */
const TOPBAR_POPOVERS = [PANEL, USER_MENU];

it.each(TOPBAR_POPOVERS)("gives %s a ground that does not move with what is behind it", (sel) => {
  const bg = rule(sel).match(/(?:^|;)\s*background:([^;]+)/)?.[1]?.trim();
  expect(bg).toBe("#0d0e13");
});

it.each(TOPBAR_POPOVERS)("lets nothing behind %s through — no alpha on the ground", (sel) => {
  /* Written as its own assertion rather than folded into the one above,
     because the failure it describes is the one that actually happened twice:
     someone reaches for the glass a sibling popover wears, and the exact
     literal changes while the DEFECT stays the same. */
  expect(rule(sel)).not.toMatch(/background:\s*(rgba|hsla|color-mix|transparent)/);
});

it.each(TOPBAR_POPOVERS)("carries no backdrop filter on %s — the same mistake from the other side", (sel) => {
  /* At 92% it was already invisible — swapped out on prod and compared, the
     two frames were identical. Dead CSS in this file is not inert: a leftover
     `.fg .me` rule was found styling a mention chip it was never meant to. */
  expect(rule(sel)).not.toMatch(/backdrop-filter/);
});

it.each([`${PANEL.replace(".bell-panel", ".bp-main")} em`, `${USER_MENU.replace(".me-menu", ".me-item")} .mk2 em`])(
  "keeps %s on the shared token rather than a private lighter ink",
  (sel) => {
    /* The other way to "fix" a contrast miss is to hand one component its own
       lighter ink, which puts a colour literal somewhere the `-t` guard cannot
       see it and lets the ground go on moving. The ground was the bug, in both
       of these. */
    expect(rule(sel)).toMatch(/color:var\(--on-ink-q\)/);
  },
);

/* ── AND IT HANGS OFF THE BELL RATHER THAN FLOATING NEAR IT ──

   The panel first shipped with a 10px gap and a `translateY` drop — the motion
   of a thing ARRIVING from elsewhere. There are three controls in that corner
   of the topbar, so a panel that merely appears beside them does not say which
   one it belongs to.

   The caret and the transform origin are ONE mechanism, not two decorations,
   and that is what makes them worth pinning together: the caret is a child of
   the transformed element, so it scales with the panel, and a point sitting AT
   the transform origin does not move at any scale. Put the origin on the
   caret's tip and the caret stays welded to the bell for the whole unfold —
   measured on a paused animation, the drift is a flat 0.38px from scale .92
   through to 1. Move the origin and the caret slides off the bell on the way
   in, which is the floating window all over again. */

it("anchors the caret and the growth origin to the SAME point — the bell's centre", () => {
  /* 23px, not 22: the bell is a 20px glyph in 12px padding inside a 1px
     border, so it measures 46 and the arithmetic that says 44 is a pixel out.
     Both numbers are the same fact and have to move together. */
  expect(rule(PANEL)).toMatch(/transform-origin:calc\(100% - 23px\) -9px/);
  expect(rule(`${PANEL}::before`)).toMatch(/right:17px/); // 17 + half of 12 = 23
});

it("leaves a gap the caret can actually span", () => {
  /* The caret reaches ~13px above the panel's top edge, so a 9px gap has it
     tucking under the bell by ~4px — which is what reads as joined. Widen the
     gap past the caret's reach and the stem stops touching anything. */
  expect(rule(PANEL)).toMatch(/top:calc\(100% \+ 9px\)/);
});

it("grows out of the bell instead of sliding down onto the page", () => {
  const body = rule(PANEL);
  expect(body).toMatch(/animation:bellPanelIn/);
  const frames = CSS.slice(CSS.indexOf("@keyframes bellPanelIn"));
  const decl = frames.slice(0, frames.indexOf("}\n"));
  expect(decl).toMatch(/scale\(\.92\)/);
  // a translate here re-introduces the travel that made it read as a separate window
  expect(decl).not.toMatch(/translate/);
});

/* ── THE REMINDER ROWS, MEASURED AGAINST THE GROUND THEY ACTUALLY SIT ON ──

   Reminders joined this panel after everything above was written, which makes
   them the first new thing to arrive since the bug — and the bug was never
   about a colour, it was about a ground that MOVED. So the question for a new
   row is not "is its ink light enough" but "against what, at every moment".

   A chip row is a link: hovering it lifts the ground by .08 white and takes its
   title to #fff to keep up, while the subject line stays on `--on-ink-q` — the
   ink stays put while the ground rises, which is the whole shape of the 4.44.
   A reminder row is NOT a link. It is text with two buttons on it, so it does
   not lift at all, and its ground is the panel's own opaque #0d0e13 at every
   moment. The buttons light up instead, and they carry their own ink, so they
   are measured on their own grounds — including hovered.

   The maths is here rather than in an eye. jsdom computes no composite, so
   nothing at runtime can see any of this. */

/** WCAG relative luminance. */
function luminance([r, g, b]: number[]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** `fg` painted onto `bg`, honouring fg's alpha. */
function over(fg: number[], bg: number[]): number[] {
  const a = fg[3] ?? 1;
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
}

function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

const rgba = (v: string): number[] => {
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) throw new Error(`not a colour: ${v}`);
  return m[1].split(",").map((n) => Number(n.trim()));
};

/** A declaration's value inside a rule. */
const decl = (selector: string, prop: string): string => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`).exec(rule(selector));
  if (!m) throw new Error(`${selector} declares no ${prop}`);
  return m[1].trim();
};

/** The panel's opaque ground — the fact everything above exists to protect. */
const GROUND = [13, 14, 19];
const QUIET = rgba(/--on-ink-q\s*:\s*(rgba?\([^)]+\))/.exec(CSS)![1]);

it("does not lift the ground under a reminder row", () => {
  /* THE ASSERTION THAT KEEPS THE BUG FROM COMING BACK BY A NEW DOOR. A hover
     background here would raise the ground under a late line that stays on
     `--on-ink-q`, which is exactly what measured 4.44 on prod. If a reminder
     row ever needs a hover state, its ink has to move with it. */
  expect(CSS).not.toMatch(/\.fg \.topbar \.bp-rem(row)?:hover\s*\{[^}]*background/);
});

it("keeps the late line on the shared token, over a ground that cannot move", () => {
  // it inherits `.bp-main em`, which the guard above already pins to the token
  expect(decl(".fg .topbar .bp-grp", "color")).toBe("var(--on-ink-q)");
  expect(contrast(over(QUIET, GROUND), GROUND)).toBeGreaterThanOrEqual(4.5);
});

it("gives the row's two buttons AA on their own grounds, at rest and hovered", () => {
  /* Each button paints a translucent chip on the panel and then its ink on
     that — two composites deep, which is where "it looked fine" stops being
     evidence. Hover is measured because it is the state a person reads the
     label in: they are pointing at it. */
  const CHIP = ".fg .topbar :is(.bp-remdo, .bp-remsnz)";
  const chipGround = over(rgba(decl(CHIP, "background")), GROUND);
  expect(contrast(over(rgba(decl(CHIP, "color")), chipGround), chipGround)).toBeGreaterThanOrEqual(
    4.5,
  );

  const hovered = over(rgba(decl(`${CHIP}:hover`, "background")), GROUND);
  expect(contrast(over(rgba("rgba(255,255,255,1)"), hovered), hovered)).toBeGreaterThanOrEqual(4.5);

  // and the three snooze choices, which sit straight on the panel
  const OPT = ".fg .topbar .bp-snzopt";
  expect(contrast(over(rgba(decl(OPT, "color")), GROUND), GROUND)).toBeGreaterThanOrEqual(4.5);
  const optHover = over(rgba(decl(`${OPT}:hover`, "background")), GROUND);
  expect(contrast(over(rgba("rgba(255,255,255,1)"), optHover), optHover)).toBeGreaterThanOrEqual(
    4.5,
  );
});

it("marks a reminder's glyph as its own kind, not as an urgency", () => {
  /* The chip rows use red and amber for bad/warn, and on this app those two
     colours never stop meaning something is wrong. A reminder coming due is
     not a failure — it is a thing you asked for — so its glyph takes the
     product's own accent and the row takes no state class at all. */
  const ic = rule(".fg .topbar .bp-rem .bp-ic");
  expect(ic).not.toMatch(/224,\s*38,\s*79/); // danger
  expect(ic).not.toMatch(/245,\s*158,\s*11/); // warn
  // the icon is a graphic, so AA is 3:1
  const icGround = over(rgba(ic.match(/background:([^;]+)/)![1]), GROUND);
  expect(contrast(rgba(`rgba(${[0x3f, 0xd7, 0xb6].join(",")},1)`), icGround)).toBeGreaterThanOrEqual(3);
});
