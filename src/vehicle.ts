import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d";
import { QUADRO_SPEC, type VehicleSpec, type TrackSpec } from "./config";
import type { TrackSample } from "./track";
import type { DriveInput } from "./input/drive-input";
import { VehiclePhysics } from "./physics/vehicle-physics";
import { uniformSurface, type SurfaceProvider } from "./physics/surface";
import { VehicleVisual } from "./rendering/vehicle-visual";
import { ExhaustEffect } from "./exhaust";
export type { DriveInput } from "./input/drive-input";
/** Driving actor composes independent physics, presentation and optional effects. */
export class GarageVehicle {
  readonly physics: VehiclePhysics;
  readonly presentation: VehicleVisual;
  private readonly exhaust: ExhaustEffect | null;
  private disposed = false;
  constructor(
    world: RAPIER.World,
    track: TrackSpec,
    spawn: TrackSample,
    scene: THREE.Scene,
    readonly spec: VehicleSpec = QUADRO_SPEC,
    surface: SurfaceProvider = uniformSurface(track.surfaceGrip),
  ) {
    this.physics = new VehiclePhysics(world, surface, spawn, spec);
    try {
      this.presentation = new VehicleVisual(spec, this.physics, scene);
      this.exhaust = spec.turbo ? new ExhaustEffect(scene) : null;
    } catch (error) {
      this.physics.dispose();
      throw error;
    }
  }
  get body() {
    return this.physics.body;
  }
  get controller() {
    return this.physics.controller;
  }
  get visual() {
    return this.presentation.root;
  }
  get boost() {
    return this.physics.boost;
  }
  set boost(value: number) {
    this.physics.boost = value;
  }
  get engineLoad() {
    return this.physics.engineLoad;
  }
  get steeringAngle() {
    return this.physics.steeringAngle;
  }
  get steeringControlAngle() {
    return this.presentation.steeringAngle;
  }
  get exhaustParticles() {
    return this.exhaust?.activeParticles ?? 0;
  }
  capturePose(): void {
    this.presentation.capture();
  }
  snapInterpolation(): void {
    this.presentation.snap();
  }
  update(input: DriveInput, dt: number): void {
    this.physics.update(input, dt);
  }
  syncVisual(alpha = 1): void {
    this.presentation.sync(alpha);
  }
  updateEffects(dt: number, viewportHeight: number): void {
    this.exhaust?.update(
      dt,
      this.visual,
      this.engineLoad,
      this.boost,
      viewportHeight,
    );
  }
  speedKph(): number {
    return this.physics.speedKph();
  }
  position(target = new THREE.Vector3()): THREE.Vector3 {
    return this.physics.position(target);
  }
  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return this.physics.forward(target);
  }
  reset(sample: TrackSample): void {
    this.physics.reset(sample);
    this.presentation.snap();
    this.exhaust?.clear();
  }
  dispose(_scene?: THREE.Scene): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exhaust?.dispose();
    this.presentation.dispose();
    this.physics.dispose();
  }
}
