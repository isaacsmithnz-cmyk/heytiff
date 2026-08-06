import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/components/shell/nav";
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

/** Every .ts/.tsx under a directory, tests excluded. */
function sourcesIn(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => ({ file: e.name, text: readFileSync(join(dir, e.name), "utf8") }));
}

/** Source with `/* *\/` blocks, `//` lines and JSX `{/* *\/}` comments removed —
    what is left is roughly what a person could end up reading. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

describe("the library's vocabulary", () => {
  it("is called Library on the nav row, and the URL agrees", () => {
    /* The label and the href used to disagree — "Knowledge" pointing at
       /tiff/knowledge was at least consistent, but every sentence around it
       said library. Moving the route was what let the two line up. */
    const entry = NAV.find((n) => n.key === "tiffkb");
    expect(entry?.label).toBe("Library");
    expect(entry?.href).toBe("/dashboard/tiff/library");
  });

  it("never says 'knowledge base' anywhere a person can read it", () => {
    const offenders = sourcesIn(TIFF_DIR)
      .filter(({ text }) => /knowledge base/i.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
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
