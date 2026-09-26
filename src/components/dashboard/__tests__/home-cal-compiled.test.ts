/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TOOK ALL OF THE CALENDAR.

   React Compiler is on app-wide, and it skips a component SILENTLY: lint is
   quiet, the build is green and jest passes, and the component simply runs
   without its memoisation. The Calendar lays out a year of days on every
   render and every pick re-renders it, so the page and every view must be
   compiled — and the desk and the list it is built into, which this pull
   request touched. The only proof is the compiler's own report and its
   cache slots: run here against the source, with the plugin the build uses. */

const FILES = [
  "src/components/dashboard/home-cal-page.tsx",
  "src/components/dashboard/home-cal-agenda.tsx",
  "src/components/dashboard/home-cal-month.tsx",
  "src/components/dashboard/home-cal-year.tsx",
  "src/components/dashboard/home-cal-panel.tsx",
  "src/components/dashboard/home-cal-rail.tsx",
  "src/components/dashboard/home-cal-parts.tsx",
  "src/components/dashboard/home-cal-edit.tsx",
  "src/components/dashboard/home-list.tsx",
  "src/components/dashboard/home-desk.tsx",
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

  /* A skip is a refusal too: `"use no memo"` on one small part (a Month
     cell, an agenda line) is reported as a skip, and that part then runs
     without its memoisation on every pick. */
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

it("names the page and each of its views among what compiled", () => {
  const names = FILES.slice(0, 8).flatMap((f) =>
    compile(f)
      .events.filter((e) => e.kind === "CompileSuccess")
      .map((e) => e.fnName),
  );
  for (const n of ["HomeCalendarPage", "CalAgenda", "CalMonth", "CalYear", "CalPanel", "CalKey", "CalRail", "CalEdit"]) {
    expect(names).toContain(n);
  }
});
