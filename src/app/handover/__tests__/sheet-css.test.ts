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
  path.join(process.cwd(), "src/app/handover/[id]/page.tsx"),
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
});
