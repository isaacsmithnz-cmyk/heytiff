import fs from "fs";
import path from "path";
import { navHref } from "../nav";

/* EVERY SCREEN LINKED BY NAME IS STILL THERE — checked against the filesystem,
   because nothing else in the loop can check it.

   A link is the one thing this codebase cannot typecheck: `href` is a string,
   jest renders no router, and a 404 looks exactly like a working build. The
   same goes double for `revalidatePath`, whose failure mode is even quieter —
   nothing throws, the cache simply never clears and the screen keeps showing
   yesterday's rows.

   Callers ask the nav for a path by KEY (see `navHref`), so a rename that
   updates the nav carries all of them at once. What that CANNOT cover is a
   rename that moves the route and forgets the nav: then every caller agrees
   on the same dead address, confidently. This is the test that notices.

   It finds its own subjects: every call to navHref in the source is collected
   and its key checked, so a new caller is covered the moment it is written and
   this never goes stale behind the code it guards. (This file excludes itself
   from that sweep — the scanner naming a key would be scanning its own
   homework.)

   If it fails: point the nav entry at wherever the screen lives now. If the
   screen is genuinely gone, take the link out rather than leaving a door onto
   nothing. */

const SRC = path.join(process.cwd(), "src");
const APP = path.join(SRC, "app");

function filesUnder(dir: string, test: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, test));
    else if (test(entry.name)) out.push(full);
  }
  return out;
}

/** Every route the App Router actually serves. `(group)` directories are
    organisational and contribute nothing to a URL, so they come out. */
function routesOnDisk(dir: string, route = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "page.tsx") out.push(route || "/");
    if (!entry.isDirectory()) continue;
    const seg = entry.name.startsWith("(") && entry.name.endsWith(")") ? "" : `/${entry.name}`;
    out.push(...routesOnDisk(path.join(dir, entry.name), route + seg));
  }
  return out;
}

/** The page file behind a route, for reading its source back. */
function pageFor(dir: string, want: string, route = ""): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "page.tsx" && (route || "/") === want) return path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    const seg = entry.name.startsWith("(") && entry.name.endsWith(")") ? "" : `/${entry.name}`;
    const hit = pageFor(path.join(dir, entry.name), want, route + seg);
    if (hit) return hit;
  }
  return null;
}

const routes = routesOnDisk(APP);

/* Who asks, and for what. Collected from the source rather than listed here,
   so this covers callers written after it. */
const askedFor = (() => {
  const found = new Map<string, string[]>();
  for (const file of filesUnder(SRC, (f) => /\.tsx?$/.test(f))) {
    if (file === __filename) continue; // the scanner does not scan itself
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/navHref\(\s*"([^"]+)"\s*\)/g)) {
      const key = m[1];
      found.set(key, [...(found.get(key) ?? []), path.relative(SRC, file)]);
    }
  }
  return found;
})();

describe("the screens this app links to by name", () => {
  it("finds the callers and the routes at all", () => {
    /* The guard on the guard. A regex that matched nothing, or a walk that
       returned nothing, would make every assertion below vacuously true —
       which is the exact failure this whole file exists to prevent. */
    expect(routes).toContain("/dashboard");
    expect(routes.length).toBeGreaterThan(20);
    expect(askedFor.size).toBeGreaterThanOrEqual(4);
  });

  it("every key asked for still names a screen that exists", () => {
    const dead = [...askedFor.entries()]
      .map(([key, callers]) => ({ key, href: navHref(key), callers }))
      .filter(({ href }) => !routes.includes(href));
    // named, with their callers — a bare "false !== true" would send the next
    // person hunting for which link broke
    expect(dead).toEqual([]);
  });

  it("still hands the library a document to open", () => {
    /* `?doc=` is the whole knowledge chip in the journal: without it the link
       lands on the plain library and the person is left to find the document
       by hand, which is the behaviour the chip replaced. If this fails after a
       rewrite of that page, put `doc` back rather than dropping the chip's
       door. */
    const file = pageFor(APP, navHref("tiffkb"));
    expect(file).not.toBeNull();
    const src = fs.readFileSync(file as string, "utf8");
    expect(src).toMatch(/params\.doc/);
    expect(src).toMatch(/initialDocId/);
  });
});
