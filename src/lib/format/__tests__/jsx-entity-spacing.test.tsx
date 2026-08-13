import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import * as ts from "typescript";

/* THE SPACE THAT DISAPPEARS.

   A JSX text block that runs over more than one line AND contains an HTML
   entity loses the space it BEGINS with, when what precedes it is an
   expression container. So this:

     <p>
       {money(total)} of this is unapproved. The business hasn&rsquo;t taken it.
     </p>

   ships as "$412.90of this is unapproved." Move the entity out, or put the
   text on one line, and the space survives. It is the combination that does
   it — see the four cases pinned below.

   THIS HAS BITTEN THREE TIMES. The Xero costs banner shipped reading "more
   than 6 monthsold" and was fixed by hand with a `{" "}` (the comment there
   still records it). The 2026-08-12 audit then found two more live: Tax &
   EOFY's unapproved-claims note, and the My timesheet line that tells you
   when the sheet submits itself. Nothing catches this — it is valid JSX, it
   type-checks, it lints, and it renders; the only symptom is two words stuck
   together in a sentence nobody re-reads.

   So the rule is mechanical: inside a text block of that shape, a leading
   space has to be written as `{" "}` where the transform cannot eat it.

   PARSED, NOT GREPPED. A regex cannot tell an expression container from the
   `)}` closing a conditional, and this file would be all false positives
   within a week. The scan walks real JSX children and only fires on a
   JsxText that (a) directly follows a JsxExpression, (b) starts with a
   space, (c) spans more than one line, and (d) carries an entity. */

const SRC = join(__dirname, "..", "..", "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules") continue;
      sources(path, out);
    } else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const ENTITY = /&[a-zA-Z]+;|&#\d+;/;

/** Every `{expr}` + text pairing in one file that loses its space. */
function offendersIn(file: string): string[] {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];

  const check = (children: ts.NodeArray<ts.JsxChild>) => {
    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1];
      const node = children[i];
      if (!ts.isJsxExpression(prev) || !ts.isJsxText(node)) continue;
      // a comment-only container emits nothing, so it can't lose a space
      if (!prev.expression) continue;
      /* getFullText, NOT getText: `getText()` skips leading trivia, and the
         leading space IS the thing under test — the first attempt at this
         scan used it, found nothing, and passed while both known offenders
         were still in the tree. */
      const text = node.getFullText();
      if (!/^[ \t]/.test(text)) continue; // no leading space to lose
      if (!text.includes("\n")) continue; // single-line blocks are safe
      if (!ENTITY.test(text)) continue; // the entity is what triggers it
      const { line } = src.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${file.slice(SRC.length + 1)}:${line + 1}`);
    }
  };

  const walk = (node: ts.Node) => {
    if (ts.isJsxElement(node)) check(node.children);
    else if (ts.isJsxFragment(node)) check(node.children);
    ts.forEachChild(node, walk);
  };
  walk(src);
  return found;
}

describe("the JSX entity-spacing trap", () => {
  /* The behaviour itself, pinned. If a future Next/SWC upgrade fixes the
     transform, THIS is the test that fails — and the scan below, plus the
     hand-written `{" "}` at the call sites, can all be retired together. */
  it("eats the leading space when the block wraps AND carries an entity", () => {
    const n = "$412.90";
    const render = (el: React.ReactElement) =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("react-dom/server") as typeof import("react-dom/server")).renderToStaticMarkup(el);

    // safe: one line
    expect(render(<p>{n} of this hasn&rsquo;t</p>)).toContain("$412.90 of this");
    // safe: wraps, but no entity
    expect(
      render(
        <p>
          {n} of this is expense claims nobody has
          approved yet.
        </p>,
      ),
    ).toContain("$412.90 of this");
    // BROKEN: wraps and carries an entity
    expect(
      render(
        <p>
          {n} of this is expense claims nobody has
          approved yet. The business hasn&rsquo;t taken it.
        </p>,
      ),
    ).toContain("$412.90of this");
    // fixed by making the space explicit
    expect(
      render(
        <p>
          {n}{" "}
          of this is expense claims nobody has
          approved yet. The business hasn&rsquo;t taken it.
        </p>,
      ),
    ).toContain("$412.90 of this");
  });

  /* THE SCAN FOUND A THIRD ONE. Tax and My timesheet came out of reading the
     screens; My vehicle's "Hilux uteis off the road" did not — nobody had
     looked at that banner with a vehicle paused. That is the argument for
     parsing rather than trusting a walkthrough. */
  it("is not written anywhere in the app", () => {
    // this file holds the broken shape on purpose, to pin the behaviour above
    const offenders = sources(SRC)
      .filter((f) => f !== __filename)
      .flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });
});
