import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d";
import type { ThemeBridge } from "../design/theme";
import { WorldStreamer } from "./streamer";
import { WORLD_ENTRIES } from "./registry";
import { garageContentFactories } from "./garage-content";
export function createGarageStreamer(
  world: RAPIER.World,
  scene: THREE.Scene,
  theme: ThemeBridge,
  shadows: boolean,
  course: () => THREE.Group,
  prepare: (group: THREE.Group) => Promise<unknown>,
): WorldStreamer {
  const factories = garageContentFactories(world, theme, shadows, course);
  return new WorldStreamer({
    scene,
    entries: WORLD_ENTRIES,
    create: (bundle) =>
      factories.get(bundle.kind ?? (bundle.course ? "course" : "ui"))(bundle),
    prepare,
    onActivate: (name) => theme.setTheme(name),
    hint: (id) => WORLD_ENTRIES.find((e) => e.id === id)?.hint ?? "",
    errorHint: "UI world delayed · salt remains drivable",
  });
}
