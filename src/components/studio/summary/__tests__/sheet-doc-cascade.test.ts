/* Guards for the document's own stylesheet, stated against the SOURCE.

   jsdom does not resolve custom properties, does not compute specificity
   through a stylesheet, and has no opinion about container queries — so none
   of what follows is visible to any component test in this repo. Each of these
   is a bug that would ship green.

   Every assertion was validated by reverting its fix and watching it fail. */

import { readFileSync } from "fs";
import { join } from "path";

const raw = readFileSync(join(__dirname, "../sheet-doc.css"), "utf8");
/* comments stripped: the fixes' own comments NAME what is being asserted, so
   a substring match would pass on reverted code */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

const selectors = css
  .split("}")
  .flatMap((block) => {
    const i = block.indexOf("{");
    return i === -1 ? [] : [block.slice(0, i).replace(/\s+/g, " ").trim()];
  })
  .filter(Boolean);

describe("the document's tokens survive leaving the dashboard", () => {
  /* THE LIVE ROUTE IS OUTSIDE `.fg`. shell.css is loaded by the dashboard and
     nothing else, so on /live every `var(--ink)` / `var(--gray500)` resolves
     to nothing and the property falls back to INHERITED colour — the greys
     were never grey. Every token this sheet reads must therefore carry a
     literal fallback, and that is invisible until a customer opens a link. */
  it("every var() the sheet reads from outside carries a literal fallback", () => {
    const external = [...css.matchAll(/var\((--(?:ink|gray\d+|teal[\w-]*|ds-[\w-]+))([^)]*)\)/g)];
    expect(external.length).toBeGreaterThan(0);
    const bare = external
      .filter(([, , rest]) => !rest.trim().startsWith(","))
      .map(([, name]) => name);
    expect(bare).toEqual([]);
  });

  it("the sheet defines its own ramp rather than reading the shell's twice", () => {
    const root = css.match(/\.dsd \{[^}]*\}/);
    expect(root).not.toBeNull();
    for (const t of ["--dsd-ink", "--dsd-ink-2", "--dsd-ink-3", "--dsd-ok", "--dsd-warn"])
      expect(root![0]).toContain(t);
  });
});

describe("the rooms table's cascade", () => {
  /* `.dsd-rt td` states the body weight at (0,1,1). Any emphasis rule written
     as a lone class is (0,1,0) and loses silently — the same shape as the
     `.fg button` reset trap, and the shape that made the previous table's
     model column render at body weight in the mock. */
  it("states a body weight, so the emphasis rules mean something", () => {
    expect(css).toMatch(/\.dsd-rt td \{[^}]*font-weight:\s*500/);
  });

  it("every emphasis rule carries the element, not just the class", () => {
    const emphasis = selectors.filter((s) =>
      /\.(?:rm|mdl|odu|num|sty)(?![\w-])/.test(s)
    );
    expect(emphasis.length).toBeGreaterThan(0);
    for (const sel of emphasis)
      for (const one of sel.split(","))
        /* `th.num` shares the class and is legitimately a header rule */
        expect(one.trim()).toMatch(/t[dh]\.(?:rm|mdl|odu|num|sty)/);
  });

  it("the coverage state outranks the coverage figure's own colour", () => {
    /* `.dsd-cv b` is (0,1,1); a bare `.under b` alongside it would lose and
       every short room would print in the covered green. */
    for (const state of ["under", "na"])
      expect(css).toMatch(new RegExp(`\\.dsd-cv\\.${state}[^{]*b`));
  });

  it("A MODEL NUMBER IS NEVER CLIPPED — it wraps or it fits", () => {
    /* it was `nowrap` + `text-overflow: ellipsis`, which silently ate the end
       of every long model below a ~1024px container. Half a model number is
       the one thing on a customer's row they cannot look up. */
    const modelRule = css.match(/\.dsd-rt td\.mdl,\s*\.dsd-rt td\.odu \{[^}]*\}/);
    expect(modelRule).not.toBeNull();
    expect(modelRule![0]).not.toMatch(/text-overflow/);
    expect(modelRule![0]).not.toMatch(/white-space:\s*nowrap/);
    expect(modelRule![0]).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the mark keeps its shape", () => {
  /* FOUND IN PRODUCTION, and the hazard outlived the class it was found on.

     The mark used to be `.dsd-logo` in a chrome bar; it is `.dsd-idlogo` in
     the masthead's identity block now. Same trap either way: the image is a
     flex item in a COLUMN container, so a container that stretches its items
     hands the image a definite width, a height cap then clamps it, and Diamond
     Air's 3.55:1 logo renders at 4.78:1 — stretched 35% wide. Nobody uploads a
     logo to have it squashed.

     jsdom has no layout, so no component test can see this. It is stated
     against the source instead. */
  it("opts out of the stretch and lets the ratio drive", () => {
    const rule = css.match(/\.dsd-idlogo \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/width:\s*auto/);
    expect(rule![0]).toMatch(/object-fit:\s*contain/);
    /* the stretch is opted out of ON THE CONTAINER here rather than per-item.
       Either is fine; having NEITHER is the bug. */
    const box = css.match(/\.dsd-ident \{[^}]*\}/);
    expect(box).not.toBeNull();
    expect(
      /align-items:\s*flex-start/.test(box![0]) ||
        /align-self:\s*flex-start/.test(rule![0])
    ).toBe(true);
  });

  it("never pins BOTH dimensions of the image itself", () => {
    /* every rule that sizes the mark may cap ONE side, but none may set a
       definite width AND height — that is the distortion, whatever the
       selector. The initials stand-in is excluded: it is a text span with no
       ratio to keep, and a square is what it is meant to be. */
    const sizing = [...css.matchAll(/([^{}]*\.dsd-idlogo[^{}]*)\{([^}]*)\}/g)]
      .filter(([, sel]) => !/org-initials/.test(sel));
    expect(sizing.length).toBeGreaterThan(0);
    for (const [, sel, body] of sizing) {
      const pinned =
        /(^|;)\s*width:\s*\d/.test(body) && /(^|;)\s*height:\s*\d/.test(body);
      expect({ sel: sel.trim(), pinned }).toEqual({ sel: sel.trim(), pinned: false });
    }
  });
});

describe("the sheet measures its own width", () => {
  /* The three chromes hand this document wildly different room from the same
     viewport — the Summary step gives it what is left after a 224px sidebar,
     and paper has no viewport at all. A viewport media query would switch the
     table on the wrong signal in two of the three. */
  it("declares a container and asks it, not the window", () => {
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(raw).toMatch(/@container \(max-width: 1023px\)/);
  });

  it("keeps NO viewport query for the layout the container decides", () => {
    const viewportQueries = [...raw.matchAll(/@media\s*\(max-width[^)]*\)/g)].map(
      (m) => m[0]
    );
    expect(viewportQueries).toEqual([]);
  });
});
