import fs from "node:fs";
import path from "node:path";

/* ── THE REMINDER CHIP HAS TO OUT-SPECIFY THE FIELD STYLING IT BORROWS ──

   The chip on a task row wears `.wb-select`, deliberately: that is how it takes
   the row's control shape and the dusk skin's version of it without restating
   either. The cost of borrowing the class is that it also lands inside

       .wb2-capcard.wb2-dusk :is(input.wb-inline, .wb-select) { color:#fff }

   and `:is()` takes the specificity of its most specific argument, so that is
   (0,3,1) — which beat the (0,3,0) originally written for this button BY NAME.

   The failure was silent and total: both states rendered pure white on the
   dusk card, so a task carrying a 6:30 reminder looked exactly like a task
   merely offering to take one. Nothing caught it. jest renders no CSS; the
   contrast guards measured a colour that WAS legible, just the wrong one; and
   reading the two selectors it looked like the more specific one won. It was
   found by measuring the rendered colour in a browser.

   This is the `.fg button` beats-every-single-class trap one selector along, so
   the guard is about specificity rather than about a literal: compute both, and
   fail if the borrowed rule ever out-ranks the one written for this chip. */

const CSS = fs.readFileSync(
  path.join(process.cwd(), "src/app/dashboard/shell.css"),
  "utf8",
);

/** (classes, elements) for a selector — ids are not used anywhere in here.

    `:is(...)` contributes its MOST specific argument, which is the whole reason
    this file exists, so it is expanded rather than counted as one pseudo. */
function specificity(selector: string): [number, number] {
  const expanded = selector.replace(/:is\(([^)]*)\)/g, (_, inner: string) => {
    const best = inner
      .split(",")
      .map((s) => specificity(s.trim()))
      .sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
    /* Spaces matter here only because the counting regexes below need each
       placeholder to be its own token — ".xe" reads as one class, not a class
       and an element. Combinators are irrelevant to specificity itself. */
    return (" .x".repeat(best[0]) + " e".repeat(best[1])).trim();
  });
  const classes = (expanded.match(/\.[a-z0-9_-]+/gi) ?? []).length;
  const elements = (expanded.match(/(^|[\s>+~])[a-z][a-z0-9-]*/gi) ?? []).length;
  return [classes, elements];
}

const wins = (a: [number, number], b: [number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];

/** Every selector in the sheet that sets `color` and matches `want`.

    Comments are stripped first — a scan that matched its own prose would pass
    against an empty stylesheet, which is the house rule for these guards. */
function colourRules(want: RegExp): string[] {
  const out: string[] = [];
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, sel, decls] = m;
    if (!/(?:^|;)\s*color:/.test(decls)) continue;
    if (want.test(sel)) out.push(sel.trim());
  }
  return out;
}

/* `.wb2-remind` and not `.wb2-remindoff`: the "no reminder" button next to the
   wheel is not a `.wb-select`, so it never entered the compound and has no
   cascade fight to win. */
const CHIP = /\.wb2-remind(?![a-z-])/;
const BORROWED = /:is\(input\.wb-inline, \.wb-select\)/;

it("expands :is() to its most specific argument, like a browser does", () => {
  // the calculator itself, since every assertion below leans on it
  expect(specificity(".wb2-capcard.wb2-dusk .wb2-remind")).toEqual([3, 0]);
  expect(specificity(".wb2-capcard.wb2-dusk :is(input.wb-inline, .wb-select)")).toEqual([3, 1]);
  expect(specificity(".wb2-capcard.wb2-dusk .wb-select.wb2-remind")).toEqual([4, 0]);
});

it("colours the chip more specifically than the field rule it borrows from", () => {
  const borrowed = colourRules(BORROWED).map(specificity);
  expect(borrowed.length).toBeGreaterThan(0);

  const own = colourRules(CHIP).filter((s) => s.includes("wb2-dusk"));
  expect(own.length).toBeGreaterThan(0);

  for (const rule of own)
    for (const other of borrowed)
      expect(wins(specificity(rule), other)).toBe(true);
});

it("still says which state it is in, once it wins", () => {
  /* Winning the cascade is only half of it — the two rules have to disagree,
     or the chip is legibly the wrong thing. */
  const off = /\.wb2-capcard\.wb2-dusk \.wb-select\.wb2-remind \{([^}]*)\}/.exec(CSS)?.[1];
  const on = /\.wb2-capcard\.wb2-dusk \.wb-select\.wb2-remind\.on \{([^}]*)\}/.exec(CSS)?.[1];
  expect(off).toBeTruthy();
  expect(on).toBeTruthy();
  expect(off).not.toEqual(on);
  // and the SET state is the louder of the two, not the quieter
  expect(on).toContain("#fff");
  expect(off).toMatch(/rgba\(255,255,255,\.\d+\)/);
});
