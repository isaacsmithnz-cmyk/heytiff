import fs from "node:fs";
import path from "node:path";

/* THE WELL RESERVES ITS SCROLLBAR ON BOTH EDGES, AND THE DUPLICATE IS THE POINT.

   `.fg .outlet` is the one scroller every screen in the app sits inside, and
   every page inside it is `.wrap` — `max-width:1500px; margin:0 auto`. Auto
   margins centre inside the CONTENT box, so reserving the scrollbar's width on
   the inline-end edge alone (`stable`) drew the whole app that width left of
   the well: 40px of gutter on the left against 51px on the right, on every
   route. `both-edges` reserves it on both and the two match.

   Measured in Chromium on a 400px scroller with an 11px scrollbar:

     auto         reserved 11 — content left 0,  right 11
     stable       reserved 11 — content left 0,  right 11
     both-edges   reserved 22 — content left 11, right 11

   TWO DECLARATIONS, AND NEITHER IS REDUNDANT. Where `both-edges` is not
   understood the whole declaration is dropped, which would leave the gutter
   unreserved and reflow the page the moment content passes the fold — the jump
   the original `stable` was there to prevent. The plain value is the fallback
   and has to stay BEFORE it. Verified through lightningcss (plain, minified,
   and with old targets): both survive the build.

   THIS TEST EXISTS BECAUSE THE BUG IS INVISIBLE LOCALLY. macOS overlay
   scrollbars take no layout width, so on a default Mac the gutter reserves
   nothing and every value looks identical; it is only real where scrollbars
   are classic (Windows, macOS "Always show scrollbars"). Nothing in the local
   loop would notice this rule being "tidied" back to one line.

   Not the Design Studio, deliberately: `studio.css` overrides this outlet with
   `auto` in the editor and `stable` on the start screen, and `.dstudio`'s own
   `padding: 18px 2px 24px 24px` is asymmetric ON PURPOSE — it hugs the dark
   frame. Centring it would fight its layout, so it keeps its own values. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

function outletBlock(): string {
  const at = CSS.indexOf(".fg .outlet {");
  if (at < 0) throw new Error("no `.fg .outlet {` rule in shell.css");
  return CSS.slice(at, CSS.indexOf("}", at));
}

const gutters = () => [...outletBlock().matchAll(/scrollbar-gutter: *([^;]+);/g)].map((m) => m[1]!.trim());

describe("the well's scrollbar gutter", () => {
  it("reserves on both edges, so a centred page is actually centred", () => {
    expect(gutters().at(-1)).toBe("stable both-edges");
  });

  it("keeps the plain fallback in front of it", () => {
    const all = gutters();
    expect(all).toHaveLength(2);
    expect(all[0]).toBe("stable");
  });
});
