import fs from "node:fs";
import path from "node:path";
import { DAY_END_EXTRA, DAY_FONTS, DAY_GAP, DAY_H } from "@/lib/dashboard/day-bar";
import { DAY_BODY_EASE, DAY_BODY_MOVE_MS, DAY_PANEL_FADE_MS } from "@/lib/dashboard/day-flip";

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
   - Nothing on a card transitions, so a press commits its widths at once —
     which is what the grow's FLIP needs to measure from; the one thing the
     sheet moves is the Trace, and it moves as a rotation.
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

/* THE TRACE (docs/design.md, the loops and the named exemptions): his light
   round the job on now. What makes it cheap is that the light TURNS — a
   rotation the compositor runs — rather than the gradient's angle being
   animated, which repaints the page on every frame; and what makes it a
   ring is two masks, which the build must not lose. */
describe("the Trace", () => {
  /** The rule with exactly this selector outside any @media — `rule` would
      fold the reduced-motion one into it. */
  const own = (sel: string): Record<string, string> & { body: string } => {
    const flat = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const m = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((x) => x[1]!.trim() === sel);
    if (!m) throw new Error(`no rule "${sel}" outside @media`);
    const out: Record<string, string> = {};
    for (const d of m[2]!.split(";")) {
      const at = d.indexOf(":");
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
    return { ...out, body: m[2]! };
  };

  it("is a ring the open card's outline wide, two masks cut from the card's edge, over the outline", () => {
    const tr = own(".fg .hd-trace");
    const outline = /inset 0 0 0 (\d+px)/.exec(rule('.fg .hd-card[aria-expanded="true"] .hd-skin::after')["box-shadow"]!)![1];
    expect(tr.border).toBe(`${outline} solid transparent`);
    expect(tr.position).toBe("absolute");
    expect(tr.inset).toBe("0");
    expect(tr["border-radius"]).toBe("inherit");
    // the outline is the skin's ::after, positioned after it: the light is raised over it
    expect(tr["z-index"]).toBe("var(--z-raised)");
    expect(tr["pointer-events"]).toBe("none");
  });

  /* Chrome before 120 reads only the prefixed pair, and `xor` is its word
     for `exclude`; the plain pair comes last so it wins where both are
     read. (Lightning CSS keeps both for Next's targets — checked on the
     real sheet when this landed.) */
  it("cuts the ring with both spellings of the masks, the plain one last", () => {
    const tr = own(".fg .hd-trace");
    const both = "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)";
    expect(tr["-webkit-mask"]).toBe(both);
    expect(tr.mask).toBe(both);
    expect(tr["-webkit-mask-composite"]).toBe("xor");
    expect(tr["mask-composite"]).toBe("exclude");
    const at = (d: string) => tr.body.search(new RegExp(`(^|[;\\s])${d.replace(/[-]/g, "\\-")}\\s*:`));
    expect(at("mask")).toBeGreaterThan(at("-webkit-mask"));
    expect(at("mask-composite")).toBeGreaterThan(at("-webkit-mask-composite"));
  });

  it("turns its light about the card's middle once every 8 seconds, as a rotation", () => {
    const light = own(".fg .hd-trace > i");
    expect(light.animation).toBe("hdTrace 8s linear infinite");
    expect(CSS).toMatch(/@keyframes hdTrace\s*\{\s*to\s*\{\s*rotate:\s*360deg;?\s*\}\s*\}/);
    // a square about the middle, the card's width plus its height across,
    // so its turning corners never come inside the ring
    expect(light.left).toBe("50%");
    expect(light.top).toBe("50%");
    expect(light.translate).toBe("-50% -50%");
    expect(light.width).toBe(`calc(100% + ${DAY_H}px)`);
    expect(light["aspect-ratio"]).toBe("1");
    // his white, as the paper's token, fading in behind the head of the light
    expect(light.background).toMatch(/^conic-gradient\(transparent 0deg 220deg, color-mix\(in srgb, var\(--paper\) 50%, transparent\) 300deg,\s+var\(--paper\) 350deg, transparent 360deg\)$/);
  });

  it("stands still under reduced motion, by name", () => {
    const still = [...CSS.matchAll(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{([^{}]*\{[^{}]*\})*[^{}]*\}/g)].map((m) => m[0]);
    expect(still.some((m) => /\.fg \.hd-trace > i\s*\{\s*animation:\s*none;?\s*\}/.test(m))).toBe(true);
  });

  it("is the one thing on the bar that moves in the sheet", () => {
    const moving = barRules(["hd-bar", "hd-row", "hd-card", "hd-skin", "hd-fill", "hd-trace", "hd-lab", "hd-tag", "hd-mid", "hd-tick"])
      .filter(({ body }) => /(^|[^-\w])(transition|animation)(-[a-z-]+)?\s*:\s*(?!none)/.test(body))
      .map(({ sel }) => sel);
    expect(moving).toEqual([".fg .hd-trace > i"]);
  });
});

/* The grow's own numbers are his (day-bar's DAY_GROW_MS, day-flip's
   DAY_GROW_EASE: named in docs/design.md); the panel's fade and the body's
   move are law 18's tokens, which the animation API cannot read, so the
   numbers it is handed are held to them here. */
describe("the motion under the bar is on the tokens", () => {
  const tokens = fs.readFileSync(path.join(process.cwd(), "src/app/tokens.css"), "utf8");
  it("fades the panel in on --t-fast and moves the body on --t-move, ease-out", () => {
    expect(tokens).toMatch(new RegExp(`--t-fast:\\s*${DAY_PANEL_FADE_MS}ms;`));
    expect(tokens).toMatch(new RegExp(`--t-move:\\s*${DAY_BODY_MOVE_MS}ms;`));
    expect(tokens).toMatch(new RegExp(`--ease:\\s*${DAY_BODY_EASE};`));
  });

  /* The body travels down to make room for the panel; on no ground of its
     own its tabs would pass over the panel's words on the way. */
  it("puts the body under the day on the page's paper, so it covers the panel it uncovers", () => {
    expect(rule(".fg .hd-body").background).toBe("var(--paper)");
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
