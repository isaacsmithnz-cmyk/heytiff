const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [w, h, out, file, x, y, cw, ch, s] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(s || 3) });
  await p.route('**/support.js', r => r.fulfill({ status: 200, body: '' }));
  await p.goto('file://' + path.resolve(file));
  await p.waitForTimeout(800);
  await p.screenshot({ path: out, clip: { x: +x, y: +y, width: +cw, height: +ch } });
  await b.close();
})();
