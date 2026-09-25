/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TOOK ALL OF IT.

   React Compiler is on app-wide, and it skips a component SILENTLY: lint is
   quiet, the build is green and jest passes, and the component simply runs
   without its memoisation (the Studio canvas shipped that way once). The
   conversation re-renders on every word that arrives, so the host, the hook
   and the view must each be compiled, and the only proof is the compiler's
   own report and its cache slots. Run here against the source, with the
   plugin the build uses. */

const FILES = [
  "src/components/tiff/modal/tiff-host.tsx",
  "src/components/tiff/modal/tiff-context.ts",
  "src/components/tiff/modal/tiff-modal.tsx",
  "src/components/tiff/modal/use-conversation.ts",
  "src/components/tiff/modal/box-motion.ts",
  "src/components/notes/tiff-button.tsx",
  "src/components/ui/dot-field.tsx",
  "src/components/tiff/modal/tiff-box.tsx",
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

it("names the host, the hook and the view among what compiled", () => {
  const names = FILES.slice(0, 5).flatMap((f) =>
    compile(f)
      .events.filter((e) => e.kind === "CompileSuccess")
      .map((e) => e.fnName)
  );
  for (const n of ["TiffModalProvider", "useConversation", "TiffModal", "TurnView", "Dock", "useBoxMotion"]) {
    expect(names).toContain(n);
  }
});

/* The entry box re-renders on every key you press. */
it("names the entry box among what compiled", () => {
  const names = compile("src/components/tiff/modal/tiff-box.tsx")
    .events.filter((e) => e.kind === "CompileSuccess")
    .map((e) => e.fnName);
  expect(names).toContain("TiffBox");
});
