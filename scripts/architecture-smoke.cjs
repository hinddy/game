const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      (process.env.GAME_URL || "http://127.0.0.1:5173") + "/?track=bonneville",
    );
    await page.waitForSelector("#loading.is-hidden");
    const physics = await page.evaluate(async () => {
      const source = await (
        await fetch("/src/physics/vehicle-physics.ts")
      ).text();
      const THREE = await import(
        source.match(/import \* as THREE from "([^"]+)"/)[1]
      );
      const { default: RAPIER } = await import(
        source.match(/import RAPIER from "([^"]+)"/)[1]
      );
      const { VehiclePhysics } = await import(
        "/src/physics/vehicle-physics.ts"
      );
      const { GarageVehicle } = await import("/src/vehicle.ts");
      const { QUADRO_SPEC, TRACKS } = await import("/src/config.ts");
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0),
      );
      const spawn = {
        position: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        tangent: new THREE.Vector3(0, 0, 1),
        right: new THREE.Vector3(1, 0, 0),
        width: 10,
      };
      let grip = 1;
      const surface = { sample: () => ({ grip }) };
      const input = { throttle: 0.5, brake: 0, steer: 0 };
      let speed = 0;
      for (let i = 0; i < 6; i++) {
        const car = new VehiclePhysics(world, surface, spawn, QUADRO_SPEC);
        for (let step = 0; step < 120; step++) {
          car.update(input, 1 / 60);
          world.step();
        }
        speed = car.speedKph();
        grip = 0.25;
        car.update(input, 1 / 60);
        if (Math.abs(car.controller.wheelFrictionSlip(0) - 0.5625) > 1e-5)
          throw Error("Contact surface is not applied");
        car.dispose();
        car.dispose();
        if (
          world.vehicleControllers.size !== 0 ||
          world.bodies.len() !== 0 ||
          world.colliders.len() !== 1
        )
          throw Error("Vehicle resources leaked");
      }
      const scene = new THREE.Scene();
      const actor = new GarageVehicle(world, TRACKS.yard, spawn, scene, {
        ...QUADRO_SPEC,
        id: "custom-id-without-model-name",
      });
      actor.capturePose();
      actor.body.setTranslation({ x: 10, y: 0.85, z: 0 }, true);
      actor.syncVisual(0.5);
      const interpolated = actor.visual.position.x;
      actor.snapInterpolation();
      const snapped = actor.visual.position.x;
      actor.dispose(scene);
      const remaining = world.colliders.len();
      world.free();
      return {
        speed,
        interpolated,
        snapped,
        remaining,
        visuals: scene.children.length,
      };
    });
    assert.ok(physics.speed > 5);
    assert.equal(physics.interpolated, 5);
    assert.equal(physics.snapped, 10);
    assert.equal(physics.remaining, 1);
    assert.equal(physics.visuals, 0);
    await page.evaluate(async () => {
      const { app } = await import("/src/main.ts");
      app.dispose();
      app.dispose();
      const original = window.addEventListener;
      window.keyDeliveries = 0;
      window.addEventListener = function (type, listener, options) {
        if (type === "keydown") {
          const wrapped = (event) => {
            window.keyDeliveries++;
            listener.call(this, event);
          };
          return original.call(this, type, wrapped, options);
        }
        return original.call(this, type, listener, options);
      };
    });
    const mounts = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async () => {
        const { createApp } = await import("/src/app/create-app.ts");
        window.testApp = createApp();
        await window.testApp.start();
        await window.testApp.start();
      });
      await page.waitForTimeout(250);
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(700);
      await page.keyboard.up("KeyW");
      mounts.push(
        await page.evaluate(() => ({
          speed: window.__hinddy.snapshot().speedKph,
          deliveries: window.keyDeliveries,
        })),
      );
      await page.evaluate(() => window.testApp.dispose());
    }
    mounts.forEach((m, i) => {
      assert.ok(m.speed > 5);
      assert.equal(m.deliveries, i + 1, "old input listener survived disposal");
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ physics, mounts, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
