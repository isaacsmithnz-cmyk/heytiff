import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /* Reference material, not source. `_design/` holds the brand assets and a
       scrape of the VRF-builder we skinned — including its bundler manifests,
       which are JSON blobs of base64 font data wearing a `.js` extension and
       cannot be parsed as a program at all. Nothing here is imported by the
       app, nothing here is ours to style, and one of them has been the only
       parsing error in `eslint .` for as long as it has been checked in. */
    "_design/**",
  ]),
  {
    /* A LEADING UNDERSCORE ALREADY MEANT "DELIBERATELY UNUSED" HERE — the
       linter just wasn't told. It is how the codebase writes a signature it
       has to match but does not read: `(..._a: unknown[]) => …` on a jest
       stub standing in for a real function, `constructor(_cfg: unknown) {}`
       on a mocked Auth0 client. Those arguments cannot be deleted — removing
       them changes the shape the mock is imitating — so without this they are
       permanent warnings that train people to ignore the rule.

       Catch clauses are included for the same reason: `catch (_e)` is how you
       say the failure is expected and the details genuinely do not matter. */
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
