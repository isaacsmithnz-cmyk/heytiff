import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* EVERY EXPORT OF A `"use server"` FILE MUST BE AN ASYNC FUNCTION.

   Next turns each one into a Server Function — a network call — so a plain
   value or a synchronous helper exported alongside the actions is a BUILD
   error. The trap is what doesn't catch it: `tsc --noEmit` is happy, jest is
   happy, eslint is happy. The first thing that knows is the Vercel build,
   which is exactly the loop this repo is slowest to close.

   It nearly shipped here: a synchronous `isReadableReceipt` was added to
   actions/expense-ai.ts next to the scanner it belonged with. It now lives in
   lib/expenses/claim.ts, which is the right home for a pure rule anyway.

   Types are erased before the directive is applied, so `export type` and
   `export interface` are fine and are the only non-async exports allowed. */

const ACTIONS = join(process.cwd(), "src/app/actions");

/** `export <keyword>` where the keyword introduces a runtime value. */
const VALUE_EXPORT = /^export\s+(function|const|let|var|class|enum)\s/;
const ASYNC_FUNCTION = /^export\s+async\s+function\s/;

function serverActionFiles(): string[] {
  return readdirSync(ACTIONS)
    .filter((n) => n.endsWith(".ts"))
    .filter((n) => /^\s*["']use server["']/.test(readFileSync(join(ACTIONS, n), "utf8")));
}

describe("server action files", () => {
  it("has some to check", () => {
    // a guard that silently checks nothing is worse than no guard
    expect(serverActionFiles().length).toBeGreaterThan(5);
  });

  it("export nothing but async functions and types", () => {
    const offenders: string[] = [];
    for (const name of serverActionFiles()) {
      readFileSync(join(ACTIONS, name), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (VALUE_EXPORT.test(line) && !ASYNC_FUNCTION.test(line)) {
            offenders.push(`${name}:${i + 1} — ${line.trim().slice(0, 72)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
