import type { SurfaceProvider } from "../physics/surface";
import { nightYard, saltMorning } from "./environments";
import { updateProgress } from "../experiences/progress";
import type { ProgressEvents } from "../experiences/progress";
import type { DrivingSession } from "../experiences/driving-session";
import type RAPIER from "@dimforge/rapier3d";
import type * as THREE from "three";
import { TrackRuntime, type TrackRenderOptions } from "../track";
import { BonnevilleRuntime, SALT_PLAYABLE_HALF_SIZE } from "../bonneville";
import { TRACKS, type TrackId } from "../config";
import { Registry } from "../core/registry";
import type { TrackInstance } from "../content/track-contract";
import type { ThemeBridge } from "../design/theme";
import type { EnvironmentProfile } from "../rendering/environment";
export type TrackContext = {
  world: RAPIER.World;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  theme: ThemeBridge;
  options: TrackRenderOptions;
  shadows: boolean;
  zone?: "material" | "shadcn";
  onError(): void;
};
export type GroundDefinition = {
  environment: EnvironmentProfile;
  boundsHalfSize?: number;
  hint: string;
  surface?: SurfaceProvider;
  rules(session: DrivingSession, dt: number, events: ProgressEvents): void;
  create(context: TrackContext): TrackInstance;
};
export const grounds = new Registry<GroundDefinition>();
for (const id of ["yard", "gravel", "oval"] as const)
  grounds.register(id, {
    environment: nightYard,
    rules: updateProgress,
    hint: "",
    create: (c) => new TrackRuntime(TRACKS[id], c.world, c.scene, c.options),
  });
grounds.register("bonneville", {
  environment: saltMorning,
  rules: updateProgress,
  boundsHalfSize: SALT_PLAYABLE_HALF_SIZE,
  hint: "← Material · 1 km salt strip · shadcn →",
  create: (c) => {
    const track = new BonnevilleRuntime(
      TRACKS.bonneville,
      c.world,
      c.scene,
      c.shadows,
      c.zone,
      c.renderer.capabilities.getMaxAnisotropy(),
    );
    void track
      .attachWorlds(c.world, c.scene, c.theme, c.renderer, c.camera, c.shadows)
      .catch(c.onError);
    return track;
  },
});
export type GarageProject = {
  id: string;
  initialTrack: TrackId;
  initialVehicle: string;
  theme: string;
};
export const garageProject: GarageProject = {
  id: "it-garage",
  initialTrack: "yard",
  initialVehicle: "quadro",
  theme: "salt",
};
