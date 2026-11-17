import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* SITE NOTES STAY WITH STAFF (Isaac, 14 November 2026, call 14: everyone on
   staff who can open the job sees its site's codes; "never in a customer
   email, quote or PDF", nor in Tiff's words to a customer).

   The codes live in one table, read and written in one module. This holds
   who may reach them: a file that names the table, or imports the module or
   the actions over it, must be one of these. A customer email, a quote, a
   PDF or Tiff's prompts reaching for a site's notes fails here first, and
   adding one is a decision to write down beside its name. */

const ALLOWED = new Set([
  // the table, read and written
  "src/lib/sites/site-notes-server.ts",
  // the job page's actions over it, behind the job card's gate
  "src/app/actions/site-notes.ts",
  // Tiff's site_note skill, a note's "gate code is 4471" through those same actions (note-skills, 18 November 2026)
  "src/lib/workboard/note-skills-file.ts",
  // the button and the pop-up on the job page
  "src/components/jobs/site-notes.tsx",
  // their reads by a route of their own, off the page's queue of actions (the walk of 15 November 2026)
  "src/app/api/workboard/site-notes/route.ts",
  // the list of old ServiceM8 notes for whoever runs the board to tick
  "src/app/dashboard/jobs/site-notes/page.tsx",
  "src/components/jobs/old-code-notes.tsx",
  // the phone's Site notes: the same actions, run as the token's person,
  // behind the same gate (Isaac, 15 November 2026: "Yes")
  "src/app/api/mobile/site-notes/route.ts",
]);

const ROOT = join(__dirname, "../../../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    /* iCloud's duplicates ("name 2.ts") are no part of the source */
    if (/ \d+(\.[a-z]+)?$/.test(name.replace(/\.(tsx?|css)$/, ""))) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const REACHES = /["'`]site_notes["'`]|sites\/site-notes-server|actions\/site-notes["']/;

it("lets only the job page, the phone's route and the board's list reach a site's notes", () => {
  const reaching = walk(SRC)
    .filter((f) => REACHES.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  expect(reaching.filter((f) => !ALLOWED.has(f))).toEqual([]);
});

it("keeps them out of what a customer gets", () => {
  const customer = /^src\/(lib\/(quotes|email|letters|certs|swms|tiff|brain)|app\/live|app\/api\/(email|quote)|components\/studio\/summary)\//;
  const reaching = walk(SRC)
    .filter((f) => REACHES.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  expect(reaching.filter((f) => customer.test(f))).toEqual([]);
});
