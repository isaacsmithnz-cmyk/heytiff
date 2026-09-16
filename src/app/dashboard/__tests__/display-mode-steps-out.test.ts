import fs from "node:fs";
import path from "node:path";

/* DISPLAY MODE TAKES THE SHELL AWAY, AND THAT IS ITS WHOLE POINT.

   The Workboard's Display mode and the Studio's fullscreen both set an
   attribute on <html>, and one rule each hides the sidebar, the topbar and
   the frame's grid under it. Both rules lost their `display: none` the same
   way. Each ended in a `.framefx` line that also carried the body, so when
   the frame's ambient fx were deleted (#651 on the board, #681 in the
   Studio) the body went with that last line, and the three selectors above
   it fell onto the next rule down — `.main { padding: 0 }`. The sheets
   still parsed, nothing failed, and display mode kept the black shell.

   jsdom applies no stylesheet, so no render test can see this; the rule
   itself is read here. */

type Rule = { selectors: string[]; body: string };

function rules(file: string): Rule[] {
  const css = fs
    .readFileSync(path.join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(",").map((s) => s.replace(/\s+/g, " ").trim()),
    body: m[2]!,
  }));
}

const MODES = [
  { name: "the Workboard's display mode", file: "src/app/dashboard/shell.css", attr: "data-wb-display" },
  { name: "the Studio's fullscreen", file: "src/components/studio/studio.css", attr: "data-ds-display" },
];

describe.each(MODES)("$name", ({ file, attr }) => {
  const all = rules(file);
  const chrome = ["side", "topbar", "gridbg"].map((c) => `html[${attr}] .fg .${c}`);
  const main = `html[${attr}] .fg .main`;

  it.each(chrome)("hides %s", (sel) => {
    const own = all.filter((r) => r.selectors.includes(sel));
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((r) => /(?:^|;)\s*display\s*:\s*none\b/.test(r.body))).toBe(true);
  });

  it("keeps the chrome's rule apart from the well's padding", () => {
    for (const r of all.filter((r) => r.selectors.some((s) => chrome.includes(s)))) {
      expect(r.selectors).not.toContain(main);
    }
    const well = all.filter((r) => r.selectors.includes(main));
    expect(well.some((r) => /padding\s*:\s*0\b/.test(r.body))).toBe(true);
    expect(well.some((r) => /display\s*:\s*none/.test(r.body))).toBe(false);
  });
});
