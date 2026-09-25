import fs from "node:fs";
import path from "node:path";

/* THE NEW HOME'S FRAME, IN THE SHEET (docs/design.md, "Home is the day,
   three tabs and the list").

   Two promises Isaac asked for are made by the stylesheet, where jsdom
   cannot see them, so they are read off the rules here:

   - "the diary, calendar and tasks tabs shouldn't move positions each
     time". Choosing a tab sets it bold, and bold is wider; each tab holds a
     copy of its word at the bold weight, with no height and no paint, so it
     is as wide as its bold word from the start. That only works while the
     copy's weight IS the chosen tab's weight.
   - the slide. The faces slide past each other in one cell, and a face on
     its way must never paint over the day, the tabs or the list — so both
     cells clip, and the tabs stand outside them, pinned by where they are
     rather than by `sticky`.

   And the old one, still true: a face styled as a flex column beats the
   browser's own `[hidden]`, so hidden has to be said again. */

const CSS = fs
  .readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector list is exactly `sel`. */
function rule(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== sel) continue;
    found = true;
    for (const d of m[2]!.split(";")) {
      const at = d.indexOf(":");
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  if (!found) throw new Error(`no rule "${sel}" in shell.css`);
  return out;
}

describe("the tabs never move", () => {
  it("hold each tab's bold word at the chosen tab's own weight", () => {
    const chosen = rule(".fg .hd-tab.on")["font-weight"];
    expect(chosen).toBeDefined();
    expect(rule(".fg .hd-tabw")["font-weight"]).toBe(chosen);
  });

  it("give the held word width and nothing else: no height, no paint, no pointer", () => {
    const held = rule(".fg .hd-tabw");
    expect(held.height).toBe("0");
    expect(held.overflow).toBe("hidden");
    expect(held.visibility).toBe("hidden");
    expect(held["pointer-events"]).toBe("none");
  });

  it("stack the word over its held copy, so the tab is as wide as the wider of the two", () => {
    const t = rule(".fg .hd-tab");
    expect(t.display).toBe("inline-flex");
    expect(t["flex-direction"]).toBe("column");
  });

  it("stand the row above the body, never shrinking and never sticky", () => {
    const row = rule(".fg .hd-tabs");
    expect(row.flex).toBe("none");
    expect(row.position).toBeUndefined();
  });
});

describe("the slide stays in its cell", () => {
  it("clips the body and the diary column, so a face on its way paints over nothing", () => {
    expect(rule(".fg .hd-fx").overflow).toBe("hidden");
    expect(rule(".fg .hd-col").overflow).toBe("hidden");
  });

  it("puts the parts that slide past each other in one cell", () => {
    expect(rule(".fg .hd-fx > .hd-main, .fg .hd-fx > .hd-face")["grid-area"]).toBe("1 / 1");
    expect(rule(".fg .hd-col > .hd-face")["grid-area"]).toBe("1 / 1");
  });

  it("lets only a face scroll", () => {
    expect(rule(".fg .hd-face")["overflow-y"]).toBe("auto");
    expect(rule(".fg .hd-body")["min-height"]).toBe("0");
  });

  it("hides a hidden face and a hidden body, which their own display would otherwise beat", () => {
    expect(rule(".fg .hd-main[hidden], .fg .hd-face[hidden]").display).toBe("none");
  });
});
