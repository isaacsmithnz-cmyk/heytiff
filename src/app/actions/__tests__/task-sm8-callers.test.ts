/**
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

/* CODE NEVER POSTS A DONE (two-way phase 2, PR C).

   A task's Done goes to ServiceM8 as whoever ticked, so it may only follow a
   PERSON'S tick on a screen made for ticking: the Tasks face, the day band,
   the bell and the Workboard's Urgent tab, and on the new Home (HOME_DESK's)
   Your day, the list and its own Tasks face. `postDone: true` is how such a
   screen says so, and `takeBackDone: true` is how the screens with a Reopen
   or an Undo (both Tasks faces, the Urgent tab, the list) say it about
   taking the tick back.
   Read as source, because the danger is a new
   caller — a cron, a route, a reply that closes its task, a bulk action —
   that would post a Done nobody pressed for, or a new Undo that reopens a
   task and leaves its Done in ServiceM8.

   PARSED, NOT GREPPED. A regex over `completeTask(` can't see the function
   handed on by reference — `{ run: reopenTask }`, `onClick={completeTask}`
   — and such a use calls it with no flag while every test here stays green.
   So every use is found in the syntax tree, and a use that isn't a call
   (an import, the definitions in dashboard.ts, a `typeof`) fails the suite:
   wrap it in an arrow that passes the flag, and the call is read below.

   AND WHERE THE DONE IS READ BACK. The bell's door onto a Done that didn't
   go opens `/dashboard?task=<id>`, and a Done's state is drawn on the
   task's page. Every Home the address can open is handed the task it
   names, and every screen that draws the task's page is handed its lines —
   so a second Home (HOME_DESK's) can't open with the owner's Done nowhere
   on it. */

const SRC = join(process.cwd(), "src");

/* "home-day 2.tsx" is iCloud's copy of a file, not source: .gitignore's
   `* [0-9].*` keeps it out of the repo, and it is kept out of the read. */
const ICLOUD_COPY = / \d+\.(ts|tsx)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !ICLOUD_COPY.test(name) ? [p] : [];
  });
}

const all = files(SRC).map((p) => ({
  path: relative(SRC, p),
  tree: ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
}));

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

type Call = { path: string; line: number; flags: Record<string, string> | null };
type Ref = { path: string; line: number; text: string };

/** Every use of `fn` in src outside tests: its calls, with the options
    object's properties as written (null when the options aren't a literal,
    so no flag can be read off them), and every other use as a reference. */
function usesOf(fn: string): { calls: Call[]; refs: Ref[] } {
  const calls: Call[] = [];
  const refs: Ref[] = [];
  for (const f of all) {
    walk(f.tree, (n) => {
      if (!ts.isIdentifier(n) || n.text !== fn) return;
      const p = n.parent;
      const line = f.tree.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      // not uses: an import or export's name, the definition, a key, a type
      if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isExportSpecifier(p)) return;
      if (ts.isFunctionDeclaration(p) && p.name === n) return;
      if (ts.isPropertyAssignment(p) && p.name === n) return;
      if (ts.isTypeQueryNode(p)) return;
      // `completeTask(…)`, or `actions.completeTask(…)` off a namespace
      const callee = ts.isPropertyAccessExpression(p) && p.name === n ? p : n;
      const call = callee.parent;
      if (ts.isCallExpression(call) && call.expression === callee) {
        const opts = call.arguments[1];
        const flags =
          opts === undefined
            ? {}
            : ts.isObjectLiteralExpression(opts)
              ? Object.fromEntries(
                  opts.properties
                    .filter(ts.isPropertyAssignment)
                    .map((a) => [a.name.getText(f.tree), a.initializer.getText(f.tree)])
                )
              : null;
        calls.push({ path: f.path, line, flags });
        return;
      }
      refs.push({ path: f.path, line, text: p.getText(f.tree).slice(0, 80) });
    });
  }
  return { calls, refs };
}

const ticks = usesOf("completeTask");
const reopens = usesOf("reopenTask");
const flagged = (calls: Call[], flag: string) => (c: Call) => c.flags?.[flag] === "true";
const where = (calls: Call[], flag: string) => [...new Set(calls.filter(flagged(calls, flag)).map((c) => c.path))].sort();
const onScreens = (calls: Call[]) => calls.filter((c) => c.path.startsWith("components/"));

it("has calls to read", () => {
  expect(ticks.calls.length).toBeGreaterThan(4);
  expect(reopens.calls.length).toBeGreaterThan(1);
});

it("(F) nothing hands a tick or a Reopen on by reference: every use is a call these tests can read", () => {
  expect(ticks.refs).toEqual([]);
  expect(reopens.refs).toEqual([]);
});

it("(F) exactly the ticking screens post a Done, on every tick they make", () => {
  expect(where(ticks.calls, "postDone")).toEqual([
    "components/dashboard/home-day-band.tsx",
    // the new Home's (HOME_DESK's): Your day's Mark done, and the list's tick
    "components/dashboard/home-day.tsx",
    "components/dashboard/home-list.tsx",
    // and its Tasks face's tick and Mark done
    "components/dashboard/home-tasks-face.tsx",
    "components/dashboard/home-tasks.tsx",
    "components/shell/bell.tsx",
    "components/workboard/board/urgent-tab.tsx",
  ]);
  // a screen's every tick is a person's: none of them leaves the flag off
  expect(onScreens(ticks.calls).filter((c) => !flagged(ticks.calls, "postDone")(c))).toEqual([]);
  // the bell's two (a reminder, and work somebody gave you) both
  expect(onScreens(ticks.calls).filter((c) => c.path === "components/shell/bell.tsx")).toHaveLength(2);
});

it("(F) exactly the screens with a Reopen or an Undo take one back, on every Reopen they make", () => {
  expect(where(reopens.calls, "takeBackDone")).toEqual([
    // the new Home's list: the Undo on a row it just ticked
    "components/dashboard/home-list.tsx",
    // and its Tasks face's Not done yet
    "components/dashboard/home-tasks-face.tsx",
    "components/dashboard/home-tasks.tsx",
    "components/workboard/board/urgent-tab.tsx",
  ]);
  expect(onScreens(reopens.calls).filter((c) => !flagged(reopens.calls, "takeBackDone")(c))).toEqual([]);
});

it("(F) nothing in the libraries or the API routes ticks a task, and a reply that closes its task posts no Done", () => {
  const offenders = ticks.calls.filter((c) => c.path.startsWith("lib/") || c.path.startsWith("app/api/"));
  expect(offenders).toEqual([]);
  const byReply = ticks.calls.filter((c) => c.path === "app/actions/job-note-sm8.ts");
  expect(byReply).toHaveLength(1);
  expect(byReply[0].flags).toEqual({});
});

/* ── where a Done is read back ── */

/** Every `<Tag …>` in src outside tests, with the attributes it is handed. */
function elementsOf(test: (tag: string) => boolean): { path: string; tag: string; attrs: string[] }[] {
  const out: { path: string; tag: string; attrs: string[] }[] = [];
  for (const f of all) {
    if (!f.path.endsWith(".tsx")) continue;
    walk(f.tree, (n) => {
      if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
      const tag = n.tagName.getText(f.tree);
      if (!test(tag)) return;
      const attrs = n.attributes.properties.map((a) => (ts.isJsxAttribute(a) ? a.name.getText(f.tree) : "{...}"));
      out.push({ path: f.path, tag, attrs });
    });
  }
  return out;
}

it("(F) every screen that draws a task's page hands it the task's Done lines", () => {
  // today's Tasks face, and the new Home's (HOME_DESK's), where a task opens in place
  const pages = elementsOf((t) => t === "HomeTasks" || t === "HomeTasksFace");
  expect(new Set(pages.map((e) => e.tag))).toEqual(new Set(["HomeTasks", "HomeTasksFace"]));
  expect(pages.filter((e) => !e.attrs.includes("sm8Lines") || !e.attrs.includes("sm8Sender"))).toEqual([]);
});

it("(F) every Home the address can open is handed the task it names", () => {
  const homes = elementsOf((t) => /^Dashboard[A-Z]/.test(t)).filter((e) => e.path === "app/dashboard/page.tsx");
  expect(homes.length).toBeGreaterThan(0);
  expect(homes.filter((e) => !e.attrs.includes("taskId"))).toEqual([]);
});
