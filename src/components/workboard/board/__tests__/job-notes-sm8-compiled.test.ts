/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TOOK THE JOB CARD'S NOTES TO SERVICEM8 (two-way phase 2).

   React Compiler skips a component SILENTLY: lint is quiet, the build is
   green and jest passes, and the component runs without its memoisation.
   The diary's pen re-renders on every key pressed, and it once reached for
   browser storage with a conditional inside a try, which the compiler can't
   lower, so it skipped the Pen whole. The only proof is the compiler's own
   report and its cache slots, run here against the source with the plugin
   the build uses. (job-sheet.tsx is left out: it skips on main too.) */

const FILES = [
  "src/components/workboard/board/job-diary-face.tsx",
  "src/components/workboard/board/job-attention-strip.tsx",
  "src/components/workboard/board/state-line.tsx",
  "src/components/dashboard/task-sm8-line.tsx",
  "src/components/integrations/sm8-writes-card.tsx",
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

it("names the diary's pen among what compiled", () => {
  const names = compile("src/components/workboard/board/job-diary-face.tsx")
    .events.filter((e) => e.kind === "CompileSuccess")
    .map((e) => e.fnName);
  expect(names).toContain("Pen");
});
