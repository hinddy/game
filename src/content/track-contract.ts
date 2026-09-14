import type * as THREE from "three";
import type { TrackSpec } from "../config";
import type { TrackSample, Checkpoint } from "../track";
import type { WorldStreamer } from "../worlds/streamer";
export interface TrackInstance {
  readonly spec: TrackSpec;
  readonly group: THREE.Group;
  readonly samples: TrackSample[];
  readonly spawn: TrackSample;
  readonly checkpoints: Checkpoint[];
  readonly streamState: { ready: number; total: number };
  readonly streamer?: WorldStreamer | null;
  setViewRadius?(radius: number): void;
  stream(now: number, focus: THREE.Vector3, direction: THREE.Vector3): void;
  nearestSample(position: THREE.Vector3): {
    index: number;
    sample: TrackSample;
    distance: number;
  };
  dispose(scene: THREE.Scene): void;
}
