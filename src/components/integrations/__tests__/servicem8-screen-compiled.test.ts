/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TAKES THE SERVICEM8 SCREEN (two-way phase 4, PR F).

   React Compiler skips a component SILENTLY: lint is quiet, the build is
   green and jest passes, and the component runs without its memoisation.
   The screen gained live updates' line; its proof is the compiler's own
   report and its cache slots, run here against the source with the plugin
   the build uses — book-in's check, for this screen. */

const FILE = "src/components/integrations/servicem8-screen.tsx";

type CompileEvent = { kind: string; fnName?: string | null };

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

const { code, events } = compile(FILE);

it("compiles every component in it, with none refused", () => {
  const refused = events.filter((e) => e.kind !== "CompileSuccess" && e.kind !== "CompileSkip");
  expect(refused.map((e) => `${e.kind} ${e.fnName ?? ""}`)).toEqual([]);
  expect(events.filter((e) => e.kind === "CompileSuccess").map((e) => e.fnName)).toEqual(
    expect.arrayContaining(["Servicem8Screen", "SyncLine", "MirrorCard", "ObjectTag"])
  );
});

it("carries the compiler's cache slots", () => {
  expect(code).toContain("react/compiler-runtime");
  expect(code).toMatch(/\$\[\d+\]/);
});
