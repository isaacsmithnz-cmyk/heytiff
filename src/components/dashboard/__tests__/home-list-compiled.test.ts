/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TOOK THE LIST AND ITS ONE CARD (two-way phase 3, PR E).

   React Compiler skips a component SILENTLY: lint is quiet, the build is
   green and jest passes, and the component runs without its memoisation.
   The list re-renders on every tick, fold and door, and the card's host on
   every door on the page; Book in and Clear are new verbs in the one and
   new doors through the other. The only proof is the compiler's own report
   and its cache slots, run here against the source with the plugin the
   build uses. */

const FILES = ["src/components/dashboard/home-list.tsx", "src/components/dashboard/home-job-sheet.tsx"];

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

  it("compiles every component and hook in it, with none refused or skipped", () => {
    const refused = events.filter((e) => e.kind !== "CompileSuccess");
    expect(refused.map((e) => `${e.kind} ${e.fnName ?? ""}`)).toEqual([]);
    expect(events.some((e) => e.kind === "CompileSuccess")).toBe(true);
  });

  it("carries the compiler's cache slots", () => {
    expect(code).toContain("react/compiler-runtime");
    expect(code).toMatch(/\$\[\d+\]/);
  });
});

it("names the list, its verb, its alert row, and the card's host among what compiled", () => {
  const names = FILES.flatMap((f) =>
    compile(f)
      .events.filter((e) => e.kind === "CompileSuccess")
      .map((e) => e.fnName),
  );
  expect(names).toEqual(expect.arrayContaining(["HomeList", "VerbControl", "AlertItem", "DeskJobHost"]));
});
