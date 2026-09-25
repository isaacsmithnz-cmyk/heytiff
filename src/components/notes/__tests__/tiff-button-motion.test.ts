import { readFileSync } from "node:fs";
import { join } from "node:path";

/* THE TIFF BUTTON MOVES AT REST, AND ONLY IT MAY — SO IT STOPS BY NAME.

   It is the one loop in the app that is not feedback or state: Isaac's
   override of law 18 (docs/design.md, "The Tiff button"). The loops table
   holds its keyframe names; this holds the other half of the bargain, which
   nothing at runtime shows you. Jest renders no CSS, and a screenshot with
   motion reduced shows a still button whether the loops stopped or were
   never running. So the guard is a read of the stylesheet, the way the halo's
   guard before it was.

   Two rules: every element that loops is named in a reduced-motion block
   with `animation:none`, and the hover never lights what a keyboard cannot
   (law 24: the focus ring gets the same light). */

const CSS = readFileSync(join(process.cwd(), "src/app/dashboard/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule block as [selector, body]. */
const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);

describe("the Tiff button's motion", () => {
  const looping = blocks
    .filter(([sel, body]) => /\.tiffbtn/.test(sel) && /animation\s*:[^;]*\binfinite\b/.test(body))
    .map(([sel]) => sel);

  it("loops on the six elements docs/design.md names, and no more", () => {
    expect(looping.sort()).toEqual(
      [".tiffbtn-arc", ".tiffbtn-gim-a", ".tiffbtn-gim-b", ".tiffbtn-nod", ".tiffbtn-pre", ".tiffbtn-sheen::before"].sort()
    );
  });

  it("stops every one of them under reduced motion", () => {
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .find((b) => b.includes(".tiffbtn-pre"));
    expect(reduced).toBeTruthy();
    const stopped = [...reduced!.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /animation\s*:\s*none/.test(body))
      .flatMap(([, sel]) => sel.split(",").map((s) => s.trim()));
    // the band of light is hidden rather than stopped: parked, it would sit across the face
    const hidden = /\.tiffbtn-sheen\s*\{\s*display\s*:\s*none/.test(reduced!);
    for (const sel of looping) {
      if (sel === ".tiffbtn-sheen::before") expect(hidden).toBe(true);
      else expect(stopped).toContain(sel);
    }
  });

  it("lights on keyboard focus whatever it lights on hover", () => {
    const hovers = blocks.filter(([sel]) => /\.tiffbtn[^{]*:hover/.test(sel)).map(([sel]) => sel);
    expect(hovers.length).toBeGreaterThan(0);
    for (const sel of hovers) expect(sel).toMatch(/:focus-visible/);
  });

  it("wears no halo, disc or sparkle", () => {
    for (const gone of [".tiffbtn-halo", ".tiffbtn-face", ".tiffbtn-core", ".tiffbtn-spark"]) {
      expect(CSS).not.toContain(gone);
    }
  });
});
