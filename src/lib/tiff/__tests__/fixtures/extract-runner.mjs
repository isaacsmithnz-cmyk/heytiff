// Test tooling, not a suite (fixtures/ is testPathIgnore'd). Jest can't load
// pdfjs's ESM from CJS test files (.mjs is hard-ESM to jest, import.meta and
// all), so the extraction gate test runs THIS in a child Node process — the
// same native-ESM path the Next server uses at runtime.
// argv: [node, runner, moduleSpecifier, pdfPath]
//
// IT INSTALLS THE STUBS FIRST, mirroring extract.ts, and that is the whole
// point of this file now. pdfjs needs DOMMatrix at import time and borrows it
// from `@napi-rs/canvas` — an OPTIONAL dependency that npm installs on a
// developer's machine and Vercel never traces into the function. So the first
// version of this runner proved extraction worked on a machine that happened
// to have canvas, while production couldn't load the module at all. Setting
// the globals here means pdfjs skips the canvas lookup exactly as it does in
// the deployed function, and the test finally covers the path that ships.
import fs from "node:fs";

class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
  }
  translate() { return this; }
  scale() { return this; }
  invertSelf() { return this; }
  multiplySelf() { return this; }
  preMultiplySelf() { return this; }
  transformPoint(p) { return p; }
}
class Path2DStub {
  addPath() {} moveTo() {} lineTo() {} closePath() {}
}
globalThis.DOMMatrix = DOMMatrixStub;
globalThis.Path2D = Path2DStub;

const [, , specifier, pdfPath] = process.argv;
const pdfjs = await import(specifier);
if (globalThis.DOMMatrix !== DOMMatrixStub) {
  throw new Error("pdfjs replaced DOMMatrix — this run no longer proves the deployed path");
}

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
