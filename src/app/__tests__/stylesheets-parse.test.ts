import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

/* EVERY STYLESHEET PARSES — the check nothing else in the tree makes.

   Jest never loads CSS, tsc never reads it and lint never sees it, so a
   stylesheet that cannot parse passes every local check and every CI job, and
   fails only in Vercel's `next build`. On 2026-09-14 an edit that removed
   `width` and `height` declarations also ate the ends of two others in
   shell.css — `{min- flex:1;}` and `line- }` — and four production deploys in
   a row failed while every PR stayed green. This parses each stylesheet the way
   the build's PostCSS pass does, and names the line. */

function stylesheets(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const ROOT = process.cwd();
const FILES = stylesheets(path.join(ROOT, "src")).map((f) => path.relative(ROOT, f));

describe("stylesheets", () => {
  it("finds the stylesheets it guards", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)("%s parses", (file) => {
    let problem: string | null = null;
    try {
      postcss.parse(fs.readFileSync(path.join(ROOT, file), "utf8"), { from: file });
    } catch (e) {
      const err = e as { line?: number; column?: number; reason?: string };
      problem = `${file}:${err.line}:${err.column} ${err.reason}`;
    }
    expect(problem).toBeNull();
  });
});
