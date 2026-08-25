/* Guard for the armed cursor holding across the whole plan (Isaac, 2026-08-25).

   The bug: every `.ds-cur-*` rule sets the cursor on the svg ROOT, so a child
   can only receive it by inheritance — and an inherited value loses to any own
   declaration at any specificity. Four canvas children declared their own
   cursor, so the eraser disappeared over exactly the rooms you want to rub out
   and every draw tool fell back to an arrow. The neutralising rule below is
   what puts it back.

   Asserted against the stylesheet SOURCE, not a render, and that is not
   laziness — jsdom was measured on this exact question and gives a FALSE
   FAILURE: it supports `:is()` and applies the rule, but reports the literal
   keyword "inherit" rather than resolving it to the inherited value, so a
   mounted test would call the fixed canvas broken. The real behaviour was
   verified in a browser instead (see the studio-draw-tools memory). */

import { readFileSync } from "fs";
import { join } from "path";

/* comments stripped — assert on the rules, never on the prose about them */
const css = readFileSync(join(__dirname, "../studio.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** the neutralising rule, as [selector, body] */
const armedRule = (() => {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/ds-cur-/.test(sel) && /cursor:\s*inherit/.test(body)) {
      return [sel.replace(/\s+/g, " ").trim(), body] as const;
    }
  }
  return null;
})();

/** SVG element names the neutraliser reaches */
const covered = new Set(
  (armedRule?.[0].match(/:is\(([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
);

const SVG_TAGS = [
  "polygon",
  "circle",
  "rect",
  "path",
  "text",
  "line",
  "polyline",
  "ellipse",
  "g",
];

describe("the armed cursor holds across the whole plan", () => {
  it("a neutralising rule exists, scoped inside the canvas svg", () => {
    expect(armedRule).not.toBeNull();
    expect(armedRule![0]).toMatch(/svg/);
  });

  it("it applies ONLY while a tool is armed", () => {
    /* the gate is load-bearing: with nothing armed the wrapper carries no
       ds-cur-* class, so a room keeps its own default/move — dragging rooms
       is Select's job and must not be de-advertised */
    expect(armedRule![0]).toMatch(/\[class\*=("|')ds-cur-\1\]/);
  });

  it("it outranks the swallowers by specificity, not by source order", () => {
    /* :is(...) scores (0,3,2) and beats even `.ds-room.loose polygon` (0,3,1)
       outright. A bare `svg *` ties at (0,3,1) and would silently depend on
       where in this 9k-line file the rule happens to sit. */
    expect(armedRule![0]).toMatch(/:is\(/);
    expect(armedRule![0]).not.toMatch(/svg\s*\*/);
  });

  it("covers every canvas child that declares a cursor of its own", () => {
    /* the real invariant: add `.ds-newthing rect { cursor: … }` inside the
       canvas and this fails until `rect` is in the list */
    const uncovered: string[] = [];
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|[\s;])cursor:/.test(body)) continue;
      if (/ds-cur-/.test(sel)) continue; // the tool rules themselves
      for (const one of sel.split(",")) {
        const last = one.trim().split(/\s+/).pop() ?? "";
        const tag = last.match(/^([a-z]+)(?:[.:[]|$)/)?.[1];
        if (tag && SVG_TAGS.includes(tag) && !covered.has(tag)) {
          uncovered.push(`${one.trim()} → <${tag}>`);
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("covers the class-only swallowers, which render as <circle>", () => {
    /* .ds-vertex (grab) and .ds-wallsel-dot (pointer) name no tag in CSS —
       pin the cross-file fact that both are circles, so moving either onto a
       different element has to come back through this list */
    const canvas = readFileSync(join(__dirname, "../canvas.tsx"), "utf8");
    for (const cls of ["ds-vertex", "ds-wallsel-dot"]) {
      expect(canvas).toMatch(
        new RegExp(`<circle[\\s\\S]{0,200}?className="${cls}"`)
      );
    }
    expect(covered.has("circle")).toBe(true);
  });
});
