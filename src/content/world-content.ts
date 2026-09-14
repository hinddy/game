import type * as THREE from "three";
import type { UIState } from "../worlds/types";
export type ContentSnapshot = {
  id: string;
  ready?: boolean;
  built?: number;
  enabled?: boolean;
  colliders?: number;
  states?: Array<{ id: string; state: UIState; depression: number }>;
};
/** A chunk owns its resources. Shared theme materials remain owned by the app. */
export interface WorldContent {
  readonly group: THREE.Group;
  buildStep(): boolean;
  safeToActivate(position: THREE.Vector3): boolean;
  activate(): void;
  update(dt: number, position: THREE.Vector3): void;
  pick(ray: THREE.Raycaster): { distance: number; index: number } | null;
  setPointer(index: number | null, down: boolean, click?: boolean): void;
  snapshot(): ContentSnapshot;
  dispose(): void;
}
export type StreamingBudget = {
  maxWorlds: number;
  maxEstimatedBytes: number;
  maxTransferBytes: number;
  buildMilliseconds: number;
};
export const DEFAULT_STREAMING_BUDGET: StreamingBudget = {
  maxWorlds: 3,
  maxEstimatedBytes: 24 * 1024 * 1024,
  maxTransferBytes: 65536,
  buildMilliseconds: 2,
};
