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

describe("where the quote's pages break", () => {
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{[^}]*\\}`))?.[0] ?? "";
  it("never leaves a heading alone at a page's foot", () => {
    expect(rule(".qpdf h3")).toMatch(/break-after:\s*avoid/);
  });
  it("keeps an option's price with its option", () => {
    expect(rule(".qpdf .lp-eq + .lp-price")).toMatch(/break-before:\s*avoid/);
    expect(css).toMatch(/^\.qpdf \.lp-price \{ break-inside: avoid; \}$/m);
  });
  it("never cuts a row, an item, a photo or the signing lines in two", () => {
    expect(rule(".qpdf tr")).toMatch(/break-inside:\s*avoid/);
  });
});

it("keeps an option's units together, one table on one page", () => {
  expect(css).toMatch(/\.qpdf \.lp-eq[^{]*\{[^}]*break-inside:\s*avoid/);
});

it("lets an option's units start a page, so an option never goes over whole", () => {
  expect(css).toMatch(/^\.qpdf \.lp-eq, \.qpdf \.lp-table \{ break-inside: avoid; \}$/m);
});
