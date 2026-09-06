// Compare against the deployed, footprint-filtered 120 km plane (before local detail).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
(async () => {
  const baseline = process.env.SALT_BASELINE_REF || '841d843';
  const source = execFileSync('git', ['show', `${baseline}:src/bonneville.ts`], { encoding: 'utf8' });
  const oldCode = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, ''), { mode: 'transform' });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto((process.env.GAME_URL || 'http://127.0.0.1:5173') + '/?track=bonneville');
    await page.waitForSelector('#loading.is-hidden');
    const result = await page.evaluate(async oldCode => {
      const source = await (await fetch('/src/bonneville.ts')).text();
      const THREE = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
      const { default: RAPIER } = await import(source.match(/import RAPIER from "([^"]+)"/)[1]);
      const { BonnevilleRuntime } = await import('/src/bonneville.ts');
      const { TRACKS } = await import('/src/config.ts');
      const { BONNEVILLE_SUN_DIRECTION } = await import('/src/bonneville-light.ts');
      const OldRuntime = new Function('THREE', 'RAPIER', 'BONNEVILLE_SUN_DIRECTION',
        oldCode + '\nreturn BonnevilleRuntime;')(THREE, RAPIER, BONNEVILLE_SUN_DIRECTION);
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      const width = 640, height = 360;
      renderer.setSize(width, height);
      const target = new THREE.WebGLRenderTarget(width, height);
      const camera = new THREE.PerspectiveCamera(55, width / height, .2, 80000);
      const direction = new THREE.Vector3(0, 0, -1);
      const make = Runtime => {
        const scene = new THREE.Scene();
        const runtime = new Runtime(TRACKS.bonneville, { createCollider() {} }, scene, false,
          undefined, renderer.capabilities.getMaxAnisotropy());
        const ground = runtime.group.getObjectByName('dry-salt');
        scene.remove(runtime.group);
        const surface = ground.parent === runtime.group ? ground : ground.parent;
        scene.add(surface, new THREE.AmbientLight(0xffffff, 3));
        return { scene, runtime, surface };
      };
      const current = make(BonnevilleRuntime), previous = make(OldRuntime);
      const render = (test, x, z = 0, focusX = x) => {
        test.runtime.stream(0, new THREE.Vector3(focusX, 0, z), direction);
        camera.position.set(x, .8, z); camera.lookAt(x, 0, z - 8);
        renderer.setRenderTarget(target); renderer.render(test.scene, camera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        return pixels;
      };
      const difference = (a, b) => {
        let sum = 0;
        // Nearby road only; exclude the naturally changing distant fade/ring boundary.
        for (let y = 0; y < 240; y++) for (let x = 80; x < 560; x++) {
          const i = (y * width + x) * 4; sum += Math.abs(a[i] - b[i]);
        }
        return sum / (240 * 480);
      };
      const results = {};
      for (const [name, test] of [['previous', previous], ['current', current]]) {
        const origin = render(test, 0);
        results[name] = {
          stationary: difference(origin, render(test, 0)),
          // A whole 9 m texture period must give exactly the same ground image.
          periodicError: [9, 900, 9000, -9000].map(x => difference(origin, render(test, x))),
          recenterError: difference(render(test, 4.5, 0, 4.49), render(test, 4.5, 0, 4.51)),
          diagonalRecenterError: difference(render(test, 4.5, 4.5, 4.49), render(test, 4.5, 4.5, 4.51)),
        };
      }
      for (const test of [current, previous]) {
        test.runtime.group.add(test.surface); test.runtime.dispose(test.scene);
      }
      target.dispose(); renderer.dispose();
      return results;
    }, oldCode);
    console.log(JSON.stringify({ baseline, result, errors }, null, 2));
    assert.deepEqual(errors, []);
    assert.equal(result.current.stationary, 0);
    assert.ok(Math.max(...result.current.periodicError) < .03, 'whole-period translation must preserve the pattern');
    assert.ok(result.current.recenterError < .03, 'recentring must not move the visible texture');
    assert.ok(result.current.diagonalRecenterError < .03);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
