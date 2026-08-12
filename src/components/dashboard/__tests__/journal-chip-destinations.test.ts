import fs from "fs";
import path from "path";
import { navHref } from "@/components/shell/nav";

/* THE CHIPS POINT AT REAL SCREENS — checked against the filesystem, because
   nothing else in the loop can check it.

   A journal chip that says "Daikin VRV commissioning notes" is a link, and a
   link is the one thing this codebase cannot typecheck: `href` is a string,
   jest renders no router, and a 404 looks exactly like a working build. The
   chips now ask the nav for the path by key (see `navHref`), so a rename that
   updates the nav carries them along — but a rename that MOVES THE ROUTE and
   forgets the nav would leave both pointing at the same dead address, and
   nobody would know until they pressed one.

   So this reads what is actually on disk. If it fails, a screen the journal
   links to has moved or gone: point the nav entry at wherever it lives now,
   or — if it is genuinely gone — take the door off the chip in
   `describeAppliedResolved` rather than leaving a link onto nothing. */

const APP = path.join(process.cwd(), "src/app");

/** Every route the App Router actually serves, read off the filesystem.
    `(group)` directories are organisational and contribute nothing to a URL,
    so they come out; a `[param]` segment is kept as-is, since none of the
    screens named here take one. */
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

/** The file behind a route, for reading its source back. */
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

/* The keys the journal's chips link by — kept here as literals on purpose.
   `navHref` throws on a key that no longer exists, so deleting the entry
   fails this test by name rather than silently rendering a chip to "". */
const CHIP_KEYS = {
  /** The knowledge-entry chip, which also carries `?doc=`. */
  kb: "tiffkb",
  /** The kept-lines chip. */
  note: "mynotes",
} as const;

describe("the journal's chip destinations", () => {
  it("reads some routes at all — a broken walker would pass everything else", () => {
    // the guard on the guard: if this walk returned nothing, every assertion
    // below would be vacuously true
    expect(routes).toContain("/dashboard");
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(CHIP_KEYS))("%s chip lands on a screen that exists", (_kind, key) => {
    expect(routes).toContain(navHref(key));
  });

  it("still hands the library a document to open", () => {
    /* `?doc=` is the whole knowledge chip: without it the link lands on the
       plain library and the person is left to find the document by hand,
       which is the behaviour the chip replaced. The param is read in the
       page's own searchParams handling — if this fails because the page was
       rewritten, put `doc` back rather than dropping the chip's door. */
    const file = pageFor(APP, navHref(CHIP_KEYS.kb));
    expect(file).not.toBeNull();
    const src = fs.readFileSync(file as string, "utf8");
    expect(src).toMatch(/params\.doc/);
    expect(src).toMatch(/initialDocId/);
  });
});
