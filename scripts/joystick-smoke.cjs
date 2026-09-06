// Optional browser regression runner. Uses an existing Playwright installation.
// PLAYWRIGHT_MODULE_PATH points to that installation; no game dependency is added.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
const production = process.env.PRODUCTION_URL;
const output = process.env.SCREENSHOT_DIR;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    const page = await context.newPage(), cdp = await context.newCDPSession(page), points = new Map(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const snapshot = () => page.evaluate(() => window.__hinddy.snapshot());
    const settle = (ms = 160) => page.waitForTimeout(ms);
    async function touch(type) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points].map(([id, p]) => ({ id, ...p })) });
    }
    async function down(id, x, y) { points.set(id, { x, y }); await touch('touchStart'); }
    async function up(id) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, ...points.get(id) }] });
      points.delete(id); await settle();
    }
    async function stick(x, y, start = false) {
      const r = await page.locator('#drive-pad').boundingBox();
      const p = { x: r.x + r.width / 2 + x * r.width * .28, y: r.y + r.height / 2 + y * r.width * .28 };
      points.set(1, p); await touch(start ? 'touchStart' : 'touchMove'); await settle();
    }
    async function nitro() {
      const r = await page.locator('#nitro-button').boundingBox();
      await down(2, r.x + r.width / 2, r.y + r.height / 2); await settle();
    }
    await page.goto(base + '/?track=bonneville');
    await page.waitForFunction(() => window.__hinddy?.snapshot()); await settle(800);
    await stick(.4, -.5, true);
    let s = await snapshot();
    assert.ok(s.driveInput.throttle > .2 && s.driveInput.throttle < .5);
    assert.ok(s.driveInput.steer < -.15 && s.driveInput.steer > -.4);
    const partialSteer = Math.abs(s.steeringAngle);
    await stick(1, 0); await settle(350);
    s = await snapshot(); assert.equal(s.driveInput.throttle, 0); assert.equal(s.driveInput.brake, 0);
    assert.ok(Math.abs(s.steeringAngle) > partialSteer * 1.5);
    assert.ok(Math.abs(s.steeringControlAngle) > .4);
    await stick(0, -1); await settle(800); await nitro();
    s = await snapshot(); assert.equal(s.driveInput.turbo, true); assert.ok(s.boost > .2);
    // A third finger can orbit the scene while both driving thumbs are held.
    await down(3, 500, 320); points.set(3, { x: 590, y: 360 }); await touch('touchMove'); await settle();
    s = await snapshot(); assert.ok(Math.abs(s.orbitYaw) > .3); assert.equal(s.driveInput.throttle, 1);
    await up(3); await up(2); s = await snapshot(); assert.equal(s.driveInput.throttle, 1); assert.equal(s.driveInput.turbo, false);
    const speedBeforeCoast = s.speedKph;
    await stick(.7, 0); await settle(250); s = await snapshot();
    assert.equal(s.driveInput.throttle, 0); assert.equal(s.driveInput.brake, 0);
    assert.ok(s.speedKph > speedBeforeCoast * .45);
    await stick(0, 1); await settle(2400); s = await snapshot();
    assert.ok(s.signedSpeedKph < -1, 'held down must brake and then reverse');
    await up(1); s = await snapshot(); assert.equal(s.driveInput.brake, 0);
    await stick(0, -1, true); await nitro();
    points.clear(); await touch('touchCancel'); await settle(700);
    s = await snapshot(); assert.equal(s.driveInput.throttle, 0); assert.equal(s.driveInput.turbo, false);
    const matrix = await page.locator('.stick-knob').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).toFloat64Array().slice(12, 14));
    assert.ok(Math.abs(matrix[0]) < .1 && Math.abs(matrix[1]) < .1);
    await page.click('#vehicle-reset'); await settle(700);
    if (output) await page.screenshot({ path: output + '/analog-landscape.jpg', type: 'jpeg', quality: 85 });
    await page.setViewportSize({ width: 768, height: 1024 }); await settle(250);
    const rects = await Promise.all(['.drive-dock', '.nitro-dock', '.track-picker'].map(selector => page.locator(selector).boundingBox()));
    for (const r of rects) assert.ok(r.x >= 0 && r.x + r.width <= 768 && r.y + r.height <= 1024);
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const x = rects[a], y = rects[b]; assert.ok(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y);
    }
    if (output) await page.screenshot({ path: output + '/analog-portrait.jpg', type: 'jpeg', quality: 85 });
    const results = [];
    for (const track of ['yard', 'gravel', 'oval', 'bonneville']) for (const vehicle of track === 'bonneville' ? ['buggy'] : ['quadro', 'buggy']) {
      await page.goto(base + '/?track=' + track + '&vehicle=' + vehicle);
      await page.waitForFunction(() => window.__hinddy?.snapshot()); await settle(700);
      await stick(0, -1, true); await settle(1200); s = await snapshot(); assert.ok(s.speedKph > 10);
      await stick(.6, -.6); s = await snapshot(); assert.ok(Math.abs(s.steeringControlAngle) > .05);
      await up(1); await page.locator('#sound-volume').focus(); await page.keyboard.down('KeyW'); await settle(300);
      assert.equal((await snapshot()).driveInput.throttle, 1); await page.keyboard.up('KeyW');
      results.push({ track, vehicle, speed: Math.round(s.speedKph), steering: s.steeringControlAngle });
    }
    if (production) for (const track of ['yard', 'gravel', 'oval', 'bonneville']) {
      await page.goto(production + '/?track=' + track); await page.waitForSelector('#loading.is-hidden'); await settle(700);
      await stick(0, -1, true); await settle(1300);
      assert.ok(Number(await page.locator('#speed').innerText()) > 10); await up(1);
    }
    console.log(JSON.stringify({ results, productionChecked: !!production, errors }, null, 2));
    assert.equal(errors.length, 0);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
