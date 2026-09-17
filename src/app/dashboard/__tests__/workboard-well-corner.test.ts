import fs from "node:fs";
import path from "node:path";

/* THE WORKBOARD KEEPS THE SHELL'S CORNER.

   The board fills the well, and the first build of that zeroed the frame's
   own inset and the well's 16px radius along with the page's grey margin —
   so the moment the Workboard opened, its corners squared off against the
   dark shell that every other screen shows rounded ("missing the radius on
   the shell", Isaac, 2026-09-17). The frame's inset and corner belong to the
   shell, which stays still (docs/design.md); display mode is the one place
   that takes them away, because it takes the whole frame away.

   jsdom applies no stylesheet, so this reads the rules. */

type Rule = { selectors: string[]; body: string };

const RULES: Rule[] = [
  ...fs
    .readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m) => ({
  selectors: m[1]!.split(",").map((s) => s.replace(/\s+/g, " ").trim()),
  body: m[2]!,
}));

/** A rule the Workboard's full-bleed page aims at the frame's well. */
const aimsAtTheWell = (sel: string) =>
  sel.includes("wb2-full") && /\.fg \.(outlet|main)\b/.test(sel) && !sel.startsWith("html[data-wb-display]");

describe("the Workboard's well", () => {
  const onTheWell = RULES.filter((r) => r.selectors.some(aimsAtTheWell));

  it("is still reached, for its paper ground", () => {
    expect(onTheWell.some((r) => /background\s*:\s*var\(--paper\)/.test(r.body))).toBe(true);
  });

  it("keeps the frame's radius", () => {
    for (const r of onTheWell) expect(r.body).not.toMatch(/border-radius\s*:/);
  });

  it("keeps the frame's inset", () => {
    for (const r of onTheWell) expect(r.body).not.toMatch(/(?:^|;)\s*padding(?:-[a-z]+)?\s*:/);
  });
});
