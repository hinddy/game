import { describe, expect, test } from "bun:test";
import { QUADRO_SPEC, TRACKS, WORLD_PHYSICS } from "./config";

describe("WorldSpec invariants", () => {
  test("all proving grounds are closed candidates with enough control points", () => {
    expect(Object.keys(TRACKS)).toHaveLength(4);
    for (const track of Object.values(TRACKS)) {
      expect(track.points.length).toBeGreaterThanOrEqual(6);
      expect(track.sampleCount).toBeGreaterThanOrEqual(track.points.length * 8);
      expect(track.defaultWidth).toBeGreaterThanOrEqual(7);
      if (track.surface !== "salt") expect(track.barrierHeight).toBeGreaterThan(0);
    }
  });

  test("physics uses SI units and a fixed 60 Hz step", () => {
    expect(WORLD_PHYSICS.gravity.y).toBe(-9.81);
    expect(WORLD_PHYSICS.fixedStep).toBeCloseTo(1 / 60, 8);
    expect(WORLD_PHYSICS.killY).toBeLessThan(0);
  });

  test("Quadro starts as a low-speed stable proving-ground vehicle", () => {
    expect(QUADRO_SPEC.massKg).toBeGreaterThan(200);
    expect(QUADRO_SPEC.targetTopSpeedKph).toBeLessThanOrEqual(40);
    expect(QUADRO_SPEC.centerOfMass.y).toBeLessThan(0);
    expect(QUADRO_SPEC.trackWidthM).toBeGreaterThan(QUADRO_SPEC.wheelRadiusM * 2);
  });
});
import { buildVehicleModel } from "./vehicle-model";
import { driveForces, metersPerSecondToKph } from "./vehicle-drive";
import * as THREE from "three";
import { VEHICLES } from "./config";

describe("Vehicle geometry and drive regressions", () => {
  for (const [id, spec] of Object.entries(VEHICLES)) {
    test(id + " stays within the MVP geometry budget with finite normals", () => {
      const model = buildVehicleModel(spec);
      let triangles = 0, draws = 0;
      for (const group of [model.body, ...model.wheels]) group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        draws++;
        triangles += object.geometry.index!.count / 3;
        for (const attribute of ["position", "normal"]) {
          expect(Array.from(object.geometry.getAttribute(attribute).array).every(Number.isFinite)).toBe(true);
        }
      });
      expect(draws).toBeLessThanOrEqual(24);
      expect(triangles).toBeLessThan(18000);
      const wheelBounds = new THREE.Box3().setFromObject(model.wheels[0]);
      expect(wheelBounds.max.y).toBeCloseTo(spec.wheelRadiusM, 3);
      const firstMesh = model.wheels[0].children[0] as THREE.Mesh;
      expect((model.wheels[1].children[0] as THREE.Mesh).geometry).toBe(firstMesh.geometry);
      console.log(id, { triangles, draws });
    });
    test(id + " brakes before changing direction and limits propulsion in km/h", () => {
      expect(metersPerSecondToKph(10)).toBe(36);
      expect(driveForces(10, 0, 1, spec).engine).toBe(0);
      expect(driveForces(10, 0, 1, spec).brake).toBe(spec.brakeForce);
      expect(driveForces(-2, 1, 0, spec).engine).toBe(0);
      expect(driveForces(-2, 1, 0, spec).brake).toBe(spec.brakeForce);
      expect(driveForces(0, 0, 1, spec).engine).toBeLessThan(0);
      expect(driveForces(spec.targetTopSpeedKph / 3.6, 1, 0, spec).engine).toBe(0);
    });
  }
});
import { trackRibbon, roadProfile, barrierProfile } from "./track-geometry";

test("road ribbon closes without gaps and has upward non-degenerate faces", () => {
  const samples = Array.from({ length: 32 }, (_, i) => {
    const a = i * Math.PI * 2 / 32;
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent);
    return { position: new THREE.Vector3(Math.cos(a) * 20, 0, Math.sin(a) * 20),
      tangent, right, width: 7,
      rotation: new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), tangent)) };
  });
  const geometry = trackRibbon(samples, samples.map((_, i) => i), roadProfile);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < 2; i++) {
    expect(new THREE.Vector3().fromBufferAttribute(positions, i).distanceTo(
      new THREE.Vector3().fromBufferAttribute(positions, positions.count - 2 + i))).toBe(0);
  }
  const normals = geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0.99);
  for (const side of [-1, 1]) {
    const wall = trackRibbon(samples, [0, 1, 2], barrierProfile(side, 0.8));
    expect(Array.from(wall.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
    wall.dispose();
  }
  geometry.dispose();
});

import { BUGGY_SPEC, vehicleForTrack } from "./config";

test("Bonneville enforces BuggY without restricting the other grounds", () => {
  expect(vehicleForTrack("bonneville", "quadro")).toBe("buggy");
  expect(vehicleForTrack("bonneville", "buggy")).toBe("buggy");
  for (const track of ["yard", "gravel", "oval"] as const) {
    expect(vehicleForTrack(track, "quadro")).toBe("quadro");
  }
  expect(TRACKS.bonneville.surface).toBe("salt");
  expect(TRACKS.bonneville.barrierHeight).toBe(0);
});

test("turbo increases BuggY propulsion and speed ceiling only under forward throttle", () => {
  const normal = driveForces(10, 1, 0, BUGGY_SPEC);
  const turbo = driveForces(10, 1, 0, BUGGY_SPEC, 1);
  expect(turbo.engine).toBeGreaterThan(normal.engine * 1.6);
  expect(driveForces(65 / 3.6, 1, 0, BUGGY_SPEC).engine).toBe(0);
  expect(driveForces(65 / 3.6, 1, 0, BUGGY_SPEC, 1).engine).toBeGreaterThan(0);
  expect(driveForces(90 / 3.6, 1, 0, BUGGY_SPEC, 1).engine).toBe(0);
  expect(driveForces(10, 0, 0, BUGGY_SPEC, 1).engine).toBe(0);
  expect(driveForces(10, 0, 1, BUGGY_SPEC, 1).engine).toBe(0);
  expect(driveForces(-2, 1, 0, BUGGY_SPEC, 1).engine).toBe(0);
  expect(driveForces(10, 1, 0, QUADRO_SPEC, 1).engine).toBe(driveForces(10, 1, 0, QUADRO_SPEC).engine);
});

import { DriveControls } from "./drive-controls";
import { cruiseForces } from "./vehicle-drive";

describe("manual input and cruise state", () => {
  test("Shift alone never drives or boosts; releasing W immediately ends boost", () => {
    const controls = new DriveControls();
    controls.keyDown("ShiftLeft");
    expect(controls.input().throttle).toBe(0);
    expect(controls.input().turbo).toBe(false);
    controls.keyDown("KeyW");
    expect(controls.input().turbo).toBe(true);
    controls.keyUp("KeyW");
    expect(controls.input().throttle).toBe(0);
    expect(controls.input().turbo).toBe(false);
    controls.keyDown("ArrowUp");
    expect(controls.input().turbo).toBe(true);
    controls.keyDown("KeyS");
    expect(controls.input().throttle).toBe(0);
    expect(controls.input().turbo).toBe(false);
  });

  test("cruise requires explicit start and cancels until a fresh W press", () => {
    const controls = new DriveControls();
    controls.setAvailable(true);
    controls.setMode("cruise");
    controls.keyDown("ShiftRight");
    expect(controls.active).toBe(false);
    expect(controls.input().turbo).toBe(false);
    controls.keyDown("KeyW");
    controls.keyUp("KeyW");
    expect(controls.active).toBe(true);
    expect(controls.input().cruiseSpeedKph).toBe(40);
    expect(controls.input().turbo).toBe(true);
    controls.keyUp("ShiftRight");
    expect(controls.active).toBe(true);
    expect(controls.input().turbo).toBe(false);
    controls.keyDown("KeyS");
    controls.keyUp("KeyS");
    expect(controls.active).toBe(false);
    expect(controls.input().holdBrake).toBe(true);
    controls.keyDown("KeyW", true);
    expect(controls.active).toBe(false);
    controls.keyUp("KeyW");
    controls.keyDown("KeyW");
    expect(controls.active).toBe(true);
    controls.cancel();
    controls.keyDown("KeyW", true);
    expect(controls.active).toBe(false);
  });

  test("brake wins over simultaneous start, track changes cancel cruise, UI preserves active cruise", () => {
    const controls = new DriveControls();
    controls.setMode("cruise");
    expect(controls.mode).toBe("manual");
    controls.setAvailable(true);
    controls.setMode("cruise");
    controls.keyDown("KeyS");
    controls.keyDown("KeyW");
    expect(controls.active).toBe(false);
    controls.keyUp("KeyS");
    controls.keyUp("KeyW");
    controls.keyDown("KeyW");
    controls.releaseKeys();
    expect(controls.active).toBe(true);
    controls.setSpeed(55);
    expect(controls.input().cruiseSpeedKph).toBe(55);
    controls.setAvailable(false);
    expect(controls.mode).toBe("manual");
    expect(controls.active).toBe(false);
    expect(controls.input().throttle).toBe(0);
  });

  test("cruise holds speed with part throttle and gently brakes overspeed without reversing", () => {
    const steady = cruiseForces(40 / 3.6, 40, BUGGY_SPEC);
    expect(steady.engine).toBeGreaterThan(0);
    expect(steady.engine).toBeLessThan(BUGGY_SPEC.engineForce);
    const overspeed = cruiseForces(80 / 3.6, 40, BUGGY_SPEC);
    expect(overspeed.engine).toBe(0);
    expect(overspeed.brake).toBeGreaterThan(0.25);
    expect(overspeed.brake).toBeLessThan(BUGGY_SPEC.brakeForce / 4);
    expect(cruiseForces(-2, 40, BUGGY_SPEC).engine).toBe(0);
  });
});
