import { disposeWorldGroup } from "./dispose-group";
import * as THREE from "three";
import type { VehicleSpec } from "../content/vehicle-spec";
import { buildVehicleModel, type VehicleModel } from "../vehicle-model";
import type { VehiclePhysics } from "../physics/vehicle-physics";
export class VehicleVisual {
  readonly root = new THREE.Group();
  private readonly model: VehicleModel;
  private readonly wheels: THREE.Group[] = [];
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousRotation = new THREE.Quaternion();
  private readonly currentPosition = new THREE.Vector3();
  private readonly currentRotation = new THREE.Quaternion();
  private disposed = false;
  constructor(
    spec: VehicleSpec,
    private readonly physics: VehiclePhysics,
    scene: THREE.Scene,
  ) {
    this.model = buildVehicleModel(spec);
    this.root.name = "vehicle:" + spec.id;
    this.root.add(this.model.body);
    for (const spinner of this.model.wheels) {
      const root = new THREE.Group();
      root.add(spinner);
      this.root.add(root);
      this.wheels.push(root);
    }
    scene.add(this.root);
    this.snap();
  }
  capture(): void {
    const p = this.physics.body.translation(),
      q = this.physics.body.rotation();
    this.previousPosition.set(p.x, p.y, p.z);
    this.previousRotation.set(q.x, q.y, q.z, q.w);
  }
  snap(): void {
    this.capture();
    this.sync(1);
  }
  sync(alpha = 1): void {
    const p = this.physics.body.translation(),
      q = this.physics.body.rotation();
    this.currentPosition.set(p.x, p.y, p.z);
    this.currentRotation.set(q.x, q.y, q.z, q.w);
    this.root.position.lerpVectors(
      this.previousPosition,
      this.currentPosition,
      alpha,
    );
    this.root.quaternion.slerpQuaternions(
      this.previousRotation,
      this.currentRotation,
      alpha,
    );
    this.model.steering.rotation[this.model.steeringAxis] =
      this.physics.steeringAngle * this.model.steeringRatio;
    const controller = this.physics.controller;
    for (let i = 0; i < this.wheels.length; i++) {
      const connection = controller.wheelChassisConnectionPointCs(i);
      if (!connection) continue;
      this.wheels[i].position.set(
        connection.x,
        connection.y -
          (controller.wheelSuspensionLength(i) ??
            this.physics.spec.suspensionRestM),
        connection.z,
      );
      this.wheels[i].rotation.y = i < 2 ? this.physics.steeringAngle : 0;
      this.model.wheels[i].rotation.x = controller.wheelRotation(i) ?? 0;
    }
  }
  get steeringAngle(): number {
    return this.model.steering.rotation[this.model.steeringAxis];
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    disposeWorldGroup(this.root);
  }
}
