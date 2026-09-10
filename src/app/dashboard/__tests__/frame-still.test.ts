import fs from "node:fs";
import path from "node:path";

/* THE FRAME IS STILL.

   docs/design.md, decisions of 2026-09-10: the dark frame keeps its rail, its
   bar and its light well, and nothing in it moves or glows. The aurora blobs
   and the rising orbs, the corner glow, the active item's glow, the avatar's
   gradient ring and its status dot all go. The active item is white. A hover
   changes one thing, a colour, and slides nothing. The only light on the
   screen is the content well.

   The aurora was a deliberate choice in July (the one-piece frame), which is
   why this is a test and not a comment: it was the single most-named tell of
   2026, and the decision to take it down was Isaac's, after the three ways
   out were rendered side by side. Reads the stylesheets and the three shell
   components as text, the way the other frame guards do, so the frame cannot
   quietly get its glow back. */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const SHELL = rules(read("src/app/dashboard/shell.css"));
const STUDIO = rules(read("src/components/studio/studio.css"));

/** Every declaration block whose selector list mentions `sel`. */
function blocksFor(css: string, sel: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) if (m[1].includes(sel)) out.push(m[2]);
  return out;
}

describe("the frame is still", () => {
  it("has no ambient light: no frame fx, no roaming or rising keyframes, no corner glow", () => {
    expect(blocksFor(SHELL, ".framefx")).toHaveLength(0);
    expect(SHELL).not.toMatch(/@keyframes\s+fgRoam/);
    expect(SHELL).not.toMatch(/@keyframes\s+fgRiseGlow/);
    expect(blocksFor(SHELL, ".side .glow")).toHaveLength(0);
  });

  it("renders no frame fx, no rail glow, and no glow inside the command palette", () => {
    expect(read("src/components/shell/app-shell.tsx")).not.toMatch(/framefx/);
    expect(read("src/components/shell/sidebar.tsx")).not.toMatch(/className="glow"/);
    expect(read("src/components/shell/command-palette.tsx")).not.toMatch(/className="glow"/);
    expect(blocksFor(SHELL, ".box .glow")).toHaveLength(0);
  });

  it("lights the active item white, with no glow and no bar at its edge", () => {
    const on = blocksFor(SHELL, ".ni.on .nicon");
    expect(on.length).toBeGreaterThan(0);
    for (const body of on) {
      expect(body).toMatch(/background\s*:\s*#fff\b/);
      expect(body).not.toMatch(/box-shadow/);
    }
    expect(blocksFor(SHELL, ".nibg")).toHaveLength(0);
    expect(read("src/components/shell/sidebar.tsx")).not.toMatch(/nibg/);
  });

  it("slides and scales nothing on hover or when active", () => {
    for (const body of blocksFor(SHELL, ".ni:hover")) expect(body).not.toMatch(/transform/);
    for (const body of blocksFor(SHELL, ".ni.on .nlbl")) expect(body).not.toMatch(/transform/);
  });

  it("gives the avatar a hairline, not a gradient, and no dot", () => {
    const ring = blocksFor(SHELL, ".av .ring");
    expect(ring.length).toBeGreaterThan(0);
    for (const body of ring) expect(body).not.toMatch(/gradient/);
    expect(blocksFor(SHELL, ".av .st")).toHaveLength(0);
    expect(read("src/components/shell/topbar.tsx")).not.toMatch(/className="st"/);
  });

  it("leaves the Studio start screen its dot grid and takes its glow field", () => {
    const start = blocksFor(STUDIO, ".dstudio:not(.editing)) .gridbg");
    expect(start.length).toBeGreaterThan(0);
    for (const body of start) {
      expect(body).toMatch(/radial-gradient\(rgba\(255,\s*255,\s*255/); // the dot grid stays
      expect(body).not.toMatch(/rgba\(0,\s*229,\s*192|rgba\(46,\s*104,\s*255|rgba\(138,\s*43,\s*226/);
    }
  });

  it("gives the front door no blurred light either", () => {
    expect(read("src/app/page.tsx")).not.toMatch(/blur-\[/);
  });
});
