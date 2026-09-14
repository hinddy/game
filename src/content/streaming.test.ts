import { test, expect } from "bun:test";
import * as THREE from "three";
import { WorldStreamer, type StreamingServices } from "../worlds/streamer";
import type { WorldBundle } from "../worlds/types";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const packet = (id = "custom"): WorldBundle => ({
  version: 1,
  id,
  kind: "custom",
  theme: "forest",
  title: "Forest",
  elements: [],
  data: { biome: "trees" },
});
function harness(load: NonNullable<StreamingServices["load"]>) {
  let created = 0,
    disposed = 0,
    activated = 0;
  const themes: string[] = [];
  const services: StreamingServices = {
    scene: new THREE.Scene(),
    entries: [
      { id: "custom", url: "/first", x: 0, z: 0, halfWidth: 10, halfDepth: 10 },
    ],
    load,
    create: (bundle) => {
      created++;
      const group = new THREE.Group();
      return {
        group,
        buildStep: () => true,
        safeToActivate: () => true,
        activate() {
          activated++;
        },
        update() {},
        pick: () => null,
        setPointer() {},
        snapshot: () => ({ id: bundle.id }),
        dispose() {
          disposed++;
          group.removeFromParent();
        },
      };
    },
    prepare: async () => {},
    onActivate: (theme) => themes.push(theme),
    hint: (id) => id,
    errorHint: "failed",
  };
  const streamer = new WorldStreamer(services);
  return {
    streamer,
    services,
    themes,
    counts: () => ({ created, disposed, activated }),
  };
}
test("streamer accepts a non-UI factory and applies the first world theme", async () => {
  const h = harness(async () => packet());
  const position = new THREE.Vector3();
  h.streamer.tick(1, position, 8);
  await flush();
  h.streamer.tick(2, position, 8);
  await flush();
  h.streamer.tick(3, position, 8);
  expect(h.counts().activated).toBe(1);
  expect(h.themes).toEqual(["forest"]);
  h.streamer.dispose();
  h.streamer.dispose();
  expect(h.counts().disposed).toBe(1);
  expect(h.services.scene.children).toHaveLength(0);
});
test("a superseded manifest cannot install the old response with the same ID", async () => {
  let complete!: (value: unknown) => void;
  const h = harness(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  h.streamer.tick(1, new THREE.Vector3(), 8);
  h.streamer.setNeighbourhood([
    {
      id: "custom",
      url: "/replacement",
      x: 0,
      z: 0,
      halfWidth: 10,
      halfDepth: 10,
    },
  ]);
  complete(packet());
  await flush();
  expect(h.counts().created).toBe(0);
  h.streamer.dispose();
});
test("closing a session while downloading cannot create content afterwards", async () => {
  let complete!: (value: unknown) => void;
  const h = harness(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  h.streamer.tick(1, new THREE.Vector3(), 8);
  h.streamer.dispose();
  complete(packet());
  await flush();
  expect(h.counts().created).toBe(0);
});
