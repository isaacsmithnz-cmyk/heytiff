import { readFileSync } from "node:fs";
import { join } from "node:path";

/* THE TIFF MARK MOVES WHILE TIFF WORKS, AND STOPS BY NAME.

   Rule 8: black and still at rest; while Tiff listens or works her small
   mark is a boomerang in the air, circling the mark's head, and it comes
   home when she's done (Isaac, 20 November 2026). Home's mark throws one
   slow lap now and then at rest. The loops table holds the keyframe names;
   this holds the other half of the bargain, which nothing at runtime shows
   you. Jest renders no CSS, and a screenshot with motion reduced shows a
   still mark whether the flight stopped or never ran. So the guard is a
   read of the stylesheet.

   Four rules: nothing on the mark animates but in a phase of the flight or
   the catch; every one is named in a reduced-motion block with
   `animation:none`; the one thing a hover moves is the boomerang's lift,
   and only from the pointer; and the mark is black and grey, with no
   colour of its own. */

const CSS = readFileSync(join(process.cwd(), "src/app/dashboard/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule block as [selector, body]. */
const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
// split on the commas between selectors, never the ones inside `:is(…)`
const each = (sel: string) => sel.split(/,(?![^(]*\))/).map((x) => x.trim());
const PHASES = ["fly-throw", "fly-orbit", "fly-land"];
const PARTS = [".tiffbtn-boom", ".tiffbtn-bank", ".tiffbtn-spin"];

describe("the Tiff mark's motion", () => {
  const animated = blocks
    .filter(([sel, body]) => /\.tiffbtn|\.tiffmk/.test(sel) && /(?:^|[^-\w])animation\s*:(?!\s*none)/.test(body))
    .flatMap(([sel]) => each(sel));

  it("loops only the boomerang's circling lap, on its three wrappers", () => {
    const looping = blocks
      .filter(([sel, body]) => /\.tiffbtn/.test(sel) && /animation\s*:[^;]*\binfinite\b/.test(body))
      .flatMap(([sel]) => each(sel));
    expect(looping.sort()).toEqual(PARTS.map((p) => `.tiffbtn-st.fly-orbit ${p}`).sort());
  });

  /* rule 8: still at rest. Everything that moves is in a phase of the flight,
     which the mark's clock enters only while Tiff works (or for Home's lap),
     or is the catch as it lands. */
  it("animates nothing at rest", () => {
    expect(animated.length).toBe(PHASES.length * PARTS.length + 1);
    for (const sel of animated) expect(sel).toMatch(/\.tiffbtn-st\.(fly-throw|fly-orbit|fly-land|caught) /);
  });

  it("stops every one of them under reduced motion", () => {
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .find((b) => b.includes(".tiffbtn-st.fly-orbit"));
    expect(reduced).toBeTruthy();
    const stopped = [...reduced!.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /animation\s*:\s*none/.test(body))
      .flatMap(([, sel]) => each(sel));
    for (const sel of animated) expect(stopped).toContain(sel);
  });

  /* Rule 18's named exemption (Isaac, 20 November 2026, "Yes, build all
     three"): the pointer lifts the boomerang off its place, as if about to
     be thrown. Law 8: the keyboard moves nothing, so it is the pointer's
     alone; the focus ring is the keyboard's light. */
  it("moves one thing on hover, the boomerang's lift, from the pointer only", () => {
    const hovers = blocks.filter(([sel]) => /\.tiff(btn|mk)[^{]*:hover/.test(sel)).flatMap(([sel]) => each(sel));
    expect([...new Set(hovers)]).toEqual([".tiffbtn:hover .tiffbtn-st.rest .tiffbtn-lift"]);
    expect(hovers.some((s) => s.includes(":focus-visible"))).toBe(false);
    const doc = readFileSync(join(process.cwd(), "docs/design.md"), "utf8");
    expect(doc).toMatch(/Rule 18, the Tiff button's lift/);
  });

  /* "black only", "and grey" (Isaac, 20 November 2026) */
  it("is black and grey, with no colour of its own", () => {
    const marks = blocks.filter(([sel]) => /\.tiffbtn|\.tiffmk/.test(sel)).map(([, body]) => body).join("\n");
    expect(marks).not.toMatch(/--(mark-|blue|purple|pink|red|orange|yellow|green|teal)/);
    expect(CSS).not.toMatch(/@keyframes tiffCyc/);
  });

  it("wears no rings, halo, disc or sparkle", () => {
    for (const gone of [".tiffbtn-gim", ".tiffbtn-arc", ".tiffbtn-sheen", ".tiffbtn-halo", ".tiffbtn-face", ".tiffbtn-core", ".tiffbtn-spark", ".tiffbtn-burst"]) {
      expect(CSS).not.toContain(gone);
    }
  });
});
