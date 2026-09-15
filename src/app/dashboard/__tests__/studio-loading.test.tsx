/* THE STUDIO GOES DARK ON THE CLICK, AND SHOWS NO SKELETON.

   On a client navigation the App Router paints the nearest loading boundary
   under the layout the two routes share, which for /dashboard/* → /studio
   was dashboard/loading.tsx: the shell's light PageSkeleton on the light
   well. The Studio's start screen is dark, so the click went white and then
   snapped black when the page arrived. A dark skeleton was tried next and
   was wrong the other way (Isaac, 2026-09-14: grey bars on the black are a
   loading state, and this screen makes an entrance). So the route's own
   fallback is the dark alone, and this pins the three things that make it
   work:

   1. it carries the `.dstudio` root and NOT `.editing`, because studio.css
      dissolves the well and lights the frame's dot grid off exactly that
      selector — a fallback without it would be a dark hold on a white well;
   2. it holds nothing else — no bars, no shapes;
   3. the Data Library beneath it, a light page, keeps a light fallback of its
      own rather than inheriting the dark one. */

import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import StudioLoading from "../studio/loading";
import DataLibraryLoading from "../studio/data-library/loading";

const STUDIO_CSS = fs
  .readFileSync(path.join(process.cwd(), "src/components/studio/studio.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("the Design Studio's own loading boundary", () => {
  it("is the dark alone, on the root the well's dissolve keys off", () => {
    const { container } = render(<StudioLoading />);
    const root = container.querySelector(".dstudio");
    expect(root).not.toBeNull();
    expect(root).not.toHaveClass("editing");
    /* nothing drawn: no skeleton bars, no cards, nothing to press — only
       the wait, said for the reader who is not looking */
    expect(container.querySelectorAll(".ds-skb, .ds-recent, .ds-lib, .ds-hero, button, a, input")).toHaveLength(0);
    expect(container.querySelector('[role="status"]')).toHaveTextContent("Opening the Design Studio");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });

  it("is what studio.css keys the dark well on, and the start screen rises into it", () => {
    /* the fallback's root must match the selector that dissolves the well —
       if either side is renamed, the click goes white again */
    expect(STUDIO_CSS).toMatch(
      /\.fg \.outlet:has\(\.dstudio:not\(\.editing\)\)[^{]*\{[^}]*background:\s*transparent/
    );
    expect(STUDIO_CSS).toMatch(/\.fg:has\(\.dstudio:not\(\.editing\)\) \.gridbg\s*\{[^}]*opacity:\s*1/);
    /* the entrance: the stack animates in on mount, from the swap's own
       away-state, and is held off while a swap is carrying it instead */
    expect(STUDIO_CSS).toMatch(/@keyframes dsRise\s*\{\s*from\s*\{[^}]*translateY\(72px\)[^}]*opacity:\s*0/);
    expect(STUDIO_CSS).toMatch(/\.dstudio \.ds-home-stack\s*\{[^}]*animation:\s*dsRise var\(--t-move\)/);
    expect(STUDIO_CSS).toMatch(/\.dstudio\.swapping \.ds-home-stack\s*\{[^}]*animation:\s*none/);
  });

  it("the Data Library beneath it keeps the shell's light fallback", () => {
    const { container } = render(<DataLibraryLoading />);
    expect(container.querySelector(".dstudio")).toBeNull();
    expect(container.querySelector(".pk")).not.toBeNull();
  });
});
