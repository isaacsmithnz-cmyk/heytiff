import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import * as ts from "typescript";

/* THE PAGE TITLE IS ONE SIZE.

   #350 moved thirteen hand-copied inline 44s onto `.v2head h1` at 38px and
   shipped no guard. Three headings survived it, and the 2026-08-12 audit
   measured them: the Toolbox landing at 48px, the four Toolbox tool pages at
   40px, and Tiff's Library at 44px — plus Team's inline 44, which sat inside a
   nested div. So the app still had four page-title sizes on the day the commit
   message said it had one.

   THEY SURVIVED IN THREE DIFFERENT WAYS, which is the whole design of this
   test:

     inline      Team          <h1 style={{ fontSize: 44 }}>
     descendant  Toolbox       `.tbx-head h1 { font-size:48px }`
     class       Library       `<h1 className="tk-h1">` + `.tk-h1 { 44px }`

   A scan for the copied style object misses the last two. A scan down the
   `… h1` selectors misses the third. So this reads the JSX for what is
   actually an `<h1>`, collects the classes those elements wear, and then holds
   every CSS rule that can size one to 38px.

   Comments are stripped before scanning — a guard that matches its own
   explanatory prose passes vacuously. */

const SRC = join(__dirname, "..", "..", "..");
const SIZE = "38px";

/* WHOSE TITLES THIS RULE GOVERNS: the dashboard's screens, which is what #350
   was about and what the audit walked. Studio's canvas (`studio.css`,
   `data-library.css`) and the HQ portal (`hq.css`) are their own surfaces with
   their own design languages and their own smaller heads — 22–30px, on
   purpose. Sizing them from here would be this test deciding something nobody
   asked it to decide. If either is ever brought into line, add its sheet. */
const SHEETS = new Set(["app/dashboard/shell.css", "components/toolbox/toolbox.css"]);

/* Headings that are deliberately NOT page titles. Each needs a reason, and
   adding to this list should feel like a decision rather than a formality. */
const NOT_A_PAGE_TITLE = new Set([
  // the single-viewport calculators' compact header — a different kind of
  // header, not a second opinion about this one
  ".fg .tool.compact .thead h1",
  // the staff profile's identity card, which is a card header inside a page
  ".fg .phid h1",
  ".fg .phid h1 em",
]);

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      files(path, ext, out);
    } else if (ext.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every class name the app puts on an actual `<h1>`, and any inline sizing. */
function readHeadings(): { classes: Set<string>; inline: string[] } {
  const classes = new Set<string>();
  const inline: string[] = [];

  for (const file of files(SRC, /\.tsx$/)) {
    const src = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const walk = (node: ts.Node) => {
      const open = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null;
      if (open && open.tagName.getText() === "h1") {
        for (const attr of open.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          const name = attr.name.getText();
          const text = attr.initializer?.getText() ?? "";
          if (name === "className") {
            for (const c of text.replace(/["'{}`]/g, " ").split(/\s+/)) {
              if (/^[a-zA-Z][\w-]*$/.test(c)) classes.add(c);
            }
          }
          if (name === "style" && /fontSize/.test(text)) {
            const { line } = src.getLineAndCharacterOfPosition(open.getStart());
            inline.push(`${file.slice(SRC.length + 1)}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(src);
  }
  return { classes, inline };
}

/** CSS rules that can size one of those headings, with the size they set. */
function headingRules(classes: Set<string>): { selector: string; size: string; where: string }[] {
  const found: { selector: string; size: string; where: string }[] = [];
  for (const file of files(SRC, /\.css$/)) {
    const where = file.slice(SRC.length + 1);
    if (!SHEETS.has(where)) continue;
    const css = stripComments(readFileSync(file, "utf8"));
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      const size = /(?:^|;)\s*font-size\s*:\s*([^;]+)/.exec(m[2])?.[1].trim();
      if (!size) continue;
      const targetsH1 =
        /(^|[\s>+~])h1(\s|$)/.test(selector) ||
        [...classes].some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(selector));
      if (targetsH1) found.push({ selector, size, where });
    }
  }
  return found;
}

describe("the page title", () => {
  const { classes, inline } = readHeadings();

  it("is never sized inline — that is how thirteen copies happened", () => {
    expect(inline).toEqual([]);
  });

  it("is 38px in every CSS rule that can size one", () => {
    const wrong = headingRules(classes)
      .filter((r) => !NOT_A_PAGE_TITLE.has(r.selector))
      .filter((r) => r.size !== SIZE)
      .map((r) => `${r.where} — ${r.selector} → ${r.size}`);

    expect(wrong).toEqual([]);
  });

  /* Cheap proof the scan is actually looking at something. Without it, a
     regex that quietly stopped matching would leave both tests passing on an
     empty list — which is exactly how the first version of this project's
     other AST guard behaved. */
  it("found the headings it is meant to be checking", () => {
    expect(classes.size).toBeGreaterThan(0);
    expect(headingRules(classes).length).toBeGreaterThanOrEqual(6);
  });
});
