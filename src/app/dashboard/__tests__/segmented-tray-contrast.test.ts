import fs from "node:fs";
import path from "node:path";

/* ── A SEGMENTED CONTROL NEEDS A TRAY YOU CAN SEE ──

   The timesheet's Worked / Off switch read as ONE button (#621). The
   largest of its three causes was that its track, `#f4f5f7`, sat inside a
   panel that composites to `#f8f8f8` — **a contrast ratio of 1.027**. With no
   tray there is nothing holding two seats together, so the white pill under
   the chosen answer becomes the only shape in the control, and the other
   answer reads as a word sitting next to a button.

   Isaac then asked for the rest of them checked. Four more were at or below
   the line and are fixed in the same commit as this file. What the sweep
   showed, and what this test encodes, is that there are TWO KINDS OF TRAY and
   only one of them can rot:

   - A tray declared as an ALPHA TINT is a tint *of whatever it lands on*, so
     it holds ~1.114 on every light ground in the app. It cannot be broken by
     being moved. Those are tested against EVERY ground.
   - A tray declared as a FIXED HEX only works on the ground it was picked
     against. `#f3f4f6` measured 1.101 on the white cards it happens to sit on
     and 1.03–1.07 on any tinted panel — one placement away from repeating the
     bug. Those are tested against the ground they actually sit on, named
     here, and moving one to a darker surface should fail this test.

   PREFER AN ALPHA TINT FOR A NEW TRAY. None is fixed any more: the house
   switch and the two controls built on it were `#e6eaf1` until v2's palette
   (18 October 2026), which has no light grey of its own, made them ink at the
   selected alpha (`--sel`), so they are checked on every ground now too.

   The floor is 1.10 and it is deliberately low: these are soft trays, not
   bordered inputs, and the house switch itself sits at 1.207 on white. What a
   tray has to do is EXIST. 1.027 does not. */

const CSS = ["src/app/tokens.css", "src/app/dashboard/shell.css"].map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");

/** Every block declared for exactly this selector, in source order — a
    selector can be written more than once (`.fg .outlet` is, and only the
    second one carries the page's colour), and the cascade takes the last. */
function blocks(selector: string): string[] {
  const out: string[] = [];
  for (let at = CSS.indexOf(`\n${selector} {`); at >= 0; at = CSS.indexOf(`\n${selector} {`, at + 1)) {
    const open = CSS.indexOf("{", at);
    out.push(CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\s+/g, " ").trim());
  }
  if (!out.length) throw new Error(`${selector} is not declared in shell.css`);
  return out;
}
/** A custom property's value, following one alias hop. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}: *([^;]+);`));
  if (!m) throw new Error(`--${name} is not declared in shell.css`);
  const raw = m[1]!.trim();
  const alias = raw.match(/^var\(--([a-z0-9-]+)\)$/i);
  return alias ? token(alias[1]!) : raw;
}

type RGBA = [number, number, number, number];
const hex = (h: string): RGBA => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
/** A colour literal or `var(--x)` as rgba. */
function colour(raw: string): RGBA {
  const v = raw.trim();
  const tok = v.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (tok) return colour(token(tok[1]!));
  if (v.startsWith("#")) return hex(v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);
  const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) throw new Error(`not a colour literal: ${raw}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}
/** A rule's own background, as rgba. */
const bgOf = (selector: string): RGBA => {
  const found = blocks(selector)
    .map((b) => b.match(/(?:^|[\s;])background(?:-color)?: *([^;]+)/))
    .filter(Boolean);
  if (!found.length) throw new Error(`${selector} declares no background`);
  return colour(found[found.length - 1]![1]!);
};

const WHITE: RGBA = [255, 255, 255, 1];
/** Lay `f` on `b`. */
const on = (f: RGBA, b: RGBA): RGBA =>
  [0, 1, 2].map((i) => f[i]! * f[3] + b[i]! * (1 - f[3])).concat(1) as RGBA;
/** A chain given outermost-first, composited down onto the card white. */
const ground = (chain: RGBA[]): RGBA => chain.reduceRight((acc, c) => on(c, acc), WHITE);

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (c: RGBA) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: RGBA, b: RGBA) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const FLOOR = 1.1;

/** Every light ground a tray lands on in this app, composited from the sheet. */
const GROUNDS: Record<string, RGBA> = {
  "a white card": WHITE,
  "the outlet": ground([bgOf(".fg .outlet")]),
  "the day panel": ground([bgOf(".fg .mts2-panel")]),
  "a form well on the page": ground([bgOf(".fg .outlet"), bgOf(".fg .lv-form")]),
  // the sunk card is a tint since the vm fold, so it is composited on the modal's white
  "the vehicle modal's sunk card": ground([colour(token("vm-sunk"))]),
};

/* ── THE HOUSE TRAY: the switch and the two controls built on it ──

   They were fixed hexes, each checked on the one ground it sat on (the day
   panel, a white card, the portalled sheet). Since v2's palette they are
   `--sel`, a tint, so they join the trays checked on every ground below. */
const HOUSE: [string, string][] = [
  [".fg .mts2-dsw", "worked / off, in the day's head"],
  [".fg .seg", "FaceSwitch and the profile Seg"],
  [".wb2-sheet .seg", "the diary filter in the portalled sheet"],
];

/* ── ALPHA TRAYS: they hold everywhere, so they are checked everywhere ── */
const ALPHA: [string, string][] = [
  ...HOUSE,
  [".fg .nb-kinds", "noticeboard — notice / poll / event"],
  [".vm-seg", "vehicle modal — history filter"],
  [".fg .hd-cal-vs", "the new Home's calendar — 4 weeks / Month / Year"],
  /* `.wb2-filters` left this list with the tray itself (2026-09-16): the
     Urgent tabs' filters are the board toolbar's chips, each with its own
     hairline, so there is no shared track left to lose against its ground. */
  [".wb2-ckseg", "workboard checklist"],
  /* `.wb2-rkind`, a reminder's at / by, left with the review card it stood
     in, when the old capture UI went (2026-09-27). */
];

describe("a tint tray survives any ground it is put on", () => {
  it.each(ALPHA)("%s (%s)", (selector) => {
    const own = bgOf(selector);
    expect(own[3]).toBeLessThan(1); // it is a tint, not a fixed value
    for (const [name, g] of Object.entries(GROUNDS)) {
      const seen = ratio(on(own, g), g);
      expect(`${name}: ${seen.toFixed(3)}`).toBe(`${name}: ${seen.toFixed(3)}`);
      expect(seen).toBeGreaterThan(FLOOR);
    }
  });
});

/* One tray value, so a control cannot look like two different controls
   depending on which screen it was opened from — which is exactly what
   `.fg .tpr .seg` was doing to FaceSwitch before it was deleted. */
it("keeps the house trays on a single value", () => {
  const values = new Set(HOUSE.map(([sel]) => bgOf(sel).join(",")));
  expect(values.size).toBe(1);
});

/* Two full tray-and-white-seat controls had no render site anywhere in `src`.
   They are gone; this is what stops them coming back with a paste. */
it.each([[".fg .dtabs"], [".fg .dtab"], [".fg .tpr .rhead .cyc"], [".fg .tpr .seg"]])(
  "%s stays deleted — it had no render site",
  (selector) => {
    expect(CSS).not.toContain(`\n${selector} {`);
  },
);
