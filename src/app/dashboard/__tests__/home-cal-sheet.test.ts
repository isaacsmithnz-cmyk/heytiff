import fs from "node:fs";
import path from "node:path";

/* THE CALENDAR, IN THE SHEET (H21; docs/design.md, "Home is the day, three
   tabs and the list", and its named exemptions).

   His design is the default on Home: his numbers snap to the scales by a
   move of 4px or less each, and his colours and motion are kept and named.
   Three of those promises are made by the stylesheet alone, where jsdom
   cannot see them, so they are read off the rules here:

   - Year's gaps: his 26 between rows and 30 between months, each to the
     one step of the spacing scale within 4px of it.
   - the panel's kicker is in its category's ink, overdue or not: his calDet
     turns only the capsule late, so the late red is said once.
   - what Save lands is washed as his calFresh washes it, and stands still
     under reduced motion. */

const CSS = fs
  .readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The sheet with every at-rule's block taken out (`@media`, `@container`,
    `@keyframes`…), so a rule is read as it stands for everyone. */
function topLevel(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@", i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    const open = css.indexOf("{", at);
    const semi = css.indexOf(";", at);
    if (open < 0 || (semi >= 0 && semi < open)) {
      // a statement at-rule (`@import …;`): nothing nested to drop
      i = semi < 0 ? css.length : semi + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/** Every rule outside an at-rule: its selector list and its declarations. */
function rules(): { sels: string[]; body: string }[] {
  const out: { sels: string[]; body: string }[] = [];
  for (const m of topLevel(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sels: m[1]!.split(",").map((s) => s.trim()), body: m[2]! });
  }
  return out;
}

/** The declarations of the rule whose selector list is exactly `sel`. */
function rule(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const r of rules()) {
    if (r.sels.join(", ") !== sel) continue;
    found = true;
    for (const d of r.body.split(";")) {
      const at = d.indexOf(":");
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  if (!found) throw new Error(`no rule "${sel}" in shell.css`);
  return out;
}

const SPACING = [2, 4, 8, 12, 16, 24, 32, 48];
const px = (v: string) => Number(v.replace(/px$/, ""));

describe("Year's gaps are his, snapped by 4px or less", () => {
  /* His `.cal-yg{gap:26px 30px}`, at 1440 (the prototype, v33). */
  const HIS = { rows: 26, months: 30 };

  it("puts 24 between rows of months and 32 between months, each on the scale and within 4px of his", () => {
    const [rows, months = rows] = rule(".fg .hd-cal-yg").gap!.split(/\s+/).map(px);
    for (const [his, ours] of [
      [HIS.rows, rows!],
      [HIS.months, months!],
    ] as const) {
      expect(SPACING).toContain(ours);
      expect(Math.abs(ours - his)).toBeLessThanOrEqual(4);
    }
    expect([rows, months]).toEqual([24, 32]);
  });
});

describe("the panel's kicker", () => {
  it("is coloured by its category alone, so an overdue admin date keeps the admin's ink", () => {
    const colouring = rules()
      .flatMap((r) => (/(?:^|;)\s*color\s*:/.test(r.body) ? r.sels : []))
      .filter((s) => /\.hd-cal-k$/.test(s));
    expect(colouring.length).toBeGreaterThan(0);
    for (const sel of colouring) {
      // the one condition a kicker's colour may hang on is the category
      expect(sel.replace(/\[data-c="[a-z]+"\]/g, "")).toMatch(/^\.fg (?:\.hd-cal-dx )?\.hd-cal-k$/);
    }
    expect(rule('.fg .hd-cal-dx[data-c="admin"] .hd-cal-k').color).toBe("var(--hd-cal-adm-t)");
    // the late red is his capsule's, said once
    expect(rule('.fg .hd-cal-chip[data-tone="late"]').color).toBe("var(--hd-cal-late-t)");
  });
});

describe("what Save lands", () => {
  it("stands on his event tint for 55% of 2.4 s, then eases to the choice's grey (his calFresh)", () => {
    const fresh = rule(".fg .hd-cal-it[data-fresh]");
    expect(fresh.background).toBe("var(--hd-cal-ev-tint)");
    expect(fresh.animation).toBe("hdCalFresh 2.4s var(--ease) forwards");
    const frames = CSS.match(/@keyframes hdCalFresh\s*\{([\s\S]*?\})\s*\}/);
    expect(frames).not.toBeNull();
    const steps = Object.fromEntries(
      [...frames![1]!.matchAll(/([^{}]+)\{\s*background\s*:\s*([^;}]+);?\s*\}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()]),
    );
    expect(steps).toEqual({ "0%, 55%": "var(--hd-cal-ev-tint)", to: rule(".fg .hd-cal-it[data-sel]").background });
  });

  /* The frame's reduced-motion override shortens every animation to
     nothing, which would jump the wash to its end: the wash is taken off
     by name, so the tint stands still for as long as the row is lit. */
  it("is a still tint under reduced motion", () => {
    const blocks = [...CSS.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]!);
    expect(blocks.some((b) => /\.fg \.hd-cal-it\[data-fresh\]\s*\{\s*animation\s*:\s*none\s*;?\s*\}/.test(b))).toBe(true);
  });
});
