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

const CSS = ["src/app/tokens.css", "src/app/dashboard/shell.css"].map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");

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
    const m = CSS.match(/\.idc-badge[^}]*color: *color-mix\(in srgb, *var\(--acc[^%]*\) *(\d+)%, *(?:#000|var\(--ink\))\)/);
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

  /* The grey half of this check used to prove the point with `border-color:
     #d1d5db` and friends. On 2026-09-10 the tokens landed and every Tailwind
     grey became `--line`, `--tint`, `--q` or `--ink`, so no grey literal is
     left to find as a border either — not because the rule grew teeth, but
     because the greys were never chosen and now are. The accent fills still
     make the point. */
  it("still allows them as fills — this is a text rule, not a ban", () => {
    expect(code).toMatch(/background[^;]*#(00A389|e0264f|2E68FF)/i);
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
    // the green moved once, on purpose: Tailwind's green-500 became the OK hue
    // at the same lightness in the Time & Pay fold (docs/design.md, the day
    // vocabulary), and the on-fill pair above re-checks it
    expect(scoped(TP_VARS, "teal")).toBe("#2EC351");
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
   Tiff's transcript, under its ask bar, and the three note postures. (The dusk
   capture card re-pointed both inks for a chip it never held; the card and
   its re-point went with the old capture UI, 2026-09-27, and so did the two
   cases that pinned it. A dark mount would need its own: the light values
   are under 4.5:1 on ink.)

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

  /* THE FALLBACK IS WHAT ACTUALLY PAINTS ON THE PORTALLED SURFACE. A sheet
     portals to document.body (the note postures' chip stands in the visit and
     agreement sheets, as it stood on the capture sheet), so `--ok-t` —
     declared on `.fg` — is simply absent out there and `var(--ok-t, X)`
     resolves to X. If X and the token ever disagree, the portal renders a
     colour nothing else on the screen uses, and no ground-based test would see
     it because the token side still passes. */
  it.each([
    ["--say-ink", /--say-ink: *var\(--ok-t, *(#[0-9a-f]{6})\)/i, () => SAY_INK],
    ["--say-lit", /--say-lit: *var\(--ink, *(#[0-9a-f]{6})\)/i, () => SAY_LIT],
  ])("%s's fallback is the same colour the token resolves to", (_n, re, resolved) => {
    const m = CSS.match(re);
    expect(m).not.toBeNull();
    expect(m![1]!.toLowerCase()).toBe(resolved().toLowerCase());
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
     text floor — scoped to the chrome, because `.wb2-dusk` (the elevated dark)
     and `.idc` are dark surfaces with DIFFERENT grounds and would be measured
     against the wrong one here. Those are named so the omission is a decision,
     not an oversight. (The old Home's dark `.hm-card` was one, and went with
     that Home.) */
  const OTHER_DARK = /wb2-dusk|wb2-capcard|wb2-caprec|wb2-toast|idc|nb-lb-open/;
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  /* The chrome's text is written as the tokens since the sweep (2026-09-15):
     `--on-ink-q` is the quiet paper, `--paper` the full one. Both resolve to an
     alpha here, so the floor is measured exactly as it was on the literals. */
  const TOKEN_ALPHA: Record<string, number> = {
    "on-ink-q": Number(CSS.match(/--on-ink-q: *rgba\(255,255,255,([\d.]+)\)/)![1]),
    paper: 1,
  };
  const shellText = [...code.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .flatMap(([, sel, body]) =>
      [...body!.matchAll(/(?<!-)color: *(?:rgba\(255, *255, *255, *([\d.]+)\)|var\(--(on-ink-q|paper)\))/g)].map((c) => ({
        sel: sel!.trim().replace(/\s+/g, " "),
        alpha: c[1] !== undefined ? Number(c[1]) : TOKEN_ALPHA[c[2]!]!,
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

    const bgRaw = rule![1]!.match(/background: *([^;]+)/)?.[1]?.trim();
    const fgRaw = rule![1]!.match(/(?<!-)color: *([^;]+)/)?.[1]?.trim();
    expect(bgRaw).toBeTruthy();
    expect(fgRaw).toBeTruthy();
    /* a literal or a token (the chrome wears the on-ink tokens since the
       sweep); `hex()` wants six digits and the sheet writes `#fff`, expanded
       here rather than in the sheet */
    const long = (h: string) =>
      h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h;
    const rgbaOf = (raw: string): [number, number, number, number] => {
      const t = raw.match(/^var\(--([a-z0-9-]+)\)$/i);
      const v = t ? token(t[1]!) : raw;
      const m = v.match(/rgba?\((\d+), *(\d+), *(\d+)(?:, *([\d.]+))?\)/);
      if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
      return [...(hex(long(v)) as [number, number, number]), 1];
    };
    const bg = rgbaOf(bgRaw!);
    const fg = rgbaOf(fgRaw!);

    // the hovered field lifts the ground before the chip's own tint lands on it
    const lifted = over(WHITE, 0.09, CHROME);
    const chip = over(bg.slice(0, 3), bg[3], lifted);
    const ink = over(fg.slice(0, 3), fg[3], chip);
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

  /* `.dirtab` left this list with the control: the directory switches on
     `shell/view-tabs` now and the fat-tab rules are deleted, so there is no
     selector left to hold to the rule. */
  it.each([".dirrow.off", ".dirrow.unclaimed"])("%s does not dim itself with opacity", (sel) => {
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

/* ===== The new Home's own colours (.hd-page, 2026-09-25) =====

   His colours are tokens on the page — a named exemption in docs/design.md,
   law 16 being his to waive — and every one that is text lands on the
   page's own fills: paper, the hover tint, the selection tint, and his quiet
   panel. Computed from the sheet like everything above, so retuning a token
   or a tint re-checks the pair.

   The late red is here because it failed. His #d6293e reads 4.95 on paper
   and 4.15 on the selection tint, so the page's one late red is `--bad-t`;
   the proof below keeps anyone from putting his back without a fill it can
   stand on. */
describe("the new Home's text tokens clear 4.5:1 on every fill the page has", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const tintOf = (name: string) => {
    const m = token(name).match(/^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/);
    if (!m) throw new Error(`--${name} is not an rgba() tint`);
    return over([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), WHITE);
  };
  const FILLS: Record<string, number[]> = {
    paper: WHITE,
    "the hover tint": tintOf("tint"),
    "the selection tint": tintOf("tint-2"),
    "his quiet panel #f4f6f8": hex("#f4f6f8"),
    "the diary's wash": hex(token("hd-fresh")),
  };
  const TEXT = ["hd-ink", "hd-body", "hd-late", "hd-today"];
  /* rules, a tick's fill and the list's quiet dot: lines and marks, held to
     nothing here; and the diary's wash, a fill, which is held above */
  const NOT_TEXT = ["hd-rule", "hd-rule2", "hd-edge", "hd-done", "hd-dot", "hd-fresh"];

  it("names every token the page declares as text or not text — a new one has to be sorted", () => {
    // the page's own rule, not a selector list it shares with the old Home's green
    const block = code.match(/(?:^|\})\s*\.fg \.hd-page \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const declared = [...block![1]!.matchAll(/--(hd-[\w-]+) *:/g)].map((m) => m[1]).sort();
    expect(declared).toEqual([...TEXT, ...NOT_TEXT].sort());
  });

  it.each(TEXT)("--%s", (name) => {
    const value = token(name);
    expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    const short = Object.entries(FILLS)
      .map(([fill, bg]) => ({ fill, r: +ratio(hex(value), bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);
    expect(short).toEqual([]);
  });

  it("proves his own late red could not serve the selection tint", () => {
    expect(ratio(hex("#d6293e"), FILLS["the selection tint"]!)).toBeLessThan(4.5);
    expect(ratio(hex("#d6293e"), WHITE)).toBeGreaterThan(4.5);
  });
});

/* ===== Your day's panel (.hd-pan, H12) =====

   The panel is painted from its card in TypeScript (`dayCardPaint`, every
   pair measured in day-bar's suite). What the SHEET paints on it is here:
   his capsule round the state word, in its three dresses, and the one
   button, ink with paper words. Read off the rules, so a retuned token or
   a swapped declaration re-checks the pair. */
describe("Your day's panel: the state capsule and the button clear 4.5:1", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  /** One declaration of the rule whose selector is exactly `sel`, its
      `var(--x)` resolved through the sheet's tokens. */
  const decl = (sel: string, prop: string): number[] => {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.trim() !== sel) continue;
      const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (!d) continue;
      const v = d[1]!.trim();
      const alias = v.match(/^var\(--([a-z0-9-]+)\)$/i);
      const value = alias ? token(alias[1]!) : v;
      if (value.toLowerCase() === "#fff") return WHITE;
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${sel} ${prop} is not a colour this test reads: ${value}`);
      return hex(value);
    }
    throw new Error(`no ${prop} on "${sel}"`);
  };
  const CHIP = ".fg .hd-chip";
  const DONE = `${CHIP}[data-state="done"]`;
  const LATE = `${CHIP}[data-state="late"]`;

  it.each([
    ["to come and on now: ink on paper", CHIP, CHIP],
    ["finished: his quiet grey on his pale", DONE, DONE],
    ["late: the late red on the capsule's paper", LATE, CHIP],
    ["Open job: paper on his ink", ".fg .hd-open", ".fg .hd-open"],
  ])("%s", (_label, text, ground) => {
    expect(+ratio(decl(text, "color"), decl(ground, "background")).toFixed(2)).toBeGreaterThanOrEqual(4.5);
  });
});

/* ===== The list (.hd-ls-*, H19) =====

   The list's words that are not the page's text tokens — the quiet count,
   a ticked title, a fact's label — and the ones that stand on a ground of
   their own: his name tag on its capsule, the verb on its paper. A row is
   paper at rest, the hover tint under the pointer and the selection tint
   while a door has lit it, so what a row says is held on all three. Read
   off the rules, a tint laid over what is under it as the page lays it:
   paper for a row, and the row's own ground for what stands on the row. */
describe("the list's words clear 4.5:1 on every ground a row has", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const colour = (v: string, under: number[]): number[] => {
    const alias = v.match(/^var\(--([a-z0-9-]+)\)$/i);
    const value = alias ? token(alias[1]!) : v;
    const tint = value.match(/^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/);
    if (tint) return over([Number(tint[1]), Number(tint[2]), Number(tint[3])], Number(tint[4]), under);
    if (value.toLowerCase() === "#fff") return WHITE;
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`not a colour this test reads: ${value}`);
    return hex(value);
  };
  /** One declaration of the rule whose selector is exactly `sel`, a tint
      laid over `under` (paper, unless said). */
  const decl = (sel: string, prop: string, under: number[] = WHITE): number[] => {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.trim() !== sel) continue;
      const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (d) return colour(d[1]!.trim(), under);
    }
    throw new Error(`no ${prop} on "${sel}"`);
  };
  const ROW = () => ({
    "at rest": WHITE,
    "under the pointer": decl(".fg .hd-ls-row.opens:hover", "background"),
    lit: decl(".fg .hd-ls-row[data-lit]", "background"),
  });
  const short = (text: number[], grounds: Record<string, number[]>) =>
    Object.entries(grounds)
      .map(([ground, bg]) => ({ ground, r: +ratio(text, bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);

  it.each([
    ["a sub-line", ".fg .hd-ls-sub"],
    ["a late sub-line", ".fg .hd-ls-sub.late"],
    ["a ticked title", ".fg .hd-ls-row.done .hd-ls-t"],
    ["a title", ".fg .hd-ls-t"],
    ["a figure", ".fg .hd-ls-fig"],
  ])("%s, on a row at rest, under the pointer and lit", (_label, sel) => {
    expect(short(decl(sel, "color"), ROW())).toEqual([]);
  });

  /* The tag stands on the row, so its capsule is laid on each of the row's
     grounds in turn: a translucent capsule darkens with the row under it,
     and #5b6472 on the selection tint laid over itself is 4.22. */
  it("his name tag, on its capsule, on a row at rest, under the pointer and lit", () => {
    const text = decl(".fg .hd-ls-tag", "color");
    const onRow = Object.fromEntries(
      Object.entries(ROW()).map(([ground, row]) => [ground, decl(".fg .hd-ls-tag", "background", row)]),
    );
    expect(short(text, onRow)).toEqual([]);
  });

  it.each([
    ["a group's count, on paper", ".fg .hd-ls-n", null],
    ["a fact's label, on paper", ".fg .hd-ls-facts dt", null],
    ["a verb, on its paper", ".fg .hd-ls-vb", ".fg .hd-ls-vb"],
  ])("%s", (_label, text, ground) => {
    const bg = ground ? decl(ground, "background") : WHITE;
    expect(+ratio(decl(text, "color"), bg).toFixed(2)).toBeGreaterThanOrEqual(4.5);
  });

  /* The calendar rail's row for the chosen thing (H21) stands on its own
     fill for as long as it is chosen: what a row says is held there too. */
  it.each([
    ["a sub-line", ".fg .hd-ls-sub"],
    ["a late sub-line", ".fg .hd-ls-sub.late"],
    ["a title", ".fg .hd-ls-t"],
  ])("%s, on the calendar rail's chosen row", (_label, sel) => {
    expect(short(decl(sel, "color"), { chosen: decl(".fg .hd-ls-row[data-pressed]", "background") })).toEqual([]);
  });
});

/* ===== The Calendar (.hd-cal-*, H21) =====

   His calendar's colours are its own tokens, declared once on `.hd-cal` (a
   named exemption, law 16), and every word it sets lands on one of a few
   fills: paper, the app's hover and selection tints, the weekend's and a
   holiday's day, his category tints, and the school holidays' hatch, which
   is read as both its stripes. Every pair is read off the sheet, a tint
   laid over what it stands on, so a retuned token or a swapped
   declaration re-checks it. */
describe("the Calendar's words clear 4.5:1 on every fill they stand on", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const calToken = (name: string): string => {
    const block = code.match(/(?:^|\})\s*\.fg \.hd-cal \{([^}]*)\}/);
    if (!block) throw new Error(".fg .hd-cal declares no tokens");
    const m = block[1]!.match(new RegExp(`--${name} *: *([^;]+);`));
    return m ? m[1]!.trim() : token(name);
  };
  /** A value as the colour it paints on `under`: a token, a hex, or a tint. */
  const colour = (v: string, under: number[] = WHITE): number[] => {
    const alias = v.match(/^var\(--([a-z0-9-]+)\)$/i);
    const value = alias ? calToken(alias[1]!) : v;
    const deeper = value.match(/^var\(--([a-z0-9-]+)\)$/i);
    if (deeper) return colour(value, under);
    const tint = value.match(/^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/);
    if (tint) return over([Number(tint[1]), Number(tint[2]), Number(tint[3])], Number(tint[4]), under);
    if (value.toLowerCase() === "#fff") return WHITE;
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`not a colour this test reads: ${value}`);
    return hex(value);
  };
  const decl = (sel: string, prop: string): string => {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1]!.split(",").map((s) => s.trim()).includes(sel)) continue;
      const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (d) return d[1]!.trim();
    }
    throw new Error(`no ${prop} on "${sel}"`);
  };
  const ink = (sel: string, under?: number[]) => colour(decl(sel, "color"), under);
  const fill = (sel: string, under?: number[]) => colour(decl(sel, "background"), under);
  /** Both stripes of his hatch. */
  const hatch = (): number[][] => [...new Set(calToken("hd-cal-hatch").match(/#[0-9a-f]{6}/gi) ?? [])].map(hex);
  const PAPER = WHITE;
  const HOVER = () => colour("var(--tint)");
  const CHOSEN = () => colour("var(--tint-2)");
  const lowest = (text: number[], grounds: number[][]) => Math.min(...grounds.map((g) => +ratio(text, g).toFixed(2)));

  it("reads its tokens at all: the hatch's two stripes and his three categories", () => {
    expect(hatch()).toHaveLength(2);
    for (const name of ["hd-cal-hol", "hd-cal-ev", "hd-cal-adm"]) expect(calToken(name)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each([
    ["a thing's title", ".fg .hd-cal-itt"],
    ["a holiday's title", '.fg .hd-cal-itt[data-c="hol"]'],
    ["the school holidays' title", '.fg .hd-cal-itt[data-c="school"]'],
    ["a thing's line", ".fg .hd-cal-s"],
    ["an event's time", ".fg .hd-cal-tm"],
  ])("4 weeks: %s, at rest, under the pointer, chosen, just saved and on a holiday's day", (_label, sel) => {
    const day = fill(".fg .hd-cal-r[data-holiday]");
    const grounds = [
      PAPER,
      HOVER(),
      CHOSEN(),
      fill(".fg .hd-cal-it[data-fresh]"),
      day,
      colour("var(--tint)", day),
      colour("var(--tint-2)", day),
    ];
    expect(lowest(ink(sel), grounds)).toBeGreaterThanOrEqual(4.5);
  });

  /* A day's date is its button (2026-09-26): lit under the pointer and
     filled while the day is chosen, on paper or on a holiday's row in the
     holiday's own tints; a quiet run's dates the same, on paper. */
  const DAY_LIT = '.fg .hd-cal-r:hover:not(:has(.hd-cal-it:hover)) .hd-cal-day:not([aria-pressed="true"])';
  const QUIET_LIT = '.fg .hd-cal-r:hover .hd-cal-qd:not([aria-pressed="true"])';
  const HOL_DAY_LIT = '.fg .hd-cal-r[data-holiday]:hover:not(:has(.hd-cal-it:hover)) .hd-cal-day:not([aria-pressed="true"])';
  const DAY_ON = '.fg .hd-cal-day[aria-pressed="true"]';
  const QUIET_ON = '.fg .hd-cal-qd[aria-pressed="true"]';
  const HOL_DAY_ON = '.fg .hd-cal-r[data-holiday] .hd-cal-day[aria-pressed="true"]';
  const dayButton = () => [PAPER, fill(DAY_LIT), fill(DAY_ON)];
  const holidayButton = () => {
    const row = fill(".fg .hd-cal-r[data-holiday]");
    return [row, fill(HOL_DAY_LIT, row), fill(HOL_DAY_ON, row)];
  };

  it.each([
    ["a week's dates", ".fg .hd-cal-wkr", () => [PAPER]],
    ["a weekday, at rest, lit and chosen", ".fg .hd-cal-dw", () => [...dayButton(), ...holidayButton()]],
    ["a weekend's date, at rest, lit and chosen", ".fg .hd-cal-r[data-weekend] .hd-cal-dn", dayButton],
    ["a holiday's date, at rest, lit and chosen", ".fg .hd-cal-r[data-holiday] .hd-cal-dn", holidayButton],
    ["Today, on today's row and on a public holiday's", ".fg .hd-cal-tl", () => [PAPER, fill(".fg .hd-cal-r[data-holiday]")]],
    [
      "a quiet run's days, at rest, lit and chosen",
      '.fg .hd-cal-r[data-kind="quiet"] > .hd-cal-d',
      () => [PAPER, fill(QUIET_LIT), fill(QUIET_ON)],
    ],
    ["a quiet run", '.fg .hd-cal-r[data-kind="quiet"] > .hd-cal-c', () => [PAPER]],
    ["a long weekend", '.fg .hd-cal-r[data-kind="quiet"] > .hd-cal-c[data-long]', () => [PAPER]],
    ["Nothing on today", ".fg .hd-cal-none", () => [PAPER]],
    ["an admin date's action", ".fg .hd-cal-ab", () => [fill(".fg .hd-cal-ab"), HOVER()]],
    ["his span tag", ".fg .hd-cal-tag", () => [fill(".fg .hd-cal-tag")]],
    ["his span tag for the school holidays", '.fg .hd-cal-tag[data-kind="school"]', hatch],
    ["the rail's Due", ".fg .hd-ls-grp.due", () => [PAPER]],
    ["the rail's Holidays ahead", ".fg .hd-ls-grp.hol", () => [PAPER]],
    ["how far away, on the rail", ".fg .hd-cal-away", () => [PAPER, HOVER(), CHOSEN()]],
    ["the range in view", ".fg .hd-cal-rt", () => [PAPER]],
    ["Today, and Today resting", ".fg .hd-cal-today", () => [PAPER, HOVER()]],
    ["Today resting", '.fg .hd-cal-today[aria-disabled="true"]', () => [PAPER]],
    ["a filter", ".fg .hd-cal-filter", () => [PAPER, HOVER()]],
    [
      "a filter turned off, at rest and under the pointer",
      '.fg .hd-cal-filter[aria-pressed="false"]',
      () => [fill('.fg .hd-cal-filter[aria-pressed="false"]'), fill('.fg .hd-cal-filter[aria-pressed="false"]:hover')],
    ],
    [
      "a filter's count, on and off, at rest and under the pointer",
      ".fg .hd-cal-n",
      () => [PAPER, HOVER(), fill('.fg .hd-cal-filter[aria-pressed="false"]:hover')],
    ],
    ["a view's word, on the tray", ".fg .hd-cal-vb", () => [fill(".fg .hd-cal-vs")]],
    ["the chosen view, on its seat", '.fg .hd-cal-vb[aria-pressed="true"]', () => [fill('.fg .hd-cal-vb[aria-pressed="true"]')]],
  ])("%s", (_label, sel, grounds) => {
    expect(lowest(ink(sel), grounds())).toBeGreaterThanOrEqual(4.5);
  });

  /* A day's date row is its button (2026-09-26), lit under the pointer
     anywhere in its cell and filled while the day is chosen: on paper or a
     weekend's cell, a chosen weekend standing on paper; on a holiday's, in
     the holiday's own tints. */
  const ROW_LIT = ".fg .hd-cal-mc[data-pick]:not([data-picked]):hover:not(:has(.hd-cal-mi:hover)) .hd-cal-dr";
  const HOL_ROW_LIT = ".fg .hd-cal-mc[data-holiday][data-pick]:not([data-picked]):hover:not(:has(.hd-cal-mi:hover)) .hd-cal-dr";
  const ROW_ON = ".fg .hd-cal-mc[data-picked] .hd-cal-dr";
  const HOL_ROW_ON = ".fg .hd-cal-mc[data-holiday][data-picked] .hd-cal-dr";
  const dateRow = () => {
    const we = fill(".fg .hd-cal-mc[data-weekend]");
    const weOn = fill(".fg .hd-cal-mc[data-weekend][data-picked]");
    return [PAPER, we, fill(ROW_LIT), fill(ROW_LIT, we), fill(ROW_ON), fill(ROW_ON, weOn)];
  };
  const weekendRow = () => {
    const we = fill(".fg .hd-cal-mc[data-weekend]");
    return [we, fill(ROW_LIT, we), fill(ROW_ON, fill(".fg .hd-cal-mc[data-weekend][data-picked]"))];
  };
  const holidayRow = () => {
    const hol = fill(".fg .hd-cal-mc[data-holiday]");
    return [hol, fill(HOL_ROW_LIT, hol), fill(HOL_ROW_ON, hol)];
  };

  it.each([
    ["a weekday's head", ".fg .hd-cal-mh span", () => [PAPER]],
    ["a date, at rest, lit and chosen", ".fg .hd-cal-dr", dateRow],
    ["a weekend's date, at rest, lit and chosen", ".fg .hd-cal-mc[data-weekend] .hd-cal-drn", weekendRow],
    ["a date in another month, at rest, lit and chosen", ".fg .hd-cal-mc[data-out] .hd-cal-drn", dateRow],
    ["a holiday's date, at rest, lit and chosen", ".fg .hd-cal-mc[data-holiday] .hd-cal-drn", holidayRow],
    ["a holiday's name, at rest, lit and chosen", '.fg .hd-cal-drm[data-kind="holiday"]', holidayRow],
    ["the month's name, at rest, lit and chosen", ".fg .hd-cal-drm", dateRow],
    ["Today, in its cell, at rest, lit and chosen", '.fg .hd-cal-drm[data-kind="today"]', dateRow],
    ["an event's bar", ".fg .hd-cal-bar", () => [fill(".fg .hd-cal-bar")]],
    ["the school holidays' bar", '.fg .hd-cal-bar[data-kind="school"]', hatch],
  ])("Month: %s", (_label, sel, grounds) => {
    expect(lowest(ink(sel), grounds())).toBeGreaterThanOrEqual(4.5);
  });

  /* A thing in a day cell stands on its cell (paper, the weekend's, or a
     public holiday's: an event can fall on Labour Day) with the pointer's
     tint over it, or on the tint of what it is once chosen. */
  it.each([
    ["its title", ".fg .hd-cal-mi"],
    ["its time or its plate", ".fg .hd-cal-mtm"],
  ])("Month: a thing's %s, on every ground it has", (_label, sel) => {
    const we = fill(".fg .hd-cal-mc[data-weekend]");
    const hol = fill(".fg .hd-cal-mc[data-holiday]");
    const grounds = [
      PAPER,
      we,
      hol,
      colour("var(--tint-2)", PAPER),
      colour("var(--tint-2)", we),
      colour("var(--tint-2)", hol),
      fill('.fg .hd-cal-mi[aria-pressed="true"]'),
      fill('.fg .hd-cal-mi[aria-pressed="true"][data-c="admin"]'),
      fill('.fg .hd-cal-mi[aria-pressed="true"][data-late]'),
      fill(".fg .hd-cal-mi[data-fresh]"),
    ];
    expect(lowest(ink(sel), grounds)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["a month's name", ".fg .hd-cal-ymt", () => [PAPER]],
    ["a month gone by", ".fg .hd-cal-ymt[data-past]", () => [PAPER]],
    ["a month's holidays", ".fg .hd-cal-ymn", () => [PAPER]],
    ["a day's letter", ".fg .hd-cal-ydl", () => [PAPER]],
    /* Every day is a button now (2026-09-26): one with nothing on it answers
       the pointer with the hover's tint. */
    ["a day, at rest and under the pointer", ".fg .hd-cal-yc", () => [PAPER, fill(".fg .hd-cal-yc:not([data-fill]):hover")]],
    [
      "a weekend day, and a day gone by, at rest and under the pointer",
      ".fg .hd-cal-yc[data-past]",
      () => [PAPER, fill(".fg .hd-cal-yc:not([data-fill]):hover")],
    ],
    ["a day in the school holidays gone by", '.fg .hd-cal-yc[data-fill="school"][data-past]', hatch],
    ["a day in a shutdown", '.fg .hd-cal-yc[data-fill="shutdown"]', () => [fill('.fg .hd-cal-yc[data-fill="shutdown"]')]],
    ["a public holiday", '.fg .hd-cal-yc[data-fill="holiday"]', () => [fill('.fg .hd-cal-yc[data-fill="holiday"]')]],
    ["a line of the key", ".fg .hd-cal-ki", () => [PAPER]],
  ])("Year: %s", (_label, sel, grounds) => {
    expect(lowest(ink(sel), grounds())).toBeGreaterThanOrEqual(4.5);
  });

  /* A quiet day (gone by, or a weekend) in the school holidays is read in
     his body grey, because the quiet grey falls short on the hatch's darker
     stripe. */
  it("proves the quiet grey could not stand on the hatch's darker stripe", () => {
    expect(lowest(colour("var(--q)"), hatch())).toBeLessThan(4.5);
    expect(lowest(colour("var(--hd-body)"), hatch())).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["an event's kicker", ".fg .hd-cal-k", () => [PAPER]],
    ["a holiday's kicker", '.fg .hd-cal-dx[data-c="hol"] .hd-cal-k', () => [PAPER]],
    ["an admin date's kicker", '.fg .hd-cal-dx[data-c="admin"] .hd-cal-k', () => [PAPER]],
    ["the school holidays' kicker", '.fg .hd-cal-dx[data-c="school"] .hd-cal-k', () => [PAPER]],
    ["when", ".fg .hd-cal-w", () => [PAPER]],
    ["his capsule, for an event", ".fg .hd-cal-chip", () => [fill(".fg .hd-cal-chip")]],
    ["his capsule, for a holiday", '.fg .hd-cal-chip[data-c="hol"]', () => [fill('.fg .hd-cal-chip[data-c="hol"]')]],
    ["his capsule, due", '.fg .hd-cal-chip[data-tone="due"]', () => [fill('.fg .hd-cal-chip[data-tone="due"]')]],
    ["his capsule, late", '.fg .hd-cal-chip[data-tone="late"]', () => [fill('.fg .hd-cal-chip[data-tone="late"]')]],
    ["his capsule, school", '.fg .hd-cal-chip[data-tone="school"]', () => [fill('.fg .hd-cal-chip[data-tone="school"]')]],
    ["a fact's label", ".fg .hd-cal-facts dt", () => [PAPER]],
    ["the action, paper on his ink", ".fg .hd-cal-go", () => [fill(".fg .hd-cal-go")]],
    /* A day chosen (2026-09-26): its things, each a row, at rest, under the
       pointer and just added. */
    [
      "a thing on the day chosen",
      ".fg .hd-cal-dli",
      () => [PAPER, fill(".fg .hd-cal-dli:hover"), fill(".fg .hd-cal-dli[data-fresh]")],
    ],
    [
      "an event's time on the day chosen",
      ".fg .hd-cal-tm",
      () => [PAPER, fill(".fg .hd-cal-dli:hover"), fill(".fg .hd-cal-dli[data-fresh]")],
    ],
    ["the day chosen, in full", ".fg .hd-cal-dxt", () => [PAPER]],
    /* The edit form (H22), on the panel's paper. */
    ["a field's label", ".fg .hd-cal-edf", () => [PAPER]],
    ["what a field holds", ".fg .hd-cal-fi", () => [fill(".fg .hd-cal-fi")]],
    [
      "a quiet button, at rest and under the pointer",
      ".fg .hd-cal-edb",
      () => [fill(".fg .hd-cal-edb"), fill(".fg .hd-cal-edb:hover:not(:disabled)")],
    ],
    ["the question before a delete", ".fg .hd-cal-edq", () => [PAPER]],
    /* While a save or a delete is out, the pressed button says "Saving…"
       or "Deleting…": quieted by colour, still read. */
    ["Save, resting while it saves", ".fg .hd-cal-go:disabled", () => [fill(".fg .hd-cal-go:disabled")]],
    ["a quiet button, resting while a change is out", ".fg .hd-cal-edb:disabled", () => [fill(".fg .hd-cal-edb")]],
  ])("the panel: %s", (_label, sel, grounds) => {
    expect(lowest(ink(sel), grounds())).toBeGreaterThanOrEqual(4.5);
  });

  /* Opacity multiplies the words with the fill: "Saving…" at .5 on his ink
     read 3.3:1, and nothing above can measure it. A resting button is
     quieted by its colour, which the rows above do measure. */
  it("never quiets a resting button by opacity, nor lights it under the pointer", () => {
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const dimmed = rules
      .filter((m) => /\.hd-cal-[\w-]+:disabled/.test(m[1]!) && /(?:^|;)\s*opacity\s*:/.test(m[2]!))
      .map((m) => m[1]!.trim());
    expect(dimmed).toEqual([]);
    const resting = new Set(rules.flatMap((m) => [...m[1]!.matchAll(/\.(hd-cal-[\w-]+):disabled/g)].map((d) => d[1]!)));
    expect(resting.size).toBeGreaterThan(0);
    const lit = rules
      .flatMap((m) => m[1]!.split(",").map((s) => s.trim()))
      .filter((s) => [...resting].some((c) => s.includes(`.${c}:hover`)) && !s.includes(":hover:not(:disabled)"));
    expect(lit).toEqual([]);
  });
});

/* ===== The diary (.hd-dy-*, H16) =====

   An entry stands on paper, and on his pale teal while it is lit — saved
   just now, or asked for by a door. Everything an entry says is held on
   both, and a door under the pointer on the hover tint laid over each. The
   Today label and "Nothing yet." stand on paper alone. Read off the rules,
   like the list's. */
describe("the diary's words clear 4.5:1 on an entry at rest and lit", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const colour = (v: string, under: number[]): number[] => {
    const alias = v.match(/^var\(--([a-z0-9-]+)\)$/i);
    const value = alias ? token(alias[1]!) : v;
    const tint = value.match(/^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/);
    if (tint) return over([Number(tint[1]), Number(tint[2]), Number(tint[3])], Number(tint[4]), under);
    if (value.toLowerCase() === "#fff") return WHITE;
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`not a colour this test reads: ${value}`);
    return hex(value);
  };
  const decl = (sel: string, prop: string, under: number[] = WHITE): number[] => {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.trim() !== sel) continue;
      const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (d) return colour(d[1]!.trim(), under);
    }
    throw new Error(`no ${prop} on "${sel}"`);
  };
  const ENTRY = () => ({ "at rest": WHITE, lit: decl(".fg .hd-dy-en[data-lit]", "background") });
  const short = (text: number[], grounds: Record<string, number[]>) =>
    Object.entries(grounds)
      .map(([ground, bg]) => ({ ground, r: +ratio(text, bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);

  it.each([
    ["who and when", ".fg .hd-dy-m"],
    ["You", ".fg .hd-dy-m b"],
    ["the words", ".fg .hd-dy-p"],
    ["a quiet line", ".fg .hd-dy-note"],
    ["a door", ".fg .hd-dy-door"],
    // H23: what Tiff made of the words, and taking it back
    ["Tiff's line", ".fg .hd-dy-tiff"],
    ["Tiff, in her line", ".fg .hd-dy-tiff b"],
    ["her line under the pointer", ".fg .hd-dy-tiff.opens:hover"],
    ["Undo", ".fg .hd-dy-undo"],
    ["Undo while it is out", '.fg .hd-dy-undo[aria-disabled="true"]'],
  ])("%s, on an entry at rest and lit", (_label, sel) => {
    expect(short(decl(sel, "color"), ENTRY())).toEqual([]);
  });

  it("a door under the pointer, on an entry at rest and lit", () => {
    const hovered = Object.fromEntries(
      Object.entries(ENTRY()).map(([ground, bg]) => [ground, decl(".fg .hd-dy-door:hover", "background", bg)]),
    );
    expect(short(decl(".fg .hd-dy-door", "color"), hovered)).toEqual([]);
  });

  it.each([
    ["Today", ".fg .hd-dy-day"],
    ["Nothing yet.", ".fg .hd-dy-none"],
  ])("%s, on paper", (_label, sel) => {
    expect(+ratio(decl(sel, "color"), WHITE).toFixed(2)).toBeGreaterThanOrEqual(4.5);
  });

  it("your initials, paper on the ink disc", () => {
    const disc = decl(".fg .hd-dy-av", "background");
    expect(+ratio(decl(".fg .hd-dy-av", "color"), disc).toFixed(2)).toBeGreaterThanOrEqual(4.5);
  });

  /* A conversation (H17): the asker's initials are ink on his grey disc, a
     tint that shows whatever it stands on — paper, or the wash while the
     conversation is lit. A message in the thread stands on paper, and on
     the wash while it is his newest and lit, and says what an entry says
     in the same rules. */
  it("their initials, ink on the grey disc, on a conversation at rest and lit", () => {
    const THEM = '.fg .hd-dy-av[data-who="them"]';
    const discs = Object.fromEntries(
      Object.entries(ENTRY()).map(([ground, bg]) => [ground, decl(THEM, "background", bg)]),
    );
    expect(short(decl(THEM, "color"), discs)).toEqual([]);
  });

  it.each([
    ["who and when", ".fg .hd-dy-m"],
    ["who", ".fg .hd-dy-m b"],
    ["the words", ".fg .hd-dy-p"],
  ])("%s, on a message in the thread at rest and lit", (_label, sel) => {
    const grounds = { "at rest": WHITE, lit: decl(".fg .hd-dy-tr[data-lit]", "background") };
    expect(short(decl(sel, "color"), grounds)).toEqual([]);
  });
});

/* ===== The Tasks face (.hd-tk-*, H20) =====

   Its rows are the list's, so what a row says is held above; what is the
   face's own is here. A row has one more ground than the list's: the one
   that is open wears the hover's fill for as long as it is open, so the
   due word is held on all four — and the late red is the reason: his
   #d6293e would fall under 4.5 on the selection tint a lit row wears.
   What opens under a row stands on paper, but for their own words, which
   sit in a well of the page's ground. */
describe("the Tasks face's words clear 4.5:1 on every ground they stand on", () => {
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const colour = (v: string, under: number[]): number[] => {
    const alias = v.match(/^var\(--([a-z0-9-]+)\)$/i);
    const value = alias ? token(alias[1]!) : v;
    const tint = value.match(/^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/);
    if (tint) return over([Number(tint[1]), Number(tint[2]), Number(tint[3])], Number(tint[4]), under);
    if (value.toLowerCase() === "#fff") return WHITE;
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`not a colour this test reads: ${value}`);
    return hex(value);
  };
  /** One declaration of the rule whose selector is exactly `sel`, a tint
      laid over `under` (paper, unless said). */
  const decl = (sel: string, prop: string, under: number[] = WHITE): number[] => {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.trim() !== sel) continue;
      const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
      if (d) return colour(d[1]!.trim(), under);
    }
    throw new Error(`no ${prop} on "${sel}"`);
  };
  const OPEN = '.fg .hd-tk .hd-ls-row:not([data-lit]):has(> .hd-ls-t[aria-expanded="true"])';
  const ROW = () => ({
    "at rest": WHITE,
    "under the pointer": decl(".fg .hd-ls-row.opens:hover", "background"),
    open: decl(OPEN, "background"),
    lit: decl(".fg .hd-ls-row[data-lit]", "background"),
  });
  const short = (text: number[], grounds: Record<string, number[]>) =>
    Object.entries(grounds)
      .map(([ground, bg]) => ({ ground, r: +ratio(text, bg).toFixed(2) }))
      .filter((x) => x.r < 4.5);

  it.each([
    ["a due word", ".fg .hd-tk-due"],
    ["a late due word", '.fg .hd-tk-due[data-state="bad"]'],
    ["today's due word", '.fg .hd-tk-due[data-state="today"]'],
  ])("%s, on a row at rest, under the pointer, open and lit", (_label, sel) => {
    expect(short(decl(sel, "color"), ROW())).toEqual([]);
  });

  it.each([
    ["a fact's label", ".fg .hd-tk-f dt"],
    ["a fact", ".fg .hd-tk-f dd"],
    ["how late a late fact is", ".fg .hd-tk-f [data-late]"],
    ["the detail", ".fg .hd-tk-note"],
    ["what happened", ".fg .hd-tk-h li"],
    ["when it happened", ".fg .hd-tk-h li > span"],
    ["the confirm's question", ".fg .hd-cf-q"],
    ["the confirm's Delete", ".fg .hd-cf-go"],
  ])("%s, on paper", (_label, sel) => {
    expect(short(decl(sel, "color"), { paper: WHITE })).toEqual([]);
  });

  it("Delete task, a red word on paper and under the pointer", () => {
    const red = decl(".fg .hd-tk-del", "color");
    expect(short(red, { paper: WHITE, "under the pointer": decl(".fg .hd-tk-del:hover", "background") })).toEqual([]);
  });

  it("Mark done: paper on his ink", () => {
    expect(+ratio(decl(".fg .hd-tk-go", "color"), decl(".fg .hd-tk-go", "background")).toFixed(2)).toBeGreaterThanOrEqual(4.5);
  });

  it("their own words and whose they are, in the well", () => {
    const well = { well: decl(".fg .hd-tk-q", "background") };
    for (const sel of [".fg .hd-tk-q figcaption", ".fg .hd-tk-q figcaption b", ".fg .hd-tk-q p"]) {
      expect({ sel, short: short(decl(sel, "color"), well) }).toEqual({ sel, short: [] });
    }
  });

  /* Where its Done stands with ServiceM8 (two-way phase 2, PR C) is drawn
     in task-sm8-line's own dress — the old Tasks face's, which came over
     with it as `.hd-tk-sm8line` — on the paper under what happened: the
     words, the state in each of its tones, and the line's doors, pressable
     and waiting. A selector is found in its rule's list, should a rule be
     shared. */
  it("where its Done stands with ServiceM8, in every tone, and its doors, on paper", () => {
    const shared = (sel: string, prop: string): number[] => {
      for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[1]!.split(",").map((x) => x.trim()).includes(sel)) continue;
        const d = m[2]!.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
        if (d) return colour(d[1]!.trim(), WHITE);
      }
      throw new Error(`no ${prop} on "${sel}"`);
    };
    for (const sel of [
      ".fg .hd-tk-sm8line",
      ".fg .hd-tk-sm8line b",
      ".fg .hd-tk-sm8line .ok",
      ".fg .hd-tk-sm8line .warn",
      ".fg .hd-tk-sm8line .bad",
      ".fg .hd-tk-sm8door",
      ".fg .hd-tk-sm8door:disabled",
    ]) {
      expect({ sel, short: short(shared(sel, "color"), { paper: WHITE }) }).toEqual({ sel, short: [] });
    }
  });
});
