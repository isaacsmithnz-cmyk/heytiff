import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/components/shell/nav";
import { ICON_PATHS } from "@/components/shell/icon";
import { KB_CATEGORIES } from "../kb";

/* IT IS CALLED THE LIBRARY. ONE NAME, NOT FOUR.

   The audit found this feature answering to four words at once: "Knowledge" on
   the sidebar row, "Knowledge base" as the page's own heading, "the library"
   throughout the assistant's copy, and "shelves" for its categories — plus a
   category literally named "Fault code library", a library inside the library.
   Nobody could be sure they were all the same thing, which is the whole cost.

   The assistant's own sentences had already settled on `library` ("Open
   library", "in your library", "Search the library for this"), so that is the
   word that won and everything else was moved onto it, the route included.

   This test exists because that kind of drift is invisible in review — each
   individual "knowledge base" reads fine on its own line. Asserted against the
   SOURCE rather than a render: the strings are spread over a dozen files and
   several of them are error paths a test would have to provoke one at a time. */

const TIFF_DIR = join(process.cwd(), "src/components/tiff");
const SRC = join(process.cwd(), "src");

/** Every .ts/.tsx under a directory, tests excluded. */
function sourcesIn(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => ({ file: e.name, text: readFileSync(join(dir, e.name), "utf8") }));
}

/** The same, recursively, with repo-relative paths — `__tests__` skipped. */
function sourcesUnder(dir: string, rel = ""): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      return e.name === "__tests__" ? [] : sourcesUnder(join(dir, e.name), path);
    }
    return /\.tsx?$/.test(e.name)
      ? [{ file: path, text: readFileSync(join(dir, e.name), "utf8") }]
      : [];
  });
}

/** Source with `/* *\/` blocks, `//` lines and JSX `{/* *\/}` comments removed —
    what is left is roughly what a person could end up reading. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

describe("the library's vocabulary", () => {
  it("is called Library on the nav row, and the catalogue is a view of it", () => {
    /* The SECTION is the library now. The row used to be "Tiff AI" with a
       "Library" face hanging off it, which made the library a sub-part of an
       AI product; it is the other way round — the documents are the product
       and asking is what you do to them.

       So the face is "All documents", not a second "Library": ⌘K would
       otherwise offer two identical words landing on different screens, which
       is the exact confusion the last rename spent a route move to clear. */
    const row = NAV.find((n) => n.key === "tiff");
    expect(row?.label).toBe("Library");
    expect(row?.href).toBe("/dashboard/tiff");

    const entry = NAV.find((n) => n.key === "tiffkb");
    expect(entry?.label).toBe("All documents");
    expect(entry?.href).toBe("/dashboard/tiff/library");
    expect(entry?.label).not.toBe(row?.label);
  });

  it("never calls itself AI where a person can read it", () => {
    /* THE POSITIONING, PINNED. Every tool in this market is shipping the same
       sparkle and the same "AI" badge, and that badge now carries its own
       reading: a thing that answers confidently and is sometimes wrong. This
       feature is the opposite claim — a shelf of documents the company
       uploaded, and answers that cite the page they came from — so it is named
       after the documents and never after the technique.

       Tiff is still allowed to be Tiff: the brand is not the problem, the
       category label was. Checked over source with comments stripped, because
       a comment explaining why we don't say AI has to be able to say AI. */
    const said = sourcesIn(TIFF_DIR)
      .filter(({ text }) => /\bAI\b/.test(stripComments(text)))
      .map(({ file }) => file);
    expect(said).toEqual([]);
  });

  it("never says 'knowledge base' anywhere a person can read it", () => {
    const offenders = sourcesIn(TIFF_DIR)
      .filter(({ text }) => /knowledge base/i.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("gives no category the sparkle, and every icon it does name exists", () => {
    /* Field notes wore ✨ — on the ONE shelf with no machine anywhere near it.
       A person on a roof said what they learned, and the card claimed the
       opposite, wearing the badge the rest of this surface had just given up.

       The second half of this is the cheaper bug: an icon name that isn't in
       ICON_PATHS renders a blank 24×24 box. Nothing throws, nothing types
       wrong, and only a screenshot ever catches it — which is why the last one
       shipped. `note` is real; assert it rather than trusting it. */
    for (const c of KB_CATEGORIES) {
      expect(c.icon).not.toBe("sparkles");
      expect(ICON_PATHS).toHaveProperty(c.icon);
    }
  });

  it("has no library inside the library", () => {
    // "Fault code library" was one of the four category names
    const nested = KB_CATEGORIES.filter((c) => /library/i.test(c.label));
    expect(nested).toEqual([]);
  });

  it("calls a category a category on screen, not a shelf", () => {
    /* `shelf` survives in the research animation's internals, where it names
       the four cards a search line reaches for, and that is fine — it is not a
       word anyone reads. It must not reach rendered copy, where it would be a
       second name for `category` on the same screen.

       So the check is over the source with COMMENTS REMOVED, not over lines
       that merely start with a comment marker: every one of these lives
       mid-block, where the marker is three lines up. */
    const rendered = sourcesIn(TIFF_DIR).filter(({ text }) =>
      /shel(f|ves)/i.test(stripComments(text))
    );
    expect(rendered.map((r) => r.file)).toEqual([]);
  });
});

/* ── THE SAME RULES, EVERYWHERE ─────────────────────────────────────────────

   THIS IS WHY THE RENAME LEAKED. Everything above scans `components/tiff` and
   only that, so #380 could ban the AI badge on the Library's own screens and
   leave it intact on the eleven places outside them — the ⌘K footer, the whole
   of Fleet, the note token, the Studio's "AI screening" button — plus seven
   surviving "knowledge base" strings in Admin, Notes and two error paths.
   Every one of those read fine on its own line. A directory-shaped guard
   cannot see any of it.

   These two walk `src`. */

const SPARKLE = /name="sparkles"|icon:\s*"sparkles"/;

/* Files whose "knowledge base" is addressed to the MODEL, not to a person:
   system prompts and tool descriptions. Left alone on purpose — that text is
   an instruction whose wording steers retrieval, and "library" is the vaguer
   word to a model. This list should only ever shrink for that reason, never
   because a new screen was easier to add here than to fix. */
const MODEL_FACING = [
  "lib/brain/ask.ts",
  "lib/brain/tools.ts",
  "lib/workboard/note-brain.ts",
  "app/api/brain/ask/route.ts",
];

describe("the same rules, everywhere in src", () => {
  it("renders the sparkle nowhere in the app", () => {
    /* The badge every AI tool in the market wears, and the one this product
       is positioned against: what is behind these screens is the company's
       own documents and its own crew, cited. `sparkles` stays in ICON_PATHS —
       deleting a registry entry is a different kind of change — but nothing
       may reach for it. */
    const offenders = sourcesUnder(SRC)
      .filter(({ file }) => !file.endsWith("shell/icon.tsx"))
      .filter(({ text }) => SPARKLE.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("says 'library' to people, and keeps 'knowledge base' for the model", () => {
    const offenders = sourcesUnder(SRC)
      .filter(({ file }) => !MODEL_FACING.some((m) => file.endsWith(m)))
      .filter(({ text }) => /knowledge base/i.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
