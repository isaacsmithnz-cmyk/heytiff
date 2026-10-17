// Screenshot one or more .dc.html boards at a given size: node shot.js W H out.png in.dc.html
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [w, h, out, file] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.route('**/support.js', r => r.fulfill({ status: 200, body: '' }));
  await p.goto('file://' + path.resolve(file));
  await p.waitForTimeout(1200);
  const over = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.app *').forEach(e => {
      if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.textContent.trim()) bad.push(e.textContent.trim().slice(0, 40));
    });
    return { docH: document.documentElement.scrollHeight, overflowText: bad.slice(0, 8) };
  });
  console.log(JSON.stringify(over));
  await p.screenshot({ path: out });
  await b.close();
})();
