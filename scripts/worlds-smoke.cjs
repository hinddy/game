const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
const out = process.env.SCREENSHOT_DIR;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], downloads = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.request().resourceType() === 'fetch' && /\/(salt|material|shadcn)[^/]*\.json/.test(r.url())) downloads.push(r.url()); });
    await page.goto(base + '/?track=bonneville');
    await page.waitForFunction(() => window.__hinddy?.snapshot()?.worlds?.resident.includes('salt'));
    await page.waitForTimeout(700);
    const snap = () => page.evaluate(() => window.__hinddy.snapshot());
    let s = await snap();
    assert.deepEqual(s.worlds.resident, ['salt']);
    assert.equal(s.physicsColliders, 2);
    assert.equal(downloads.length, 1, 'side packets must not be fetched at central spawn');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 20000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      window.frameTimes = []; let last = performance.now();
      function record(now) { if (window.frameTimes.length < 4000) window.frameTimes.push(now - last); last = now; requestAnimationFrame(record); }
      requestAnimationFrame(record); window.__hinddy.teleport(-550, 150);
    });
    await page.waitForFunction(() => window.__hinddy.snapshot().worlds.worlds.some(w => w.id === 'material' && w.enabled), { timeout: 20000 });
    await page.waitForTimeout(1500);
    s = await snap(); assert.equal(s.theme.name, 'material'); assert.ok(s.physicsColliders > 30);
    assert.ok(s.worlds.resident.length <= 3); assert.ok(s.position.y > -.5);
    const times = await page.evaluate(() => window.frameTimes.slice(5).sort((a,b) => a-b));
    const timing = { p95: times[Math.floor(times.length * .95)], max: times.at(-1) };
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // Both rendering paths must see the token edit in the very next rendered frame.
    const theme = await page.evaluate(async () => {
      document.documentElement.style.setProperty('--accent', '#20c7a8');
      document.documentElement.style.setProperty('--radius', '9px');
      document.documentElement.style.setProperty('--roughness', '.4');
      await new Promise(requestAnimationFrame);
      return { html: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), data: window.__hinddy.snapshot().theme };
    });
    assert.equal(theme.html, '#20c7a8'); assert.equal(theme.data.materialAccent, '20c7a8'); assert.equal(theme.data.shaderAccent, '20c7a8');
    assert.equal(theme.data.radius, .09); assert.equal(theme.data.roughness, .4);
    const modernColor = await page.evaluate(async () => {
      document.documentElement.style.setProperty('--accent', 'rgb(32 199 168)');
      await new Promise(requestAnimationFrame); return window.__hinddy.snapshot().theme;
    });
    assert.equal(modernColor.materialAccent, '20c7a8'); assert.equal(modernColor.shaderAccent, '20c7a8');
    await page.evaluate(() => { for (const name of ['--accent','--radius','--roughness']) document.documentElement.style.removeProperty(name); });
    await page.evaluate(() => window.__hinddy.teleport(-490, -350, .85, -Math.PI / 2));
    await page.waitForTimeout(250);
    const identity = (await snap()).vehicleInstance;
    await page.evaluate(() => window.__hinddy.setInput({ throttle: .6, brake: 0, steer: 0 }));
    await page.waitForFunction(() => window.__hinddy.snapshot().position.x < -510);
    s = await snap(); assert.equal(s.vehicleInstance, identity); assert.ok(s.speedKph > 8);
    assert.equal(s.driveInput.throttle, .6); assert.equal(s.worlds.active, 'material');
    await page.evaluate(() => window.__hinddy.setInput({ throttle: 0, brake: 0, steer: 0 }));
    // Actual tyre contact on a button must depress it and restore after leaving.
    await page.evaluate(() => window.__hinddy.teleport(-807, 116, 2));
    await page.waitForTimeout(1100); s = await snap();
    let button = s.worlds.worlds.find(w => w.id === 'material').states.find(e => e.id === 'deploy');
    assert.equal(button.state, 'pressed'); assert.ok(button.depression > .1); assert.ok(s.wheelContacts.some(Boolean));
    await page.evaluate(() => window.__hinddy.teleport(-719, 220)); await page.waitForTimeout(700);
    button = (await snap()).worlds.worlds.find(w => w.id === 'material').states.find(e => e.id === 'deploy');
    assert.equal(button.state, 'selected'); assert.ok(button.depression < .001);
    // Drive uphill onto the same button via its physical ramp.
    await page.evaluate(() => { window.__hinddy.teleport(-807, 153, .85, Math.PI); window.__hinddy.setInput({ throttle: .35, brake: 0, steer: 0 }); });
    let climbed = false;
    for (let i = 0; i < 80; i++) { await page.waitForTimeout(100); s = await snap(); if (s.position.y > 1.45 && s.position.z < 136 && s.position.z > 110) { climbed = true; break; } }
    await page.evaluate(() => window.__hinddy.setInput({ throttle: 0, brake: 0, steer: 0 }));
    assert.ok(climbed, 'buggy must drive from salt up the ramp onto a UI button');
    if (out) {
      await page.evaluate(() => { window.__hinddy.teleport(-920, 0, 8); window.__hinddy.overview(490); });
      await page.waitForTimeout(200); await page.screenshot({ path: out + '/material-dashboard.jpg', type: 'jpeg', quality: 88 });
    }
    // Repeated unload/reload must plateau instead of accumulating colliders or geometries.
    const memory = [];
    const heaps = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const [id, x] of [['shadcn', 2200], ['material', -2200]]) {
        await page.evaluate(x => { window.__hinddy.teleport(x, 150); document.querySelector('#camera-reset').click(); }, x);
        await page.waitForFunction(id => { const s = window.__hinddy.snapshot(); return s.worlds.resident.length === 1 && s.worlds.worlds.some(w => w.id === id && w.enabled); }, id);
        await page.waitForTimeout(700); s = await snap();
        memory.push({ id, geometries: s.geometries, textures: s.textures, colliders: s.physicsColliders });
        await cdp.send('HeapProfiler.collectGarbage');
        heaps.push({ id, bytes: (await cdp.send('Runtime.getHeapUsage')).usedSize });
      }
    }
    for (const id of ['material','shadcn']) { const a = memory.filter(m => m.id === id); assert.deepEqual(a[0], a[1]); assert.deepEqual(a[1], a[2]); }
    for (const id of ['material','shadcn']) { const a = heaps.filter(m => m.id === id); assert.ok(a[2].bytes < a[0].bytes + 1500000); }
    await page.evaluate(() => window.__hinddy.teleport(650, 150));
    await page.waitForFunction(() => window.__hinddy.snapshot().worlds.worlds.some(w => w.id === 'shadcn' && w.enabled));
    await page.waitForTimeout(600);
    if (out) {
      await page.evaluate(() => { window.__hinddy.teleport(920, 0, 8); window.__hinddy.overview(530); });
      await page.waitForTimeout(200); await page.screenshot({ path: out + '/shadcn-landing.jpg', type: 'jpeg', quality: 88 });
    }
    await page.click('[data-track="yard"]'); await page.waitForTimeout(900); s = await snap();
    assert.equal(s.worlds, null); assert.equal(s.theme.name, 'salt');
    await page.locator('#sound-volume').focus(); await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
    assert.ok((await snap()).speedKph > 10);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ timingUnder3GAnd4xCPU: timing, memory, heaps, errors, theme: theme.data }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
