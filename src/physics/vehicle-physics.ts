import type { DriveInput } from "../input/drive-input";
import type { SurfaceProvider } from "./surface";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import { QUADRO_SPEC, type VehicleSpec, type TrackSpec } from "../config";
import {
  driveForces,
  cruiseForces,
  metersPerSecondToKph,
} from "../vehicle-drive";
import type { TrackSample } from "../track";

export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  private steering = 0;
  boost = 0;
  private throttle = 0;
  private cruiseTargetKph: number | null = null;
  private disposed = false;
  private readonly contact = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly grips = new Float64Array(4).fill(-1);

  constructor(
    private readonly world: RAPIER.World,
    private readonly surface: SurfaceProvider,
    spawn: TrackSample,
    readonly spec: VehicleSpec = QUADRO_SPEC,
  ) {
    const spawnPosition = spawn.position
      .clone()
      .add(new THREE.Vector3(0, 0.85, 0));
    const descriptor = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
      .setRotation(spawn.rotation)
      .setLinearDamping(0.18)
      .setAngularDamping(0.62)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(
        this.spec.massKg,
        this.spec.centerOfMass,
        this.spec.inertia,
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = world.createRigidBody(descriptor);

    const collider = RAPIER.ColliderDesc.cuboid(
      this.spec.chassis.width / 2,
      this.spec.chassis.height / 2,
      this.spec.chassis.length / 2,
    )
      .setTranslation(0, 0.24, 0)
      .setDensity(0)
      .setFriction(surface.sample(spawn.position).grip)
      .setRestitution(0.02);
    world.createCollider(collider, this.body);

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    this.addWheels();
  }

  private addWheels(): void {
    const halfTrack = this.spec.trackWidthM / 2;
    const halfWheelbase = this.spec.wheelbaseM / 2;
    const connections = [
      { x: -halfTrack, y: 0.12, z: halfWheelbase },
      { x: halfTrack, y: 0.12, z: halfWheelbase },
      { x: -halfTrack, y: 0.12, z: -halfWheelbase },
      { x: halfTrack, y: 0.12, z: -halfWheelbase },
    ];

    for (const connection of connections) {
      this.controller.addWheel(
        connection,
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        this.spec.suspensionRestM,
        this.spec.wheelRadiusM,
      );
    }

    for (let index = 0; index < connections.length; index += 1) {
      this.controller.setWheelSuspensionStiffness(
        index,
        this.spec.suspensionStiffness,
      );
      this.controller.setWheelSuspensionCompression(
        index,
        this.spec.suspensionCompression,
      );
      this.controller.setWheelSuspensionRelaxation(
        index,
        this.spec.suspensionRelaxation,
      );
      this.controller.setWheelMaxSuspensionTravel(
        index,
        this.spec.suspensionTravelM,
      );
      this.controller.setWheelMaxSuspensionForce(index, 2800);
      this.controller.setWheelFrictionSlip(
        index,
        2.25 * this.surface.sample(this.contact).grip,
      );
      this.controller.setWheelSideFrictionStiffness(
        index,
        1.15 * this.surface.sample(this.contact).grip,
      );
    }
  }

  update(input: DriveInput, dt: number): void {
    this.throttle = input.throttle;
    const wantsTurbo =
      !!this.spec.turbo &&
      input.turbo &&
      input.throttle > 0 &&
      input.brake <= 0 &&
      this.controller.currentVehicleSpeed() >= -0.28;
    this.boost = wantsTurbo
      ? THREE.MathUtils.damp(
          this.boost,
          1,
          1 / this.spec.turbo!.responseSeconds,
          dt,
        )
      : 0;
    const speedKph = metersPerSecondToKph(
      this.controller.currentVehicleSpeed(),
    );
    const normalizedSpeed = THREE.MathUtils.clamp(
      Math.abs(speedKph) / this.spec.targetTopSpeedKph,
      0,
      1,
    );
    const steeringLimit = THREE.MathUtils.lerp(
      this.spec.maxSteerRad,
      this.spec.maxSteerRad * 0.34,
      normalizedSpeed,
    );
    this.steering = THREE.MathUtils.damp(
      this.steering,
      input.steer * steeringLimit,
      10.46,
      dt,
    );

    const cruising =
      input.cruiseSpeedKph !== undefined &&
      input.throttle > 0 &&
      input.brake <= 0 &&
      !input.holdBrake;
    let forces: { engine: number; brake: number };
    if (input.holdBrake) {
      this.cruiseTargetKph = null;
      forces = { engine: 0, brake: this.spec.brakeForce };
    } else if (cruising) {
      const desired = wantsTurbo
        ? this.spec.turbo!.topSpeedKph
        : input.cruiseSpeedKph!;
      this.cruiseTargetKph ??= Math.max(0, speedKph);
      const rate = desired > this.cruiseTargetKph ? 24 : 12;
      this.cruiseTargetKph += THREE.MathUtils.clamp(
        desired - this.cruiseTargetKph,
        -rate * dt,
        rate * dt,
      );
      forces = cruiseForces(
        this.controller.currentVehicleSpeed(),
        this.cruiseTargetKph,
        this.spec,
        this.boost,
      );
    } else {
      this.cruiseTargetKph = null;
      forces = driveForces(
        this.controller.currentVehicleSpeed(),
        input.throttle,
        input.brake,
        this.spec,
        this.boost,
      );
    }
    const { engine, brake } = forces;
    // Audio/exhaust follow actual load rather than treating cruise as full throttle.
    this.throttle = THREE.MathUtils.clamp(engine / this.spec.engineForce, 0, 1);

    this.controller.setWheelSteering(0, this.steering);
    this.controller.setWheelSteering(1, this.steering);
    this.controller.setWheelEngineForce(2, engine);
    this.controller.setWheelEngineForce(3, engine);
    for (let index = 0; index < 4; index += 1)
      this.controller.setWheelBrake(index, brake);

    for (let i = 0; i < 4; i++) {
      const point =
        this.controller.wheelContactPoint(i, this.contact) ??
        this.position(this.contact);
      const grip = this.surface.sample(point).grip;
      if (!Number.isFinite(grip) || grip < 0)
        throw Error("Invalid surface grip");
      if (grip !== this.grips[i]) {
        this.grips[i] = grip;
        this.controller.setWheelFrictionSlip(i, 2.25 * grip);
        this.controller.setWheelSideFrictionStiffness(i, 1.15 * grip);
      }
    }
    this.controller.updateVehicle(dt);
  }

  get engineLoad(): number {
    return this.throttle;
  }
  get steeringAngle(): number {
    return this.steering;
  }

  speedKph(): number {
    return Math.abs(
      metersPerSecondToKph(this.controller.currentVehicleSpeed()),
    );
  }

  position(target = new THREE.Vector3()): THREE.Vector3 {
    const value = this.body.translation();
    return target.set(value.x, value.y, value.z);
  }

  forward(target = new THREE.Vector3()): THREE.Vector3 {
    const rotation = this.body.rotation();
    return target
      .set(0, 0, 1)
      .applyQuaternion(
        this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w),
      );
  }

  reset(sample: TrackSample): void {
    const position = sample.position.clone().add(new THREE.Vector3(0, 0.85, 0));
    this.body.setTranslation(position, true);
    this.body.setRotation(sample.rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = 0;
    this.boost = 0;
    this.throttle = 0;
    this.cruiseTargetKph = null;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, 0);
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
