// Test tooling, not a suite (fixtures/ is testPathIgnore'd). Jest can't load
// pdfjs's ESM from CJS test files (.mjs is hard-ESM to jest, import.meta and
// all), so the extraction gate test runs THIS in a child Node process — the
// same native-ESM path the Next server uses at runtime.
// argv: [node, runner, moduleSpecifier, pdfPath]
import fs from "node:fs";

const [, , specifier, pdfPath] = process.argv;
const pdfjs = await import(specifier);

const data = new Uint8Array(fs.readFileSync(pdfPath));
// the same options extract.ts passes — pdfjs 6 dropped isEvalSupported along
// with the eval-based font compiler, so there is nothing else to switch off
const task = pdfjs.getDocument({
  data,
  disableFontFace: true,
  verbosity: 0,
});
const doc = await task.promise;

const texts = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  texts.push(
    tc.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .trim()
  );
}
await task.destroy();
process.stdout.write(JSON.stringify({ pages: doc.numPages, texts }));
