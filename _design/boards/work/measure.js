const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [file, ...sels] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.route('**/support.js', r => r.fulfill({ status: 200, body: '' }));
  await p.goto('file://' + path.resolve(file));
  for (const s of sels) {
    const r = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }, s);
    console.log(s, JSON.stringify(r));
  }
  await b.close();
})();
