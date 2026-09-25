import fs from "node:fs";
import path from "node:path";
import { DAY_END_EXTRA, DAY_FONTS, DAY_GAP, DAY_H } from "@/lib/dashboard/day-bar";

/* YOUR DAY, IN THE SHEET (home-day-bar.tsx; his handoff "Home - Diagonal
   day", §2). The fit in lib/dashboard/day-bar decides every card's width
   from words it measures in DAY_FONTS, and the sheet draws them; jsdom sees
   neither, so what the two must agree on is read off the rules here.

   - The words are measured in DAY_FONTS: the sheet must draw them in it.
   - A card's shape leans and its words never do. The skin takes the skew
     and the pointer; the button is a layout box the pointer passes through,
     so a click lands on the card whose shape is under it.
   - The bar clips without being a scroller, so focusing an end card cannot
     scroll the row the 44px it overhangs.
   - Still: nothing on a card transitions, so a press commits its widths at
     once — which is also what a FLIP needs to measure from.
   - His words sit where his skewed layout put them; each number below is
     worked back to his, so moving one without the other fails. */

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

/** Every rule whose selector names one of the bar's own classes. */
const barRules = (classes: string[]) =>
  [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(m[1]!)))
    .map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

const px = (v: string | undefined) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? "");
  if (!m) throw new Error(`not a px length: ${v}`);
  return Number(m[1]);
};

describe("the words are drawn in the fonts they were measured in", () => {
  it.each([
    [".fg .hd-name", DAY_FONTS.name],
    [".fg .hd-bar[data-compact] .hd-name", { px: DAY_FONTS.nameCompact.px, weight: undefined }],
    [".fg .hd-tag", DAY_FONTS.tag],
    [".fg .hd-time", DAY_FONTS.time],
  ])("%s", (sel, font) => {
    const r = rule(sel);
    expect(r["font-size"]).toBe(`${font.px}px`);
    if (font.weight !== undefined) expect(r["font-weight"]).toBe(String(font.weight));
  });

  it("gives the compact name the same weight as the name it replaces", () => {
    expect(DAY_FONTS.nameCompact.weight).toBe(DAY_FONTS.name.weight);
  });
});

describe("the shape leans, the words never do", () => {
  it("skews the skin at 45° and nothing that carries a word or the tick", () => {
    expect(rule(".fg .hd-skin").transform).toBe("skewX(45deg)");
    for (const { sel, body } of barRules(["hd-lab", "hd-tag", "hd-mid", "hd-name", "hd-time", "hd-tick"])) {
      expect(`${sel} { ${body} }`).not.toMatch(/skew/);
    }
  });

  it("lets the pointer through the card's box onto its shape, and through the words and the tick", () => {
    expect(rule(".fg .hd-card")["pointer-events"]).toBe("none");
    expect(rule(".fg .hd-skin")["pointer-events"]).toBe("auto");
    expect(rule(".fg .hd-lab")["pointer-events"]).toBe("none");
    expect(rule(".fg .hd-tick")["pointer-events"]).toBe("none");
  });

  it("fills the job on now from the left, along the slant", () => {
    const fill = rule(".fg .hd-fill");
    expect(fill["transform-origin"]).toBe("left");
    expect(fill.transform).toBe("scaleX(var(--hd-p, 0))");
  });
});

describe("the bar", () => {
  it("is a row of cards his height apart by the fit's gap, reaching half a card past each end", () => {
    const row = rule(".fg .hd-row");
    expect(row.height).toBe(`${DAY_H}px`);
    expect(row.gap).toBe(`${DAY_GAP}px`);
    expect(row.margin).toBe(`0 -${DAY_H / 2}px`);
  });

  /* `hidden` clips too, but it is a scroll container: the last card
     overhangs by 44px, and focusing it would scroll the row across. */
  it("clips the ends square without being a scroller", () => {
    const bar = rule(".fg .hd-bar");
    expect(bar.overflow).toBe("clip");
    expect(bar["overflow-x"]).toBeUndefined();
    expect(bar["overflow-y"]).toBeUndefined();
  });

  it("commits a press at once: nothing on a card transitions or animates", () => {
    for (const { sel, body } of barRules(["hd-bar", "hd-row", "hd-card", "hd-skin", "hd-fill", "hd-lab", "hd-tag", "hd-mid", "hd-tick"])) {
      expect(`${sel} { ${body} }`).not.toMatch(/(^|[^-\w])(transition|animation)(-[a-z-]+)?\s*:/);
    }
  });
});

/* The panel's words are white on a card still to come and ink on a finished
   one, so the cross takes the panel's own ink, and its hover is a step of
   that ink: his white at 60% hid a white cross. */
describe("the panel's close cross", () => {
  it("is drawn in the panel's ink, and hovers in a step of it", () => {
    expect(rule(".fg .hd-x").color).toBe("inherit");
    expect(rule(".fg .hd-x:hover").background).toMatch(/^color-mix\(in srgb, currentColor \d+%, transparent\)$/);
  });
});

describe("the open card's outline", () => {
  it("is drawn over the card's fill, and a focus ring inward where the bar would clip one outside", () => {
    expect(rule(".fg .hd-skin::after").position).toBe("absolute");
    expect(rule('.fg .hd-card[aria-expanded="true"] .hd-skin::after')["box-shadow"]).toBe("inset 0 0 0 3px var(--hd-ink)");
    expect(rule(".fg .hd-card:focus-visible .hd-skin::after")["box-shadow"]).toMatch(/^inset .*, inset 0 0 0 4px var\(--ink\)$/);
    expect(rule(".fg .hd-card:focus-visible").outline).toBe("none");
  });

  /* Found in the harness: ::before comes before the row, and the cards are
     positioned, so the left line was painted under the first card. */
  it("closes down the bar's square end on the side the open card stands at, above the cards", () => {
    expect(rule(".fg .hd-bar::before, .fg .hd-bar::after")["z-index"]).toBe("var(--z-raised)");
    expect(rule('.fg .hd-bar[data-sel-end~="first"]::before')["box-shadow"]).toBe("inset 3px 0 0 var(--hd-ink)");
    expect(rule('.fg .hd-bar[data-sel-end~="last"]::after')["box-shadow"]).toBe("inset -3px 0 0 var(--hd-ink)");
  });
});

/* HIS WORDS SAT INSIDE THE SKEWED CARD, each block straightened about its
   own middle. Straightening a block about its middle, inside a card leant
   about ITS middle, moves the block along x by (block's middle − the card's
   middle) at tan 45° = 1, and does nothing else. So each of his positions
   (handoff §2.2, §2.6) lands here moved by its own height from 44px. */
describe("his words, where his slant put them", () => {
  const MID = DAY_H / 2;

  it("the place: his 18px in, 10px down, carried back by its line's middle", () => {
    const tag = rule(".fg .hd-tag");
    const shift = px(tag.top) + px(tag["line-height"]) / 2 - MID;
    expect(px(tag.left)).toBe(18 + shift);
    // the first card's clears the square end: his 88
    expect(px(rule('.fg .hd-card[data-end~="first"] .hd-tag').left)).toBe(88 + shift);
  });

  it("the place on an open card: his 32px right of the middle, 14px down, centred", () => {
    const tag = rule(".fg .hd-tag");
    const open = rule('.fg .hd-card[aria-expanded="true"] .hd-tag');
    const shift = px(open.top) + px(tag["line-height"]) / 2 - MID;
    expect(open.left).toBe(`calc(50% + ${32 + shift}px)`);
    expect(open.transform).toBe("translateX(-50%)");
    // the end cards' middle is 40px in from the square end
    expect(rule('.fg .hd-card[aria-expanded="true"][data-end~="first"] .hd-tag').left).toBe(`calc(50% + ${72 + shift}px)`);
    expect(rule('.fg .hd-card[aria-expanded="true"][data-end~="last"] .hd-tag').left).toBe(`calc(50% - ${40 - 32 - shift}px)`);
  });

  it("the name and time: centred under his 18px, clear of the square ends by the fit's 80", () => {
    const mid = rule(".fg .hd-mid");
    const centre = px(mid.top) + (DAY_H - px(mid.top)) / 2;
    expect(mid.transform).toBe(`translateX(${centre - MID}px)`);
    expect(px(rule('.fg .hd-card[data-end~="first"] .hd-mid').left)).toBe(DAY_END_EXTRA);
    expect(px(rule('.fg .hd-card[data-end~="last"] .hd-mid').right)).toBe(DAY_END_EXTRA);
  });

  it("the tick: his bottom-right corner, 12px in and 7px up (84px in on the last card)", () => {
    const tick = rule(".fg .hd-tick");
    const shift = DAY_H - px(tick.bottom) - px(tick.height) / 2 - MID;
    expect(px(tick.right)).toBe(12 - shift);
    expect(px(rule('.fg .hd-card[data-end~="last"] .hd-tick').right)).toBe(84 - shift);
  });

  it("the tick on a card folded to it: in the middle, his 40px in from a square end", () => {
    const half = px(rule(".fg .hd-tick").width) / 2;
    const folded = rule(".fg .hd-card[data-collapsed] .hd-tick");
    expect(px(folded.top)).toBe(MID - half);
    expect(folded.right).toBe(`calc(50% - ${half}px)`);
    expect(rule('.fg .hd-card[data-collapsed][data-end~="first"] .hd-tick').right).toBe(`calc(50% - ${half + 40}px)`);
    expect(rule('.fg .hd-card[data-collapsed][data-end~="last"] .hd-tick').right).toBe(`calc(50% + ${40 - half}px)`);
  });
});
