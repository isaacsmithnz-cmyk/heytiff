const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const c = JSON.parse(fs.readFileSync(process.argv[2]));
  const b = await chromium.launch();
  for (const [f, bd] of Object.entries(c.boards)) {
    if (bd.page === 'archive') continue;
    const p = await b.newPage({ viewport: { width: bd.w, height: bd.h } });
    await p.route('**/support.js', r => r.fulfill({ status: 200, body: '' }));
    await p.goto('file://' + path.resolve(path.dirname(process.argv[2]), f));
    const [sw, sh] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
    if (sh > bd.h + 2 || sw > bd.w + 2) console.log('OVER', f, bd.w + 'x' + bd.h, '->', sw + 'x' + sh);
    await p.close();
  }
  await b.close();
  console.log('checked');
})();
