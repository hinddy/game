import RAPIER from "@dimforge/rapier3d";
import type * as THREE from "three";
import {
  TRACKS,
  VEHICLES,
  WORLD_PHYSICS,
  vehicleForTrack,
  type TrackId,
  type VehicleId,
} from "../config";
import { GarageVehicle } from "../vehicle";
import type { TrackSample } from "../track";
import type { TrackInstance } from "../content/track-contract";
import {
  grounds,
  type GroundDefinition,
  type TrackContext,
} from "../projects/garage";
export class DrivingSession {
  readonly world: RAPIER.World;
  readonly track: TrackInstance;
  readonly vehicle: GarageVehicle;
  readonly vehicleId: VehicleId;
  readonly definition: GroundDefinition;
  expectedCheckpoint = 1;
  lastSafeSample: TrackSample;
  lap = 0;
  outsideSeconds = 0;
  wrongWaySeconds = 0;
  private disposed = false;
  constructor(
    trackId: TrackId,
    requested: VehicleId,
    context: Omit<TrackContext, "world">,
  ) {
    this.definition = grounds.get(trackId);
    this.vehicleId = vehicleForTrack(trackId, requested);
    this.world = new RAPIER.World(WORLD_PHYSICS.gravity);
    this.world.timestep = WORLD_PHYSICS.fixedStep;
    let track: TrackInstance | undefined;
    try {
      track = this.definition.create({ ...context, world: this.world });
      this.track = track;
      this.vehicle = new GarageVehicle(
        this.world,
        TRACKS[trackId],
        track.spawn,
        context.scene,
        VEHICLES[this.vehicleId],
        this.definition.surface,
      );
      this.lastSafeSample = track.spawn;
    } catch (error) {
      try {
        track?.dispose(context.scene);
      } finally {
        this.world.free();
      }
      throw error;
    }
  }
  dispose(scene: THREE.Scene): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.track.dispose(scene);
    } finally {
      try {
        this.vehicle.dispose(scene);
      } finally {
        this.world.free();
      }
    }
  }
}
