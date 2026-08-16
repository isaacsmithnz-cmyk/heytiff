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

  it("proves the arithmetic — even ink cannot survive the multiply", () => {
    const strip = hex("#f1f2f4");
    const ink = hex("#050505");
    const dimmed = over(ink, 0.5, strip);
    expect(ratio(dimmed, strip)).toBeLessThan(4.5);
  });
});
