// Optional browser check using the existing Playwright runtime; no project dependency.
// SALT_BASELINE_REF selects a revision before the salt filtering fix for an A/B check.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
(async () => {
  const ref = process.env.SALT_BASELINE_REF;
  const oldSource = ref ? execFileSync('git', ['show', `${ref}:src/bonneville.ts`], { encoding: 'utf8' }) : null;
  const generator = oldSource ? stripTypeScriptTypes(
    oldSource.slice(oldSource.indexOf('const SALT_VISUAL_SIZE'), oldSource.indexOf('export class BonnevilleRuntime'))) : null;
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + '/?track=bonneville');
    await page.waitForSelector('#loading.is-hidden');
    const result = await page.evaluate(async generator => {
      const source = await (await fetch('/src/bonneville.ts')).text();
      const threeUrl = source.match(/import \* as THREE from "([^"]+)"/)[1];
      const THREE = await import(threeUrl);
      const { BonnevilleRuntime } = await import('/src/bonneville.ts');
      const { TRACKS } = await import('/src/config.ts');
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(640, 360);
      const scene = new THREE.Scene();
      const runtime = new BonnevilleRuntime(TRACKS.bonneville, { createCollider() {} }, scene, false,
        undefined, renderer.capabilities.getMaxAnisotropy());
      const ground = runtime.group.getObjectByName('dry-salt');
      const material = ground.material;
      scene.remove(runtime.group); scene.add(ground, new THREE.AmbientLight(0xffffff, 3));
      const oldTexture = generator ? new Function('THREE', generator + '\nreturn saltTexture();')(THREE) : null;
      const oldMaterial = oldTexture ? new THREE.MeshStandardMaterial({
        color: material.color, map: oldTexture, roughness: .97, metalness: 0,
      }) : null;
      const target = new THREE.WebGLRenderTarget(640, 360);
      const camera = new THREE.PerspectiveCamera(55, 640 / 360, .2, 100000);
      const pixels = new Uint8Array(640 * 360 * 4);
      const previous = new Uint8Array(pixels.length);
      const measure = (surface, height, distance, movement) => {
        ground.material = surface;
        let difference = 0;
        for (let frame = 0; frame < 16; frame++) {
          const x = frame * movement;
          camera.position.set(x, height, 0); camera.lookAt(x, 0, -distance);
          renderer.setRenderTarget(target); renderer.render(scene, camera);
          renderer.readRenderTargetPixels(target, 0, 0, 640, 360, pixels);
          if (frame) for (let i = 0; i < pixels.length; i += 4)
            difference += Math.abs(pixels[i] - previous[i]);
          previous.set(pixels);
        }
        return difference / (15 * 640 * 360);
      };
      const samples = [];
      for (const anisotropy of [1, Math.min(8, renderer.capabilities.getMaxAnisotropy())]) {
        material.map.anisotropy = anisotropy; material.map.needsUpdate = true;
        if (oldTexture) { oldTexture.anisotropy = Math.min(4, anisotropy); oldTexture.needsUpdate = true; }
        for (const [height, distance] of [[.8, 8], [3, 12]]) {
          samples.push({ anisotropy, height,
            stationary: measure(material, height, distance, 0),
            current: measure(material, height, distance, .004),
            baseline: oldMaterial ? measure(oldMaterial, height, distance, .004) : null });
        }
      }
      const textureSize = [material.map.image.width, material.map.image.height];
      ground.material = material; runtime.group.add(ground); runtime.dispose(scene);
      oldTexture?.dispose(); oldMaterial?.dispose(); target.dispose(); renderer.dispose();
      return { samples, textureSize };
    }, generator);
    assert.deepEqual(errors, []);
    assert.deepEqual(result.textureSize, [512, 512]);
    for (const sample of result.samples) {
      assert.equal(sample.stationary, 0, 'static salt must not change between frames');
      if (sample.baseline !== null) assert.ok(sample.current < sample.baseline * .8,
        'filtered salt should reduce temporal pixel variation by at least 20%');
    }
    console.log(JSON.stringify({ ...result, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
