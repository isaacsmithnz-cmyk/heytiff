/* Guard for the Design step's LIGHT chrome (decided 2026-08-22).

   The editor once ran a "dark editor chrome" pass: `.dstudio.editing`
   re-tinted the topbar/sidecol/toolrail with an inverted ink ramp
   (--ink:#fff) and glass surfaces. CSS variables inherit, so anything that
   forgot to opt back out rendered white-on-white — the component palette
   shipped as a blank white box exactly that way, and a previous version of
   this file guarded the popover restyle list that patched around it.

   The whole layer is gone now: the Design step sits on the shell's light
   well, chrome uses its ordinary light styles, and the only dark elements
   over the canvas are the always-dark HUDs. This guard pins that decision at
   its root — if an editing-scoped ink inversion ever comes back, the entire
   family of inherited-contrast bugs comes back with it, so the reintroduction
   must be loud enough to delete this test on purpose.

   Asserted against the stylesheet source: jsdom won't resolve inherited
   custom properties through a 200kB sheet, so a render test can't see this. */

import { readFileSync } from "fs";
import { join } from "path";

/* comments stripped — assert on the rules, never on the prose about them */
const css = readFileSync(join(__dirname, "../studio.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

describe("editing chrome stays light", () => {
  it("no editing-scoped rule inverts the ink ramp", () => {
    const inversion = css.match(
      /\.dstudio\.editing[^{}]*\{[^{}]*--ink:\s*#fff/i
    );
    expect(inversion).toBeNull();
  });

  it("the editor keeps the shell's light well (no editing well dissolve)", () => {
    /* the Home start screen may dissolve the well (`:not(.editing)`), and the
       exit transition may (`editing.exiting`) — a bare `.editing` dissolve is
       the one that painted the whole Design step onto the dark frame */
    const dissolve = css.match(
      /\.fg \.outlet:has\(\.dstudio\.editing\)\s*\{[^{}]*background:\s*transparent/
    );
    expect(dissolve).toBeNull();
  });
});
