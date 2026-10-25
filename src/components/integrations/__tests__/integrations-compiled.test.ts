/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "@babel/core";

/* THE COMPILER TAKES SETTINGS › INTEGRATIONS (v2, 25 October 2026).

   React Compiler skips a component SILENTLY: lint is quiet, the build is
   green and jest passes, and the component runs without its memoisation.
   The proof is the compiler's own report and its cache slots, run here
   against each file with the plugin the build uses. */

const FILES: [string, string[]][] = [
  ["src/components/integrations/integrations-screen.tsx", ["IntegrationsScreen"]],
  ["src/components/integrations/servicem8-group.tsx", ["Servicem8Group", "ConnectionLine", "MirrorRow", "ObjectState"]],
  ["src/components/integrations/sm8-sending.tsx", ["Sm8Sending"]],
  ["src/components/integrations/xero-group.tsx", ["XeroGroup"]],
  ["src/components/integrations/people-review.tsx", ["PeopleReview", "PeopleDialog"]],
  ["src/components/integrations/int-parts.tsx", ["Said", "useIntegrationAct", "Permissions", "ConnectDialog", "DisconnectDialog"]],
];

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

describe.each(FILES)("%s", (file, names) => {
  const { code, events } = compile(file);

  it("compiles every component and hook in it, with none refused", () => {
    const refused = events.filter((e) => e.kind !== "CompileSuccess" && e.kind !== "CompileSkip");
    expect(refused.map((e) => `${e.kind} ${e.fnName ?? ""}`)).toEqual([]);
    expect(events.filter((e) => e.kind === "CompileSuccess").map((e) => e.fnName)).toEqual(expect.arrayContaining(names));
  });

  it("carries the compiler's cache slots", () => {
    expect(code).toContain("react/compiler-runtime");
    expect(code).toMatch(/\$\[\d+\]/);
  });
});
