/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TOOK ALL OF THE DIARY.

   React Compiler is on app-wide, and it skips a component SILENTLY: lint is
   quiet, the build is green and jest passes, and the component simply runs
   without its memoisation. The diary draws every entry and every
   conversation on the page, and each press in one of them (Edit, Delete,
   Hide, a reply's Send again) re-renders it. A conversation's Hide once
   chose between its two actions inside a try, which the compiler does not
   take, and the whole conversation ran uncompiled. The only proof is the
   compiler's own report and its cache slots: run here against the source,
   with the plugin the build uses. */

const FILES = [
  "src/components/dashboard/home-diary-feed.tsx",
  "src/components/dashboard/home-diary-conversation.tsx",
  "src/components/dashboard/home-diary-reply.tsx",
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

it("names the diary, an entry, a conversation, a message in its thread and a reply's line among what compiled", () => {
  const names = FILES.flatMap((f) =>
    compile(f)
      .events.filter((e) => e.kind === "CompileSuccess")
      .map((e) => e.fnName),
  );
  for (const n of ["HomeDiaryFeed", "Entry", "HomeDiaryConversation", "ThreadMessage", "HomeDiaryReplyLine"]) {
    expect(names).toContain(n);
  }
});
