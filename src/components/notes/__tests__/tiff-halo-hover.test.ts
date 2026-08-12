import { readFileSync } from "node:fs";
import { join } from "node:path";

/* THE HALO'S HOVER HAS TO STOP THE BREATH, and nothing at runtime can tell
   you it doesn't.

   `.tiffbtn-halo` runs `fgBreath` forever. A running animation sits above
   author rules in the cascade, so while it plays it owns `opacity` outright
   and any `:hover { opacity }` on that element is inert — which is exactly
   what shipped: `opacity:.72` sat in two places from the beginning and never
   once fired. Jest never renders CSS, lightningcss parses the dead rule
   happily (it IS valid), and a screenshot shows an absence you have to
   already suspect. So the guard is a read of the stylesheet.

   The rule it encodes: if a `:hover` rule sets `opacity` on `.tiffbtn-halo`,
   it must also cancel the animation. */

const CSS = readFileSync(
  join(process.cwd(), "src/app/dashboard/shell.css"),
  "utf8",
);

/** Every declaration block whose selector hovers something and lands on the halo. */
function hoverHaloRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]*:hover[^{}]*\.tiffbtn-halo[^{}]*)\{([^}]*)\}/g;
  for (const m of CSS.matchAll(re)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

describe("the Tiff halo's hover state", () => {
  it("is declared on both surfaces the mark appears on", () => {
    const selectors = hoverHaloRules().map((r) => r.selector);
    // the topbar button, and Home's "Debrief the day" bar that borrows its skin
    expect(selectors).toHaveLength(2);
    expect(selectors.some((s) => s.includes(".tiffbtn-topbar"))).toBe(true);
    expect(selectors.some((s) => s.includes(".hm-say"))).toBe(true);
  });

  it("cancels the breathing animation wherever it sets opacity", () => {
    const rules = hoverHaloRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const { selector, body } of rules) {
      if (!/opacity\s*:/.test(body)) continue;
      expect(
        // an opacity a running animation would swallow — see the block comment
        { selector, body: body.trim() },
      ).toEqual(
        expect.objectContaining({ body: expect.stringMatching(/animation\s*:\s*none/) }),
      );
    }
  });

  it("rests below its hover value when motion is reduced", () => {
    /* Reduced motion stops the breath, which uncovers the halo's own
       `opacity` declaration. That resting value has to sit BELOW the hover
       value or hovering dims the glow instead of lifting it. */
    /* The stylesheet has several reduced-motion blocks; the one that matters
       is whichever declares the halo. Taking the first match found a block
       with no halo in it and failed for the wrong reason. */
    const blocks = [
      ...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\)[^{]*\{([\s\S]*?)\n\}/g),
    ].map((m) => m[1]);
    const rest = blocks
      .map((b) => b.match(/\.tiffbtn-halo\s*\{[^}]*opacity\s*:\s*([\d.]+)/))
      .find((m) => m !== null);
    expect(rest).toBeTruthy();

    const hover = hoverHaloRules()
      .map((r) => r.body.match(/opacity\s*:\s*([\d.]+)/)?.[1])
      .filter((v): v is string => Boolean(v))
      .map(Number);
    expect(hover.length).toBeGreaterThan(0);
    for (const h of hover) expect(Number(rest![1])).toBeLessThan(h);
  });
});
