import fs from "node:fs";
import path from "node:path";

/* THE TEXT TOKENS MUST STAY READABLE ON THE GROUNDS THEY LAND ON.

   This does not assert the hex values — it reads them out of shell.css and
   COMPUTES the ratio, so changing either side of a pair re-checks it. Retuning
   --ok-t re-checks it against the teal tint; changing the tint's alpha, or the
   inactive row's ground, re-checks every token that sits on it. Pinning the
   numbers instead would have let one half drift while the test kept passing.

   The grounds are the ones measured on Team and the staff card: the card white,
   the row hover, the tab strip, the panel greys, the three state tints, and the
   tint an inactive/unclaimed directory row carries — that last one is why --q
   is #5f6a79 and not the #646d7d that cleared everything else.

   Why it matters that it is a COMPUTATION and not a snapshot: --gray500 read as
   safe for a long time on the strength of 4.83 against white, while measuring
   4.32 on the tab strip and 4.22 on the red tint, which is where most of its 184
   uses actually are. A test that only checked white would have agreed with it. */

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8");

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
const ratio = (a: number[], b: number[]) => {
  const [l1, l2] = [lum(a), lum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** `over(fg, alpha, bg)` — a tint laid on a ground, which is how every chip works. */
const over = (f: number[], a: number, b: number[]) => [0, 1, 2].map((i) => f[i]! * a + b[i]! * (1 - a));

/** Pull a custom property's value out of the sheet, following one alias hop. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}: *([^;]+);`));
  if (!m) throw new Error(`--${name} is not declared in shell.css`);
  const raw = m[1]!.trim();
  const alias = raw.match(/^var\(--([a-z0-9-]+)\)$/i);
  return alias ? token(alias[1]!) : raw;
}

const WHITE = [255, 255, 255];
const GROUNDS: Record<string, number[]> = {
  "card white": WHITE,
  "row hover #fafbfc": hex("#fafbfc"),
  "inactive row #f7f8fa": hex("#f7f8fa"),
  "inactive row hover #f2f4f7": hex("#f2f4f7"),
  "tab strip #f1f2f4": hex("#f1f2f4"),
  "menu hover #f6f7f9": hex("#f6f7f9"),
  "subtle #f9fafb": hex("#f9fafb"),
};
/** A state colour is read on its own tint, and on that tint over an inactive row. */
const tintGrounds = (brand: string, alpha: number) => ({
  [`${brand} tint ${alpha}`]: over(hex(brand), alpha, WHITE),
  [`${brand} tint ${alpha} over inactive row`]: over(hex(brand), alpha, hex("#f7f8fa")),
});

const TEAL = "#00E5C0";
const AMBER = "#F0A431";
const RED = "#FF3366";

describe("dashboard text tokens clear WCAG AA on every ground they land on", () => {
  const cases: [string, string, Record<string, number[]>][] = [
    ["--q (quiet text)", token("q"), GROUNDS],
    ["--gray400 (aliases --q)", token("gray400"), GROUNDS],
    ["--gray500 (secondary text)", token("gray500"), GROUNDS],
    ["--gray700 (strong secondary)", token("gray700"), GROUNDS],
    ["--ok-t on teal tints", token("ok-t"), { ...GROUNDS, ...tintGrounds(TEAL, 0.12), ...tintGrounds(TEAL, 0.1) }],
    ["--warn-t on amber tints", token("warn-t"), { ...GROUNDS, ...tintGrounds(AMBER, 0.16), ...tintGrounds(AMBER, 0.13) }],
    ["--bad-t on red tints", token("bad-t"), { ...GROUNDS, ...tintGrounds(RED, 0.1) }],
    ["--info-t on blue tints", token("info-t"), { ...GROUNDS, ...tintGrounds("#2E68FF", 0.1) }],
  ];

  it.each(cases)("%s", (_label, value, grounds) => {
    expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    // reported as a list so a failure names every ground it missed, with the number
    const short = Object.entries(grounds)
      .map(([name, bg]) => ({ name, r: +ratio(hex(value), bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);
    expect(short).toEqual([]);
  });

  /* The licence badge derives its text from an arbitrary per-type accent, so it
     cannot be checked as a fixed pair — what is checked is the DERIVATION. 55%
     already fails on a pale yellow; if someone loosens the mix, this catches it
     for every accent a licence type could carry. */
  it("derives the id-card badge label dark enough for any accent", () => {
    const m = CSS.match(/\.idc-badge[^}]*color: *color-mix\(in srgb, *var\(--acc[^)]*\) *(\d+)%, *#000\)/);
    expect(m).not.toBeNull();
    const pct = Number(m![1]) / 100;
    for (const acc of ["#2E68FF", "#00A389", "#F0A431", "#FF3366", "#8A2BE2", "#00E5C0", "#FFEB3B", "#7CFC00", "#C0C0C0"]) {
      const bg = over(hex(acc), 0.13, WHITE);
      const fg = hex(acc).map((v) => v * pct);
      const r = ratio(fg, bg);
      if (r < 4.5) throw new Error(`accent ${acc} mixed at ${m![1]}% is ${r.toFixed(2)}:1 on its own tint`);
    }
  });
});

describe("the failing literals do not come back", () => {
  /* Comments in this sheet NAME the old hexes to explain why they left, so the
     scan reads the sheet with comments stripped — otherwise it passes or fails
     on its own prose. */
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  /* #6b7280 is here for a reason worth keeping: it was NOT in the first sweep,
     because at 4.83 on white it looked like the one grey that was fine. It has
     14 text sites, it measures 4.32 on the tab strip, and leaving it behind
     meant --gray500 resolved to one value while its own former literal said
     another — two numbers for one intent, which is the shape of most of the
     bugs in this file. A mutation test found it: the literal-scan case was
     passing vacuously, and fixing the mutation surfaced the straggler. */
  const BANNED = [
    "#9ca3af", "#aeb4c0", "#b6bcc7", "#c7ccd6", "#6b7280",
    "#00A389", "#e0264f", "#b45309", "#2E68FF",
    /* The Time & Pay stragglers, measured on the rendered screens. The first
       three are greys nobody would defend once they were measured — a zero
       bucket's figure, a "No entry" row and the empty tile's hours, at 1.64,
       1.69 and 1.86. #05887a is the one that hid longest: it was `--teal-ink`
       for `.tpr` only, so the "Approved" tag on the compact row read 3.37 on
       its own green tint while every other screen's green ink was fine. */
    "#c3c7cf", "#a7adb8", "#8f96a3", "#05887a",
  ];

  it.each(BANNED)("%s is never a text colour again", (lit) => {
    const re = new RegExp(`(^|[^-])color: *${lit}\\b`, "gi");
    const hits = code.match(re) ?? [];
    expect(hits).toEqual([]);
  });

  it("still allows them as fills and borders — this is a text rule, not a ban", () => {
    expect(code).toMatch(/background[^;]*#(00A389|e0264f|2E68FF)/i);
    expect(code).toMatch(/border-color: *#(9ca3af|aeb4c0|b6bcc7|c7ccd6|d1d5db)/i);
  });
});

/* ===== Time & Pay: a private palette, and ink that sits ON a fill =====

   Everything above checks ink on a LIGHT ground. Two whole categories were out
   of its reach, and both were failing:

   1. `.fg .tpr` redeclares its own `--red-d`, `--amber-d` and `--teal-ink` with
      the pre-sweep values. The literal scan looks for `color: #e0264f`; every
      site here writes `color: var(--red-d)`. Valid CSS, the banned value, four
      steps out of reach of the test written to catch it.

   2. The day vocabulary — tiles, rate chips, mini tiles — puts text ON a solid
      brand fill, which no "token on a light ground" case describes. White is
      right on blue, violet and the grey and WRONG on red (3.55), and the four
      light fills take a darkened same-hue ink instead.

   Both are computed from the sheet, like everything else in this file: the
   pairs are read out of the `:root`-ish blocks and multiplied, so retuning
   either half re-checks it. */

/** A custom property read from ONE rule block rather than the first match in
    the file — `--teal` is #00E5C0 on `.fg` and #22c55e on these screens, and
    the whole point is which one this surface gets. */
function scoped(selectorStart: string, name: string): string {
  const at = CSS.indexOf(selectorStart);
  if (at < 0) throw new Error(`no rule starting "${selectorStart}" in shell.css`);
  const body = CSS.slice(at, CSS.indexOf("}", at));
  const m = body.match(new RegExp(`--${name}: *([^;]+);`));
  if (!m) throw new Error(`--${name} is not declared on "${selectorStart}"`);
  const raw = m[1]!.trim();
  const alias = raw.match(/^var\(--([a-z0-9-]+)(?:, *[^)]+)?\)$/i);
  return alias ? token(alias[1]!) : raw;
}

const TP_VARS = ".fg .tpr, .fg .mts2, .fg .lv-cols";
const TP_PRIVATE = ".fg .tpr { font-variant-numeric";

describe("Time & Pay ink on a solid brand fill", () => {
  /* Every pair the day vocabulary draws — the day tile, the rate chip and the
     bucket swatch are the same nine colours at three sizes. A tenth state
     cannot reach one and miss the others, because they all read these. */
  const pairs: [string, string, string][] = [
    ["normal", scoped(TP_VARS, "on-teal"), scoped(TP_VARS, "teal")],
    ["overtime", "#4a2e05", scoped(TP_PRIVATE, "amber")],
    ["short", scoped(TP_VARS, "on-pink"), scoped(TP_VARS, "pink")],
    ["sick", scoped(TP_VARS, "on-red"), scoped(TP_PRIVATE, "red")],
    ["leave", "#ffffff", scoped(TP_PRIVATE, "blue")],
    ["public holiday", "#ffffff", scoped(TP_PRIVATE, "violet")],
    ["not worked", "#ffffff", token("gray400")],
  ];

  it.each(pairs)("%s: its ink is readable on its own fill", (_state, ink, fill) => {
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
    const r = ratio(hex(ink), hex(fill));
    if (r < 4.5) throw new Error(`${ink} on ${fill} is ${r.toFixed(2)}:1`);
  });

  /* THE ONE THAT WAS WRONG, pinned in both directions so the fix cannot be
     quietly reverted to "it looks fine". --red is a LIGHT red; the tile, the
     chip and the mini tile all carried white on it. */
  it("proves why sick cannot be white — the fill is too light to carry it", () => {
    expect(ratio(WHITE, hex(scoped(TP_PRIVATE, "red")))).toBeLessThan(4.5);
  });

  /* …and that the fill itself did NOT move. The legend swatch, the mini tile
     and the missing-day dash are all `--red`; darkening it to rescue the ink
     would have made one colour mean two things. */
  it("keeps the brand fills exactly where they were", () => {
    expect(scoped(TP_PRIVATE, "red")).toBe("#FF3366");
    expect(scoped(TP_PRIVATE, "blue")).toBe("#2E68FF");
    expect(scoped(TP_PRIVATE, "violet")).toBe("#8A2BE2");
    expect(scoped(TP_VARS, "teal")).toBe("#22c55e");
  });
});

describe("the private .tpr palette resolves to readable text", () => {
  /* These three are TEXT at every one of their ~20 sites — not one is a fill, a
     border or a dot — so they are checked as text, on the tints they land on. */
  const cases: [string, string, Record<string, number[]>][] = [
    ["--red-d (section counts, the miss tile, the bad issue banner)",
      scoped(TP_PRIVATE, "red-d"),
      { ...GROUNDS, ...tintGrounds(RED, 0.12), "bad issue banner #fdedf0": hex("#fdedf0") }],
    ["--amber-d (the overtime pill, send-back, review badges)",
      scoped(TP_PRIVATE, "amber-d"),
      { ...GROUNDS, ...tintGrounds(AMBER, 0.18), ...tintGrounds(AMBER, 0.16), ...tintGrounds(AMBER, 0.12) }],
    ["--violet-d (the public-holiday pill)",
      scoped(TP_PRIVATE, "violet-d"),
      { ...GROUNDS, ...tintGrounds("#8A2BE2", 0.12) }],
    ["--teal-ink (the approved tag and badge)",
      scoped(TP_VARS, "teal-ink"),
      { ...GROUNDS, ...tintGrounds("#22c55e", 0.15), ...tintGrounds("#22c55e", 0.13) }],
    ["--gray600 (issue bullets, the breakdown toggle, day rows)",
      scoped(TP_PRIVATE, "gray600"), GROUNDS],
  ];

  it.each(cases)("%s", (_label, value, grounds) => {
    expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    const short = Object.entries(grounds)
      .map(([name, bg]) => ({ name, r: +ratio(hex(value), bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);
    expect(short).toEqual([]);
  });

  /* The FALLBACK half of a var() fires wherever the element escapes `.tpr`, and
     it held the banned literal at every one of those sites — so the value that
     applied when the token was missing was the value the token was changed to
     stop using. */
  it.each([
    ["--red-d", "#e0264f"],
    ["--amber-d", "#b45309"],
    ["--teal-ink", "#05887a"],
  ])("%s never falls back to the value it was moved off", (tok, bad) => {
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(new RegExp(`var\\(${tok}, *${bad}\\)`, "i"));
  });
});

/* ===== `.orb-say` — the wait, named, on four surfaces and one portal =====

   The chip that says what is happening when there is nothing to show for it:
   Tiff's transcript, under its ask bar, and the three note postures — plus the
   dusk capture card, which re-points both inks.

   It is checked apart from everything above because it is the one text in the
   sheet whose GLYPHS ARE A GRADIENT. `background-clip:text` + `color:transparent`
   means a glyph is somewhere between `--say-ink` and `--say-lit` at any instant,
   so BOTH ends have to clear, and `color:` is not what paints it. That last part
   is why the failure lasted: two later rules set `color:var(--gray500)` on this
   element and win, but the word came out teal anyway, because the sweep reads
   the custom property directly. */
describe("the orb-say chip is readable on every surface it stands on", () => {
  const SAY_INK = scoped(".orb-say {", "say-ink");
  const SAY_LIT = scoped(".orb-say {", "say-lit");
  /* `.wb2-capcard.wb2-dusk` is an alpha over whatever is behind it; composited
     onto white, its own lightest possible backdrop, which is the worst case. */
  const DUSK = over(hex("#0b0e15"), 0.96, WHITE);

  /* THE GROUNDS IT ACTUALLY STANDS ON, traced site by site — not the shared
     list, which bottoms out at #f1f2f4 and would have passed this by luck.
     That is the #390 shape exactly: an audit that walks the wrong surfaces
     reports a clean bill for a screen it never measured.

     The light well is the darkest of the five, and its dot grid is the darkest
     PIXEL anywhere under the chip — 1px dots on a 26px pitch, under the ask
     bar, which a scan of `background-color` alone never sees. */
  const WELL = hex("#EDEFF4"); // .fg .outlet — under Tiff's ask bar
  const SAY_GROUNDS: Record<string, number[]> = {
    "the transcript bubble #fff (.fg .tmsg.bot .tmb)": WHITE,
    "the notes card #fff (.fg .card2)": WHITE,
    "the portalled sheet #fff (.wb2-sheet)": WHITE,
    "the light well #EDEFF4 (.fg .outlet)": WELL,
    "the light well's dot grid": over(hex("#282646"), 0.05, WELL),
    ...GROUNDS,
  };

  it.each(Object.entries(SAY_GROUNDS))("the resting ink clears on %s", (_name, bg) => {
    const r = ratio(hex(SAY_INK), bg);
    if (r < 4.5) throw new Error(`--say-ink ${SAY_INK} is ${r.toFixed(2)}:1`);
  });

  it("the lit end of the sweep clears too — a glyph is either at any moment", () => {
    for (const [name, bg] of Object.entries(SAY_GROUNDS)) {
      const r = ratio(hex(SAY_LIT), bg);
      if (r < 4.5) throw new Error(`--say-lit ${SAY_LIT} is ${r.toFixed(2)}:1 on ${name}`);
    }
  });

  /* The brand teal failed on the well by MORE than on white — 2.77 — so the
     surface that would have been reached last by a white-only check is the one
     it was worst on. */
  it("names the darkest ground, not just the lightest", () => {
    expect(ratio(hex("#00A389"), WELL)).toBeLessThan(3);
    expect(ratio(hex(SAY_INK), WELL)).toBeGreaterThanOrEqual(4.5);
  });

  /* #00A389 IS THE BRAND TEAL, AND IT IS NOT A WORD. It read 3.18 here for as
     long as the chip existed. Pinned as arithmetic so the "accent, not grey"
     note above the rule can never be read as a licence to put it back. */
  it("proves the brand teal could not have carried it", () => {
    expect(ratio(hex("#00A389"), WHITE)).toBeLessThan(4.5);
  });

  /* THE FALLBACK IS WHAT ACTUALLY PAINTS ON THE PORTALLED SURFACE. The capture
     sheet portals to document.body, so `--ok-t` — declared on `.fg` — is simply
     absent out there and `var(--ok-t, X)` resolves to X. If X and the token ever
     disagree, the portal renders a colour nothing else on the screen uses, and
     no ground-based test would see it because the token side still passes. */
  it.each([
    ["--say-ink", /--say-ink: *var\(--ok-t, *(#[0-9a-f]{6})\)/i, () => SAY_INK],
    ["--say-lit", /--say-lit: *var\(--ink, *(#[0-9a-f]{6})\)/i, () => SAY_LIT],
  ])("%s's fallback is the same colour the token resolves to", (_n, re, resolved) => {
    const m = CSS.match(re);
    expect(m).not.toBeNull();
    expect(m![1]!.toLowerCase()).toBe(resolved().toLowerCase());
  });

  it("the dusk card re-points both, and both clear on ink", () => {
    const body = CSS.slice(CSS.indexOf(".wb2-dusk .orb-say {"));
    const ink = body.match(/--say-ink: *(#[0-9a-f]{6})/i)![1]!;
    const lit = body.match(/--say-lit: *(#[0-9a-f]{6})/i)![1]!;
    expect(ratio(hex(ink), DUSK)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(lit), DUSK)).toBeGreaterThanOrEqual(4.5);
  });

  /* WHY THE DUSK RULE STAYS THOUGH IT MATCHES NOTHING TODAY.

     Traced in full: `.wb2-dusk` has four mount points and none contains a
     `<Waiting>` — the capture sheet's transcribing stage shows a bare
     `.wb2-waiting` sphere, and the recording card is the sibling branch of the
     ternary that emits the chip. So this chip has never stood on ink.

     The assertion is the arithmetic that makes the rule load-bearing the
     moment it does: the light value is BELOW 4.5 on that surface, so a dusk
     mount without the re-point is a 3:1 word. Deleting the rule as unused is
     the mistake this pins. */
  it("keeps the dusk re-point, because the light value cannot serve on ink", () => {
    expect(ratio(hex(SAY_INK), DUSK)).toBeLessThan(4.5);
    expect(CSS).toMatch(/\.wb2-dusk \.orb-say \{[^}]*--say-ink/);
  });

  /* The two rules that outranked the chip. `.fg .tvsay` is (0,2,0) and
     `.wb2-dicthint` is (0,1,0) declared 3,700 lines later — both beat
     `.orb-say` (0,1,0), so the sphere was grey in four of the five slots and
     so was the word under prefers-reduced-motion. */
  it("keeps its own colour in the slots that set a grey on the same element", () => {
    const rule = CSS.match(/\.orb-say\.tvsay, \.orb-say\.wb2-dicthint \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color: *var\(--say-ink\)/);
  });
});

/* ===== THE DARK CHROME — de-emphasis written as ALPHA =====

   Everything above is ink on a light ground. The sidebar and the topbar are the
   other polarity, and they express their quiet tiers a third way again: not a
   grey literal, not `opacity`, but `rgba(255,255,255,α)`. Every one of those is
   the SAME literal — white — so a scan for failing colours sees nothing to
   object to, and the whole ramp lives in the alpha.

   Both surfaces composite to an opaque #050505, measured in the live app, so
   the threshold is not a judgement call: it is the alpha at which white hits
   4.5:1, and that is what this derives rather than hard-codes. `.45` is the
   value that looks safe and is not — the topbar's date and role line both sat
   there at 4.46, and the sidebar's section labels sat at .3 for 2.53. */
describe("quiet text on the dark chrome", () => {
  const CHROME = hex("#050505");
  const white = (a: number) => over(WHITE, a, CHROME);

  /** The alpha at which white text clears a threshold on the chrome. */
  const alphaFor = (target: number) => {
    for (let a = 0; a <= 1; a += 0.001) if (ratio(white(a), CHROME) >= target) return a;
    return 1;
  };
  const TEXT_FLOOR = alphaFor(4.5);
  const GRAPHIC_FLOOR = alphaFor(3);

  it("derives the floors rather than trusting a value that looks quiet enough", () => {
    expect(TEXT_FLOOR).toBeGreaterThan(0.45); // the alpha that shipped, and failed
    expect(TEXT_FLOOR).toBeLessThan(0.46);
    expect(GRAPHIC_FLOOR).toBeGreaterThan(0.34);
    expect(GRAPHIC_FLOOR).toBeLessThan(0.35);
  });

  it("--on-ink-q clears the text floor with room to spare", () => {
    const m = CSS.match(/--on-ink-q: *rgba\(255,255,255,([\d.]+)\)/);
    expect(m).not.toBeNull();
    const a = Number(m![1]);
    expect(a).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(ratio(white(a), CHROME)).toBeGreaterThanOrEqual(4.5);
  });

  /* THE SWEEP. Every white-alpha `color:` under a shell selector, held to the
     text floor — scoped to the chrome, because `.wb2-dusk` (rgba(11,14,21,.96)),
     `.hm-card` (a backdrop-filter over several washes) and `.idc` are dark
     surfaces with DIFFERENT grounds and would be measured against the wrong one
     here. Those are named so the omission is a decision, not an oversight. */
  const OTHER_DARK = /wb2-dusk|wb2-capcard|wb2-caprec|wb2-toast|hm-|idc|nb-lb-open/;
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const shellText = [...code.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .flatMap(([, sel, body]) =>
      [...body!.matchAll(/(?<!-)color: *rgba\(255, *255, *255, *([\d.]+)\)/g)].map((c) => ({
        sel: sel!.trim().replace(/\s+/g, " "),
        alpha: Number(c[1]),
      })),
    )
    .filter((r) => /\.fg (\.side|\.topbar|\.nav|\.navlbl|\.ni |\.brand|\.me |\.pro|\.searchbtn|\.bell)/.test(r.sel))
    .filter((r) => !OTHER_DARK.test(r.sel));

  it("finds the shell rules at all — a filter that matches nothing passes vacuously", () => {
    expect(shellText.length).toBeGreaterThanOrEqual(3);
  });

  /* Icons are held to 3:1, not 4.5 — `.nicon` and `.si` are glyphs, and
     lifting them to the text floor would flatten the one hierarchy the sidebar
     has left. They are listed by name so that exemption is explicit. */
  const ICONS = /\.nicon|\.si\b|\.mg\b/;

  it("no word on the chrome is quieter than the floor", () => {
    const short = shellText
      .filter((r) => !ICONS.test(r.sel))
      .map((r) => ({ ...r, r: +ratio(white(r.alpha), CHROME).toFixed(2) }))
      .filter((r) => r.r < 4.5);
    expect(short).toEqual([]);
  });

  it("and no glyph on it is under the graphic bar", () => {
    const short = shellText
      .filter((r) => ICONS.test(r.sel))
      .map((r) => ({ ...r, r: +ratio(white(r.alpha), CHROME).toFixed(2) }))
      .filter((r) => r.r < 3);
    expect(short).toEqual([]);
  });

  /* THE HOVER THAT MADE IT WORSE — the one a resting scan can never see.

     The dark-frame block restyles five things on the search button: `.sf`,
     `:hover .sf`, `.si`, `:hover .si` and `.kbd`. It missed `:hover .kbd`, so
     the light-shell rule — `color:var(--ok-t)`, a green picked to be read on
     WHITE — survived at (0,4,0) against the dark override's (0,3,0), which it
     beats whatever the source order. And hovering LIFTS the ground, so the
     state meant to clarify the control took the ⌘K chip from 5.67 to 2.42.

     Asserted structurally as well as numerically: a `:hover` twin must EXIST
     in the dark block, because the failure was an absence, and an absence is
     what a colour check cannot see. */
  it("gives the search chip a dark-frame hover, and it clears on the lifted ground", () => {
    const dark = CSS.slice(CSS.indexOf("/* topbar controls restyled to read on black */"));
    const rule = dark.match(/\.fg \.searchbtn:hover \.kbd \{([^}]*)\}/);
    expect(rule).not.toBeNull();

    const bg = rule![1]!.match(/background: *rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)/);
    const fg = rule![1]!.match(/color: *(#[0-9a-f]{3,6}|rgba?\([^)]+\))/i);
    expect(bg).not.toBeNull();
    expect(fg).not.toBeNull();

    // the hovered field lifts the ground before the chip's own tint lands on it
    const lifted = over(WHITE, 0.09, CHROME);
    const chip = over([+bg![1]!, +bg![2]!, +bg![3]!], Number(bg![4]), lifted);
    /* `hex()` wants six digits and the sheet writes `#fff` — expanded here
       rather than in the sheet, because three-digit hex is idiomatic
       throughout it and a test should read what is actually written. */
    const long = (h: string) =>
      h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h;
    const ink = fg![1]!.startsWith("#") ? hex(long(fg![1]!)) : WHITE;
    expect(ratio(ink, chip)).toBeGreaterThanOrEqual(4.5);
  });

  it("proves the light-shell green could not survive being reused on black", () => {
    const lifted = over(WHITE, 0.09, CHROME);
    const teal = over(hex("#00E5C0"), 0.1, lifted);
    expect(ratio(hex(token("ok-t")), teal)).toBeLessThan(3);
  });

  /* The three that were live, pinned as arithmetic so the numbers in the sheet's
     comment cannot drift away from the sheet. */
  it.each([
    ["the sidebar's section labels", 0.3, 2.53],
    ["the topbar's date and role", 0.45, 4.46],
    ["the user menu's role line", 0.4, 3.71],
  ])("%s could not have worked at the alpha they shipped with", (_n, alpha, was) => {
    expect(+ratio(white(alpha), CHROME).toFixed(2)).toBe(was);
    expect(was).toBeLessThan(4.5);
  });
});

describe("de-emphasis never multiplies text contrast", () => {
  /* `opacity` on a container multiplies every colour inside it against the page,
     which no colour choice survives: against the tab strip's own ground, pure
     black at .5 measures 3.75. Both directory de-emphasis states used it — the
     row menu, a child of the row, came out at 2.73 on Deactivate. They tint the
     ground instead now. */
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  it.each([".dirtab", ".dirrow.off", ".dirrow.unclaimed"])("%s does not dim itself with opacity", (sel) => {
    const rule = code.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toMatch(/(^|[^-])opacity: *0?\.\d/);
  });

  /* THE SAME BUG, FOUR MORE TIMES, ON TIME & PAY — found by scanning the
     rendered pages rather than the sheet, because the multiply only shows up
     once you composite the real ancestor chain.

       .tile .wd            .85  → every weekday label on every tile: 2.10 on an
                                   empty day, 2.89 on a sick one, and 4.17/4.45/
                                   4.47 on the three otherwise clear
       .mts2-tab.* .cd      .45  → 1.87 / 1.96 / 3.22, on a TAB you click
       .bkt.zero .rchip     .3   → 1.72, on the chip naming the rate
       .crow.done           .9   → 4.42 and 3.37, for a 10% dim nobody reads as
                                   a signal anyway

     `:disabled` is deliberately NOT in this list: WCAG exempts inactive
     components, and `.mts2-btn:disabled` (4.46 on the primary) is the one pair
     on either screen still under 4.5. Left as a decision, not an oversight. */
  it.each([
    [".tile .wd", /\.tile \.wd\s*\{([^}]*)\}/],
    [".mts2-tab.offroster / .ahead labels", /\.mts2-tab\.offroster\.empty \.cd[^{]*\{([^}]*)\}/],
    [".bkt.zero .rchip", /\.bkt\.zero \.rchip\s*\{([^}]*)\}/],
  ])("%s dims by colour, not by multiply", (_name, re) => {
    const rule = code.match(re);
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toMatch(/(^|[^-])opacity: *0?\.\d/);
  });

  it(".crow.done no longer dims the whole approved row", () => {
    expect(code).not.toMatch(/\.crow\.done\s*\{[^}]*opacity/);
  });

  it("proves the arithmetic — even ink cannot survive the multiply", () => {
    const strip = hex("#f1f2f4");
    const ink = hex("#050505");
    const dimmed = over(ink, 0.5, strip);
    expect(ratio(dimmed, strip)).toBeLessThan(4.5);
  });
});
