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
]);

export default eslintConfig;
