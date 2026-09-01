/* Every value import in here needs a file extension, and only the push script
   ever notices.

   THE ASYMMETRY IS THE WHOLE PROBLEM. These modules are consumed two ways:
   by jest, through a bundler-style resolver that happily finds `./prompts`,
   and by `scripts/auth0-brand.mts`, which runs under plain node where ESM
   demands the real filename. So an extensionless import is green here,
   green in `tsc`, green through the pre-push hook — and a hard
   ERR_MODULE_NOT_FOUND the next time anyone runs the script.

   It has already happened once: adding `prompts.ts` to `preview.ts` broke
   every dry run, and it was only caught because the failure was read rather
   than redirected away.

   TYPE-ONLY IMPORTS ARE EXEMPT, and that is not a loophole — `import type`
   is erased before node ever resolves it, which is exactly why `./theme` and
   `./assets` sat there working and made the rule look optional. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

describe("relative imports carry their extension", () => {
  it("finds the modules to check", () => {
    // A rename that empties this list would make every case below vacuous.
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files)("%s", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    const offenders = [...src.matchAll(/^import\s+(type\s+)?([^;]*?)from\s+"(\.[^"]+)"/gm)]
      .filter(([, isType]) => !isType)
      .map(([, , , spec]) => spec)
      .filter((spec) => !/\.(ts|js|json)$/.test(spec));
    expect(offenders).toEqual([]);
  });
});
