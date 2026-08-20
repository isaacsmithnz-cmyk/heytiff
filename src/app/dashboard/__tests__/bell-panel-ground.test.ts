import fs from "node:fs";
import path from "node:path";

/* ── THE BELL PANEL'S GROUND IS OPAQUE, AND HAS TO STAY THAT WAY ──

   The panel shipped as `rgba(14,15,20,.92)` + `backdrop-filter`, copied from
   the user menu, which had worn that pair for a year without trouble.

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

it("gives the panel a ground that does not move with what is behind it", () => {
  const bg = rule(PANEL).match(/(?:^|;)\s*background:([^;]+)/)?.[1]?.trim();
  expect(bg).toBe("#0d0e13");
});

it("lets nothing behind the panel through — no alpha on the ground", () => {
  /* Written as its own assertion rather than folded into the one above,
     because the failure it describes is the one that actually happened:
     someone reaches for the glass the sibling popover wears, and the exact
     literal changes while the DEFECT stays the same. */
  expect(rule(PANEL)).not.toMatch(/background:\s*(rgba|hsla|color-mix|transparent)/);
});

it("carries no backdrop filter, which is the same mistake from the other side", () => {
  /* At 92% it was already invisible — swapped out on prod and compared, the
     two frames were identical. Dead CSS in this file is not inert: a leftover
     `.fg .me` rule was found styling a mention chip it was never meant to. */
  expect(rule(PANEL)).not.toMatch(/backdrop-filter/);
});

it("still keeps the quiet subject line on the shared token, not a private one", () => {
  /* The other way to "fix" a contrast miss is to hand this one component its
     own lighter ink, which puts a colour literal somewhere the `-t` guard
     cannot see it and lets the ground go on moving. The ground was the bug. */
  expect(rule(".fg .topbar .bp-main em")).toMatch(/color:var\(--on-ink-q\)/);
});
