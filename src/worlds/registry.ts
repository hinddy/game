import saltURL from "./bundles/salt.json?url";
import materialURL from "./bundles/material.json?url";
import shadcnURL from "./bundles/shadcn.json?url";
import type { WorldEntry } from "./types";
export const SALT_STRIP_HALF_WIDTH = 500;
// Only this neighbourhood is indexed. Future neighbourhoods can supply the same bounded manifest.
export const WORLD_ENTRIES: WorldEntry[] = [
  { id: "salt", url: saltURL, x: 0, z: 0, halfWidth: 650, halfDepth: 900 },
  { id: "material", url: materialURL, x: -920, z: 0, halfWidth: 220, halfDepth: 230, region: [-12000, -SALT_STRIP_HALF_WIDTH, -1800, 1800] },
  { id: "shadcn", url: shadcnURL, x: 920, z: 0, halfWidth: 220, halfDepth: 260, region: [SALT_STRIP_HALF_WIDTH, 12000, -1800, 1800] },
];
