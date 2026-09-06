const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const url = process.env.PRODUCTION_URL || 'http://127.0.0.1:5174';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (/\/(salt|material|shadcn)-[^/]+\.json/.test(r.url())) requests.push(r.url()); });
    const results = [];
    for (const zone of ['salt','material','shadcn']) {
      requests.length = 0;
      await page.goto(url + '/?track=bonneville' + (zone === 'salt' ? '' : '&zone=' + zone));
      await page.waitForSelector('#loading.is-hidden');
      await page.waitForFunction(zone => document.documentElement.dataset.theme === zone, zone);
      await page.waitForTimeout(1000);
      if (zone === 'salt') assert.ok(requests.every(r => /\/salt-/.test(r)));
      else assert.ok(requests.some(r => r.includes('/' + zone + '-')));
      assert.equal(await page.evaluate(() => typeof window.__hinddy), 'undefined');
      await page.locator('#sound-volume').focus(); await page.keyboard.down('KeyW'); await page.waitForTimeout(1100); await page.keyboard.up('KeyW');
      const speed = Number(await page.locator('#speed').innerText()); assert.ok(speed > 10);
      results.push({ zone, speed, packets: [...requests] });
    }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
