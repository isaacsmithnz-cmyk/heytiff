import fs from "node:fs";
import path from "node:path";

/* THE HANDOVER SHEET'S CSS IS A TEMPLATE LITERAL, and a backtick in it ends
   the string.

   That is a syntax error, so it cannot reach production — but of everything
   that guards this repo, only `tsc` would catch it. Jest never imports this
   page (it is a server component behind auth0), so the pre-push hook is green;
   the failure surfaces at `next build`, on Vercel, after the push. It has
   already happened once, from a code COMMENT inside the sheet's CSS that
   quoted a flex value in backticks.

   So: the sheet's styles are read as text and checked for the one character
   that can end them. Cheap, and it fails in the loop that actually runs. */

const PAGE = fs.readFileSync(
  path.join(process.cwd(), "src/app/handover/[id]/sheet-chrome.tsx"),
  "utf8"
);

function styleBlock(): string {
  const open = PAGE.indexOf("const CSS = `");
  expect(open).toBeGreaterThan(-1);
  const from = open + "const CSS = `".length;
  const close = PAGE.indexOf("`;", from);
  expect(close).toBeGreaterThan(from);
  return PAGE.slice(from, close);
}

describe("the handover sheet's inline stylesheet", () => {
  it("carries no backtick, which would end the template early", () => {
    expect(styleBlock()).not.toContain("`");
  });

  /* The same hazard one character along: `${` inside the string is an
     interpolation, and CSS has no reason to contain one. */
  it("carries no interpolation", () => {
    expect(styleBlock()).not.toContain("${");
  });

  /* It is still a stylesheet. A block that lost its braces would pass the two
     checks above and style nothing. */
  it("is still the sheet — the letterhead band and the print rules are in it", () => {
    const css = styleBlock();
    expect(css).toContain(".ho-head");
    expect(css).toContain("@media print");
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  /* THE FRAME MECHANICS, pinned the same way the design sheet pins its own
     (summary/__tests__/frame-print.test.ts) and for the same reason: none of
     this is observable from jsdom, and all of it has silently failed once.

     The construction is #481's: the two layers go position:fixed in print
     and are stamped per page — which only reaches the paper because a THEMED
     print drops the page margin (a fixed box is clipped to the page box);
     the spacer table holds the frame's room open per page, anchored heavier
     than the screen reset because @media print adds no specificity; and the
     well's clear is cloned onto every fragment. */
  describe("the frame on paper", () => {
    it("stamps the layers per page and lets the well fill survive ink-saving", () => {
      const css = styleBlock();
      const printBlock = css.slice(css.indexOf("@media print"));
      expect(printBlock).toMatch(/\.ho-band,\s*\.ho-well\s*\{\s*position:\s*fixed/);
      expect(css).toMatch(/\.ho-well\s*\{[^}]*print-color-adjust:\s*exact/);
    });

    it("holds the spacers open with selectors anchored past the screen reset", () => {
      const css = styleBlock();
      const printBlock = css.slice(css.indexOf("@media print"));
      expect(printBlock).toMatch(
        /\.ho-fr > thead > tr > td\.ho-fr-t,\s*\n?\s*\.ho-fr > tfoot > tr > td\.ho-fr-b\s*\{\s*height:\s*var\(--doc-gutter/
      );
      expect(printBlock).toMatch(
        /\.ho-fr > tbody > tr > td\.ho-fr-c\s*\{\s*padding:\s*0 var\(--doc-gutter/
      );
      expect(printBlock).toMatch(/box-decoration-break:\s*clone/);
      // and the spacers carry no paint of their own — a second copy of the
      // ink would sit on top of the fixed well and notch against it
      expect(printBlock).not.toMatch(/\.ho-fr[^{]*\{[^}]*background:\s*var\(--doc-ink/);
    });

    it("strips the page margin only for a brand the derivation accepts", () => {
      // the @page override lives in the COMPONENT, where the brand is —
      // an @page rule cannot read a CSS variable
      expect(PAGE).toMatch(/documentTheme\(brand\.color\)/);
      expect(PAGE).toMatch(/themed && <style>\{"@media print \{ @page \{ margin: 0; \} \}"\}<\/style>/);
      // and the unthemed sheet keeps its own margin in the stylesheet
      expect(styleBlock()).toMatch(/@page \{ margin: 16mm; \}/);
    });
  });
});
