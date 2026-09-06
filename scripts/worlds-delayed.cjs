const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const body = fs.readFileSync('src/worlds/bundles/material.json', 'utf8');
    await page.route('**/material.json', async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.fulfill({ contentType: 'application/json', body }); });
    await page.goto('http://127.0.0.1:5173/?track=bonneville');
    await page.waitForFunction(() => window.__hinddy?.snapshot()?.worlds?.resident.includes('salt'));
    await page.evaluate(() => window.__hinddy.teleport(-807, 116));
    await page.waitForFunction(() => window.__hinddy.snapshot().worlds.worlds.some(w => w.id === 'material' && w.built === 23));
    await page.waitForTimeout(1000);
    let s = await page.evaluate(() => window.__hinddy.snapshot());
    assert.equal(s.worlds.worlds.find(w => w.id === 'material').enabled, false);
    assert.ok(s.position.y < .6 && s.position.y > 0, 'late geometry must not lift or trap the car');
    await page.evaluate(() => window.__hinddy.teleport(-650, 150));
    await page.waitForFunction(() => window.__hinddy.snapshot().worlds.worlds.some(w => w.id === 'material' && w.enabled));
    await page.goto('http://127.0.0.1:5173/?track=bonneville');
    await page.waitForFunction(() => window.__hinddy?.snapshot()?.worlds?.resident.includes('salt'));
    await page.evaluate(() => window.__hinddy.teleport(-550, 150));
    await page.waitForFunction(() => window.__hinddy.snapshot().worlds.pending.includes('material'));
    await page.click('[data-track="yard"]');
    const colliders = await page.evaluate(() => window.__hinddy.snapshot().physicsColliders);
    await page.waitForTimeout(2400); s = await page.evaluate(() => window.__hinddy.snapshot());
    assert.equal(s.worlds, null); assert.equal(s.physicsColliders, colliders); assert.equal(s.theme.name, 'salt');
    assert.deepEqual(errors, []);
    console.log('PASS: late packet waits for a clear site; obsolete request never installs into a disposed physics world');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
