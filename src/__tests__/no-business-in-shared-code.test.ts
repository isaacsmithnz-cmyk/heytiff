/* NO BUSINESS IS NAMED IN SHARED CODE. Every business on HeyTiff runs the
   same code, so a name, place or licence written into it — a prompt, a
   default, a heading — lands on every other business's paper. That happened
   once: the quote writer's instructions said "Diamond Air Solutions, an
   air-conditioning installer in Sydney" (2026-09-30 to 2026-10-03). A
   business's identity comes from its own Organisation row.

   Comments may name the people whose calls shaped the code; this reads the
   code with its comments taken out. Tests are left out: their fixtures are
   meant to look real. */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
/* the first workspace's identity, as it appears on its own records */
const NAMES = /Diamond Air|DAS Pty|\bIsaac Smith\b|L118650|315890C/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") sources(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/* block comments, then line comments (not a URL's "//") */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

it("names no business in the code every business runs", () => {
  const named = sources(ROOT)
    .filter((f) => NAMES.test(code(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(ROOT, f));
  expect(named).toEqual([]);
});
