/**
 * @jest-environment node
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PluginObj, TransformOptions } from "@babel/core";

/* EVERY COMPONENT IN src/components IS COMPILED, AND THIS KEEPS IT SO.

   React Compiler refuses a component SILENTLY. Lint is quiet, the build is
   green, jest passes, and the component runs without its memoization. This
   has happened twice. #522 cleared 41 files on 2026-08-25, and a sweep on
   2026-10-01 found 21 again, the job card among them, refused whole over
   two `&&`s in a try (#960). A sweep is a snapshot; this is the sweep, run
   with the rest of the suite.

   It compiles every source file under src/components with the plugin the
   build uses, as the build uses it: for a production client bundle Next
   leaves every option at its default. It counts the functions the compiler
   REFUSES:
   - a CompileError or a PipelineError;
   - a CompileSkip, which is a function's own "use no memo";
   - every function in a file that opts out whole. The compiler reports
     those as compiled, then emits nothing.

   REFUSED holds that count EXACTLY, the way design-ratchets.test.ts holds
   its own. A new refusal fails here, with its file, its line and the
   compiler's reason. A refusal fixed without lowering the number fails too.
   At 0 there is nothing left to lower: the number only goes down, and it
   is at the bottom. Raising it needs Isaac's word, with the reason written
   beside it.

   THE SWEEP IS CACHED, because it is not cheap. Compiling all of
   src/components takes about 45s under jest, and studio/canvas.tsx alone
   is a fifth of that. Each file's verdict is kept in node_modules/.cache,
   keyed on the file's path and text, the compiler's and Babel's versions,
   and this file's own text. A push recompiles only the files it changed,
   about 2s in all, and an edit to this probe recompiles everything. A cold
   run (a fresh checkout, CI) pays for the whole sweep. */

const REFUSED = 0;

const ROOT = process.cwd();
const DIR = path.join(ROOT, "src/components");
const CACHE = path.join(ROOT, "node_modules/.cache/compiler-ratchet.json");

/* Node's own require, not jest's: the plugin is one 3.8 MB module, loaded
   once per worker instead of once per test file. */
const load = createRequire(path.join(ROOT, "package.json"));
const babel = load("@babel/core") as typeof import("@babel/core");
const PLUGIN = load.resolve("babel-plugin-react-compiler");
const OPT_OUT = (load("babel-plugin-react-compiler") as { OPT_OUT_DIRECTIVES: Set<string> }).OPT_OUT_DIRECTIVES;
const VERSIONS = `${(load("babel-plugin-react-compiler/package.json") as { version: string }).version}|${babel.version}`;

type Loc = { start: { line: number; column: number } } | null | undefined;
type CompilerEvent = {
  kind: string;
  fnLoc?: Loc;
  /** CompileError */
  detail?: { reason?: string; description?: string | null; category?: string; primaryLocation?: () => unknown };
  /** CompileSkip */
  loc?: Loc;
  /** PipelineError */
  data?: string;
};

/** One function the compiler would not compile: where it starts, where it broke, and why. */
type Refusal = { file: string; fn: number | null; at: number | null; reason: string };
type Verdict = { compiled: number; refused: Omit<Refusal, "file">[] };

const lineOf = (loc: unknown) =>
  typeof loc === "object" && loc && "start" in loc ? (loc as { start: { line: number } }).start.line : null;

function why(e: CompilerEvent): { at: number | null; reason: string } {
  if (e.kind === "CompileError" && e.detail) {
    const d = e.detail;
    const text = [d.category, d.reason].filter(Boolean).join(": ");
    return { at: lineOf(d.primaryLocation?.()), reason: d.description ? `${text} (${d.description})` : text };
  }
  // the compiler's own words here print the directive as [object Object]
  if (e.kind === "CompileSkip") return { at: lineOf(e.loc), reason: "the function opts out of the compiler" };
  return { at: null, reason: `${e.kind}: ${e.data ?? ""}`.trim() };
}

/* The file's own directives, read in the same pass. A file-wide "use no
   memo" is the one opt-out the compiler's events don't show. */
let fileOptsOut = false;
const readsDirectives = (): PluginObj => ({
  visitor: {
    Program(p) {
      fileOptsOut = p.node.directives.some((d) => OPT_OUT.has(d.value.value));
    },
  },
});

function compile(file: string, src: string): Verdict {
  const events: CompilerEvent[] = [];
  fileOptsOut = false;
  const options: TransformOptions = {
    filename: file,
    babelrc: false,
    configFile: false,
    code: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [readsDirectives, [PLUGIN, { logger: { logEvent: (_f: string | null, e: CompilerEvent) => events.push(e) } }]],
  };
  babel.transformSync(src, options);

  // a function can be refused for several things at once; it is one refusal
  const fns = new Map<string, Omit<Refusal, "file">>();
  let compiled = 0;
  events.forEach((e, i) => {
    const key = e.fnLoc ? `${e.fnLoc.start.line}:${e.fnLoc.start.column}` : `#${i}`;
    if (e.kind === "CompileSuccess") {
      if (!fileOptsOut) compiled++;
      else fns.set(key, { fn: lineOf(e.fnLoc), at: null, reason: "the file opts out of the compiler" });
    } else if (e.kind === "CompileError" || e.kind === "PipelineError" || e.kind === "CompileSkip") {
      if (!fns.has(key)) fns.set(key, { fn: lineOf(e.fnLoc), ...why(e) });
    }
  });
  return { compiled, refused: [...fns.values()] };
}

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") sources(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out.sort();
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

function readCache(): Record<string, Verdict> {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8")) as Record<string, Verdict>;
  } catch {
    return {};
  }
}

/* Written whole, to a temporary name and then renamed, so a sibling
   worktree's run never reads half a file. Only this run's verdicts are
   kept, so the cache never outgrows the tree. Two worktrees on different
   branches each recompile the files where they differ, which is cheap. A
   cache that can't be written only means a slower next run. */
function writeCache(entries: Record<string, Verdict>) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    const tmp = `${CACHE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, CACHE);
  } catch {
    /* read-only node_modules: nothing to keep */
  }
}

function sweep() {
  const salt = `${VERSIONS}|${hash(fs.readFileSync(__filename, "utf8"))}`;
  const cached = readCache();
  const kept: Record<string, Verdict> = {};
  const files = sources(DIR);
  let compiled = 0;
  const refused: Refusal[] = [];
  for (const abs of files) {
    const file = path.relative(ROOT, abs);
    const src = fs.readFileSync(abs, "utf8");
    const key = hash(`${salt}\0${file}\0${src}`);
    const verdict = cached[key] ?? compile(file, src);
    kept[key] = verdict;
    compiled += verdict.compiled;
    for (const r of verdict.refused) refused.push({ file, ...r });
  }
  writeCache(kept);
  return { files: files.length, compiled, refused };
}

const describeRefusal = (r: Refusal) =>
  `${r.file}:${r.fn ?? "?"} — ${r.reason}${r.at != null && r.at !== r.fn ? ` (line ${r.at})` : ""}`;

describe("React Compiler over src/components", () => {
  let found: ReturnType<typeof sweep>;
  // cold, the whole sweep: ~45s here and slower on a CI runner
  beforeAll(() => {
    found = sweep();
  }, 300_000);

  it("refuses exactly as many functions as the ratchet says", () => {
    const n = found.refused.length;
    // thrown, not matched: a matcher's diff would show the count and hide the list
    if (n < REFUSED) {
      throw new Error(`${n} refused now, the baseline says ${REFUSED}. You fixed some — lower REFUSED in compiler-ratchet.test.ts to ${n}.`);
    }
    if (n > REFUSED) {
      throw new Error(
        `${n} refused now, the baseline says ${REFUSED}. Make these compile:\n${found.refused.map(describeRefusal).join("\n")}`
      );
    }
    expect(n).toBe(REFUSED);
  });

  it("read the components and compiled them, so a sweep of nothing cannot pass for a clean one", () => {
    expect(found.files).toBeGreaterThan(0);
    expect(found.compiled).toBeGreaterThan(0);
  });
});

/* THE COUNTER IS NOT BLIND. Each refusal the sweep claims to count is
   written out here, small, and run through the same compile. A probe that
   stopped seeing one kind would let every real one through, and would look
   exactly like a clean tree. */
describe("what the sweep counts as refused", () => {
  const refusals = (src: string) => compile("canary.tsx", src).refused;

  it("counts nothing in a component the compiler takes", () => {
    const v = compile("canary.tsx", `export function Ok({ n }: { n: number }) { return <b>{n + 1}</b>; }`);
    expect(v).toEqual({ compiled: 1, refused: [] });
  });

  it("counts a try with a finalizer, by the line of its function", () => {
    const r = refusals(`
export function Busy({ go }: { go: () => Promise<void> }) {
  const run = async () => {
    try { await go(); } finally { console.log("done"); }
  };
  return <button onClick={run}>Go</button>;
}`);
    expect(r).toEqual([{ fn: 2, at: 4, reason: expect.stringMatching(/TryStatement/) }]);
  });

  it("counts a component carrying a react-hooks disable", () => {
    const r = refusals(`
import { useEffect } from "react";
export function Once({ id }: { id: string }) {
  useEffect(() => {
    console.log(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}`);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toMatch(/eslint-disable-next-line react-hooks\/exhaustive-deps/);
  });

  it("counts a function that opts itself out", () => {
    const r = refusals(`export function Mine() { "use no memo"; return <b />; }`);
    expect(r).toEqual([{ fn: 1, at: 1, reason: "the function opts out of the compiler" }]);
  });

  it("counts every function in a file that opts out whole, which the compiler reports as compiled", () => {
    const v = compile("canary.tsx", `"use client";\n"use no memo";\nexport function A() { return <b />; }\nexport function B() { return <i />; }`);
    expect(v.compiled).toBe(0);
    expect(v.refused.map((r) => r.fn)).toEqual([3, 4]);
  });

  it("counts a function once, however many things refuse it", () => {
    const r = refusals(`
export function Twice({ go }: { go: () => Promise<void> }) {
  const a = async () => { try { await go(); } finally { console.log(1); } };
  const b = async () => { try { await go(); } finally { console.log(2); } };
  return <i onClick={a} onBlur={b} />;
}`);
    expect(r).toHaveLength(1);
  });
});
