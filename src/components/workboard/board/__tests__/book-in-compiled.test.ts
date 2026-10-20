/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* D-13: THE COMPILER TOOK BOOK IN (two-way phase 3, PR D).

   React Compiler skips a component SILENTLY: lint is quiet, the build is
   green and jest passes, and the component runs without its memoisation.
   Book in is the Visit form now (making/visit-form, its engine the hook in
   making/book-in), and it re-renders on every choice and every day picked,
   so its proof is the compiler's own report and its cache slots, run here
   against the source with the plugin the build uses: the notes' check, for
   the form, its engine, the lines and the Schedule inspector's Clear.
   (job-sheet.tsx is left out: it skips on main too.) */

const FILES = [
  "src/components/making/visit-form.tsx",
  "src/components/making/book-in.ts",
  "src/components/workboard/board/book-in-panel.tsx",
  "src/components/workboard/board/focus-inspector.tsx",
];

type CompileEvent = { kind: string; fnName?: string | null; detail?: unknown };

function compile(file: string) {
  const events: CompileEvent[] = [];
  const out = transformSync(fs.readFileSync(path.join(process.cwd(), file), "utf8"), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [["babel-plugin-react-compiler", { logger: { logEvent: (_f: string, e: CompileEvent) => events.push(e) } }]],
  });
  return { code: out?.code ?? "", events };
}

describe.each(FILES)("%s", (file) => {
  const { code, events } = compile(file);

  it("compiles every component and hook in it, with none refused", () => {
    const refused = events.filter((e) => e.kind !== "CompileSuccess" && e.kind !== "CompileSkip");
    expect(refused.map((e) => `${e.kind} ${e.fnName ?? ""}`)).toEqual([]);
    expect(events.some((e) => e.kind === "CompileSuccess")).toBe(true);
  });

  it("carries the compiler's cache slots", () => {
    expect(code).toContain("react/compiler-runtime");
    expect(code).toMatch(/\$\[\d+\]/);
  });
});

it("names the form, its engine, the lines and the Clear's confirm among what compiled", () => {
  const names = (file: string) =>
    compile(file)
      .events.filter((e) => e.kind === "CompileSuccess")
      .map((e) => e.fnName);
  expect(names("src/components/making/visit-form.tsx")).toEqual(expect.arrayContaining(["VisitForm", "BookVisit", "NoJob"]));
  expect(names("src/components/making/book-in.ts")).toEqual(expect.arrayContaining(["useBookIn"]));
  expect(names("src/components/workboard/board/book-in-panel.tsx")).toEqual(
    expect.arrayContaining(["BookingEntryLine", "BookingStateLine", "ClearConfirm"]),
  );
});
