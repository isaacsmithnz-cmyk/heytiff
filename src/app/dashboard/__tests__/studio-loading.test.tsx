/* THE STUDIO GOES DARK ON THE CLICK.

   On a client navigation the App Router paints the nearest loading boundary
   under the layout the two routes share, which for /dashboard/* → /studio
   was dashboard/loading.tsx: the shell's light PageSkeleton on the light
   well. The Studio's start screen is dark, so the click went white and then
   snapped black when the page arrived. The route now has a fallback of its
   own, and this pins the two things that make it work:

   1. it carries the `.dstudio` root and NOT `.editing`, because studio.css
      dissolves the well and lights the frame's dot grid off exactly that
      selector — a fallback without it would be dark shapes on a white well;
   2. the Data Library beneath it, a light page, keeps a light fallback of its
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
  it("is the start screen's dark shapes, on the root the well's dissolve keys off", () => {
    const { container } = render(<StudioLoading />);
    const root = container.querySelector(".dstudio");
    expect(root).not.toBeNull();
    expect(root).not.toHaveClass("editing");
    /* the same places the page will draw: hero column, then the side column
       with the Recent card and the Library card */
    expect(container.querySelector(".ds-home-stack > .ds-hero")).not.toBeNull();
    expect(container.querySelector(".ds-home-stack > .ds-home-side > .ds-recent")).not.toBeNull();
    expect(container.querySelector(".ds-home-stack > .ds-home-side > .ds-lib")).not.toBeNull();
    /* held, not a preview: nothing to press, and a wait that says what it is doing */
    expect(container.querySelector("button, a, input")).toBeNull();
    expect(container.querySelector('[role="status"]')).toHaveTextContent("Opening the Design Studio");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });

  it("is what studio.css keys the dark well on", () => {
    /* the fallback's root must match the selector that dissolves the well —
       if either side is renamed, the click goes white again */
    expect(STUDIO_CSS).toMatch(
      /\.fg \.outlet:has\(\.dstudio:not\(\.editing\)\)[^{]*\{[^}]*background:\s*transparent/
    );
    expect(STUDIO_CSS).toMatch(/\.fg:has\(\.dstudio:not\(\.editing\)\) \.gridbg\s*\{[^}]*opacity:\s*1/);
  });

  it("the Data Library beneath it keeps the shell's light fallback", () => {
    const { container } = render(<DataLibraryLoading />);
    expect(container.querySelector(".dstudio")).toBeNull();
    expect(container.querySelector(".pk")).not.toBeNull();
  });
});
