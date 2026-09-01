/* The only thing that makes `palette.ts` safe to exist.

   That file is a hand-copy of colours that are already written down in two
   stylesheets, because Auth0 and Gmail cannot read a stylesheet. A copy with
   nothing checking it is how a brand ends up with two palettes and a sign-in
   page that is nearly right. This reads both sheets and asserts, token by
   token, that the copy still says what the original says.

   To see it fail: change any value in palette.ts, or re-point `--q` in
   shell.css, and run this. It names the token. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND, WHITE, inputBorderOnWhite, flattenOnWhite } from "../palette";

const root = join(__dirname, "../../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every `--token: #hex` in a sheet, first definition wins — the later ones
    are scoped overrides, and the first is the one the tokens are declared at. */
function customProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
    if (!out.has(m[1])) out.set(m[1], m[2].toUpperCase());
  }
  return out;
}

const globals = customProperties(read("src/app/globals.css"));
const shell = customProperties(read("src/app/dashboard/shell.css"));

describe("the Auth0 palette is the app's palette", () => {
  const sheets = { "globals.css": globals, "shell.css": shell };

  /* [our key, the token it claims to be, the sheet that declares it] */
  const claims: [keyof typeof BRAND, string, keyof typeof sheets][] = [
    ["teal", "color-brand-teal", "globals.css"],
    ["tealDark", "color-brand-teal-dark", "globals.css"],
    ["blue", "color-brand-blue", "globals.css"],
    ["ink", "color-ink-2", "globals.css"],
    ["surface", "color-surface", "globals.css"],
    ["line", "color-surface-line", "globals.css"],
    ["body", "gray700", "shell.css"],
    ["quiet", "q", "shell.css"],
    ["okText", "ok-t", "shell.css"],
    ["badText", "bad-t", "shell.css"],
  ];

  it.each(claims)("%s is --%s in %s", (key, token, sheet) => {
    const declared = sheets[sheet].get(token);
    expect(declared).toBeDefined();
    expect(BRAND[key].toUpperCase()).toBe(declared);
  });

  /* globals.css mirrors shell.css's `--q` as `--color-quiet`, so the screens
     outside `.fg` (the front door) have a quiet tier that clears AA instead
     of reaching for a Tailwind grey. A mirror is only safe while something
     checks it. */
  it("the two quiet tokens are the same grey", () => {
    expect(globals.get("color-quiet")).toBe(shell.get("q"));
  });

  it("covers every colour the Auth0 surfaces use", () => {
    // A value added to BRAND without a claim above would go unchecked.
    const claimed = new Set(claims.map(([k]) => k));
    expect(Object.keys(BRAND).filter((k) => !claimed.has(k as never))).toEqual([]);
  });
});

describe("the input border is derived, not chosen", () => {
  it("is the app's rgba(10,11,16,.14) flattened onto white", () => {
    // Re-derived here rather than compared to a literal: the point of the
    // value is the rule, not the hex.
    expect(inputBorderOnWhite).toBe(flattenOnWhite(BRAND.ink, 0.14));
  });

  it("is the border shell.css actually draws", () => {
    expect(read("src/app/dashboard/shell.css")).toContain("rgba(10,11,16,.14)");
  });

  it("lands between the hairline and the body text", () => {
    // A sanity floor/ceiling: a border that came out darker than body text or
    // lighter than the card hairline means the flatten is wrong, not subtle.
    const lum = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(inputBorderOnWhite)).toBeLessThan(lum(BRAND.line));
    expect(lum(inputBorderOnWhite)).toBeGreaterThan(lum(BRAND.body));
  });
});

describe("no invented shades", () => {
  it("every value is a 6-digit hex", () => {
    for (const [name, value] of Object.entries({ ...BRAND, WHITE, inputBorderOnWhite })) {
      expect(`${name}=${value}`).toMatch(/=#[0-9A-F]{6}$/);
    }
  });
});
