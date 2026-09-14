import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d";
import type { ThemeBridge } from "../design/theme";
import { UIWorld } from "../design/primitives";
import { Registry } from "../core/registry";
import { disposeWorldGroup } from "../rendering/dispose-group";
import type { WorldContent } from "../content/world-content";
import type { WorldBundle } from "./types";
export function garageContentFactories(
  world: RAPIER.World,
  theme: ThemeBridge,
  shadows: boolean,
  course: () => THREE.Group,
) {
  const factories = new Registry<(bundle: WorldBundle) => WorldContent>();
  factories.register(
    "ui",
    (bundle) => new UIWorld(bundle, world, theme, shadows),
  );
  factories.register("course", (bundle) => {
    const group = course();
    return {
      group,
      buildStep: () => true,
      safeToActivate: () => true,
      activate() {},
      update() {},
      pick: () => null,
      setPointer() {},
      snapshot: () => ({ id: bundle.id, ready: true }),
      dispose: () => disposeWorldGroup(group),
    };
  });
  return factories;
}
