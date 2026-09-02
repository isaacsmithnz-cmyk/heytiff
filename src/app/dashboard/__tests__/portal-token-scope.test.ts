import fs from "node:fs";
import path from "node:path";

/* ── THE PALETTE HAS TO REACH THE THINGS THAT PORTAL OUT OF THE FRAME ──

   `.fg` is the dashboard's own frame, and the modals and sheets portal to
   <body>, outside it (`.fl-ov`, the wb2 sheets, the rego plate — the button
   reset in this sheet already carves itself out for exactly that reason). The
   tokens were declared INSIDE the `.fg` block, so every `var(--…)` in an
   unscoped rule resolved to nothing and fell back through inheritance.

   MEASURED on a harness loading this sheet, before the move: inside `.fg`,
   `--ok-t` computed to rgb(0,115,95) and `--bad-t` to rgb(200,26,65); outside
   it, both — and `--gray500` — came back rgb(5,5,5). `.fl-err` is the one that
   had been shipping: the error text in every fleet and invite modal has been
   near-black since it was written, inside a box whose red tint and border are
   literals and so looked correct.

   A stylesheet-text guard, like its neighbours here. It cannot resolve a
   cascade, but it can hold the one fact that made the bug possible: the block
   that DECLARES the tokens is `:root`, not `.fg`. Move them back and this
   fails by name. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

/** The selector of the rule that first declares a custom property. */
function declaringSelector(token: string): string | null {
  const at = CSS.indexOf(`${token}:`);
  if (at === -1) return null;
  const open = CSS.lastIndexOf("{", at);
  if (open === -1) return null;
  // Back up over the selector, stopping at the end of the previous rule or
  // comment — whichever is nearer. A comment close is TWO characters, so its
  // end is the index plus two; slicing from +1 leaves a stray slash on the
  // front, and the comparison then fails on a string that looks right in the
  // diff. (Written as line comments: spelling the close-marker inside a block
  // comment ends it early — the same shape as the backtick-in-a-template trap.)
  const brace = CSS.lastIndexOf("}", open);
  const comment = CSS.lastIndexOf("*/", open);
  const from = comment > brace ? comment + 2 : brace + 1;
  return CSS.slice(from, open).trim();
}

/* Every token an unscoped rule in this sheet reaches for. `--q` and
   `--gray500` are here because the quiet tiers are what a modal's secondary
   text uses, and they failed the same way the state colours did. */
const PORTAL_TOKENS = ["--ok-t", "--bad-t", "--warn-t", "--q", "--gray500", "--ink", "--red"];

describe("tokens used outside .fg are declared outside .fg", () => {
  it.each(PORTAL_TOKENS)("%s is declared on :root", (token) => {
    expect(declaringSelector(token)).toBe(":root");
  });

  /* The frame keeps its own layout and nothing else — if custom properties
     come back into this block, they are out of reach of the portals again. */
  it("the .fg block declares no custom properties of its own", () => {
    const at = CSS.indexOf("\n.fg {");
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf("}", at));
    expect(block).not.toMatch(/--[a-z0-9-]+\s*:/i);
  });

  /* The bug this guards is only interesting because something unscoped uses
     the tokens. If that stops being true the guard is measuring nothing. */
  it("the portalled modal really does reach for them", () => {
    const errRule = CSS.slice(CSS.indexOf("\n.fl-err"), CSS.indexOf("\n.fl-err") + 400);
    expect(errRule).toContain("var(--bad-t)");
    expect(CSS).toMatch(/\n\.fl-res\.ok \{[^}]*var\(--ok-t\)/);
  });
});
