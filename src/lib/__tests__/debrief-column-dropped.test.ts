import fs from "node:fs";
import path from "node:path";

/* The Debrief's column is dropped by docs/migrations/note_is_debrief_drop.sql
   (the new Home build, H3), with the index that served the Debrief's face.

   A DROPPED COLUMN THAT CODE STILL NAMES FAILS THE WHOLE REQUEST: a note that
   names it is not saved, and a select that names it returns nothing, which on
   this table is every diary. tsc cannot see a select list and the test fakes
   answer whatever they are asked, so this reads the source. No other table has
   a column by this name, so a plain search cannot cry wolf. The tests are left
   out: they name it on purpose, to hold that nothing sends it. */

const ROOT = process.cwd();
const SQL = fs
  .readFileSync(path.join(ROOT, "docs/migrations/note_is_debrief_drop.sql"), "utf8")
  .replace(/--.*$/gm, "");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the Debrief's column, dropped", () => {
  it("goes, and so does the index that served the Debrief's face", () => {
    expect(SQL).toMatch(/drop index if exists public\.workboard_notes_debrief_idx\s*;/);
    const block = SQL.match(/alter table public\.workboard_notes\b([^;]*);/)?.[1] ?? "";
    expect(block).toMatch(/drop column if exists is_debrief\b/);
  });

  it("is named nowhere in the app's own source", () => {
    const named = sourceFiles(path.join(ROOT, "src"))
      .filter((file) => /\bis_debrief\b/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(named).toEqual([]);
  });
});
