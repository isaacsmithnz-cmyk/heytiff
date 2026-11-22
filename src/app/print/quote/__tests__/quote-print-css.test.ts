import { readFileSync } from "fs";
import { join } from "path";

/* The quote's PDF wears `.fg` (shell.css) for its tokens, and `.fg` is the
   app's window: `position: fixed; inset: 0; overflow: hidden`. Printed, that
   is ONE A4 page with the rest cut off and nothing to say so: a quote with a
   photo in its summary came out with no price, no choice, no Not included
   (job 3301, 22 November 2026). The studio's sheet hit the same on 25 August
   (summary-cascade.test.ts). */
const css = readFileSync(join(__dirname, "../quote-print.css"), "utf8");
const shell = readFileSync(join(__dirname, "../../../dashboard/shell.css"), "utf8");

describe("the quote on paper runs on past one page", () => {
  it("still wears .fg, which is the app's fixed, clipped window", () => {
    const tsx = readFileSync(join(__dirname, "../print-quote.tsx"), "utf8");
    expect(tsx).toMatch(/className="fg qpdf"/);
    expect(shell).toMatch(/\.fg \{\s*position:fixed;[^}]*overflow:hidden/);
  });
  it("takes back position, inset and overflow, more specific than .fg", () => {
    const rule = css.match(/\.fg\.qpdf \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/position:\s*static/);
    expect(rule![0]).toMatch(/inset:\s*auto/);
    expect(rule![0]).toMatch(/overflow:\s*visible/);
  });
});
