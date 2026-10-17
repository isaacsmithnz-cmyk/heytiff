import { readFileSync } from "node:fs";
import { join } from "node:path";

/* THE TIFF MARK MOVES ONLY WHILE TIFF WORKS, AND STOPS BY NAME.

   v2, rule 8 (18 October 2026): black and white and still at rest; while
   Tiff listens or works it turns and its rings take the colours. Until then
   it was the one loop not tied to feedback or state, Isaac's override of
   24 September, which v2 retires. The loops table
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

  it("loops on the elements docs/design.md names, and no more", () => {
    expect(looping.sort()).toEqual(
      [
        ".tiffbtn-arc", ".tiffbtn-gim-a", ".tiffbtn-gim-b", ".tiffbtn-nod", ".tiffbtn-pre", ".tiffbtn-sheen::before",
        // the working mark's rings, in the colours (v2, rule 8)
        ":is(.tiffbtn, .tiffmk).working .tiffbtn-gim-a .tiffbtn-ring", ":is(.tiffbtn, .tiffmk).working .tiffbtn-gim-b .tiffbtn-ring",
      ].sort()
    );
  });

  /* v2, rule 8: "Black and white at rest, and still." Every loop on the mark
     is declared paused, and only a working mark runs them. */
  it("holds every loop still at rest and runs them only while Tiff works", () => {
    const paused = blocks.filter(([, body]) => /animation-play-state\s*:\s*paused/.test(body)).map(([sel]) => sel).join(",");
    const running = blocks.filter(([, body]) => /animation-play-state\s*:\s*running/.test(body)).map(([sel]) => sel);
    for (const el of [".tiffbtn-pre", ".tiffbtn-nod", ".tiffbtn-gim-a", ".tiffbtn-gim-b", ".tiffbtn-arc", ".tiffbtn-sheen::before"]) {
      expect(paused).toContain(el.replace("::before", ""));
    }
    expect(running.length).toBeGreaterThan(0);
    for (const sel of running) expect(sel).toMatch(/\.working/);
  });

  it("stops every one of them under reduced motion", () => {
    const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .find((b) => b.includes(".tiffbtn-pre"));
    expect(reduced).toBeTruthy();
    const stopped = [...reduced!.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /animation\s*:\s*none/.test(body))
      // split on the commas between selectors, never the ones inside `:is(…)`
      .flatMap(([, sel]) => sel.split(/,(?![^(]*\))/).map((s) => s.trim()));
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
