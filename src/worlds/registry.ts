import saltURL from "./bundles/salt.json?url";
import materialURL from "./bundles/material.json?url";
import shadcnURL from "./bundles/shadcn.json?url";
import type { WorldEntry } from "./types";
export const SALT_STRIP_HALF_WIDTH = 500;
// Only this neighbourhood is indexed. Future neighbourhoods can supply the same bounded manifest.
export const WORLD_ENTRIES: WorldEntry[] = [
  {
    id: "salt",
    hint: "← Material · 1 km salt strip · shadcn →",
    estimatedBytes: 262144,
    url: saltURL,
    x: 0,
    z: 0,
    halfWidth: 650,
    halfDepth: 900,
  },
  {
    id: "material",
    hint: "Material · drive onto the controls",
    estimatedBytes: 2097152,
    url: materialURL,
    x: -920,
    z: 0,
    halfWidth: 220,
    halfDepth: 230,
    region: [-12000, -SALT_STRIP_HALF_WIDTH, -1800, 1800],
  },
  {
    id: "shadcn",
    hint: "shadcn · build from a garage",
    estimatedBytes: 2097152,
    url: shadcnURL,
    x: 920,
    z: 0,
    halfWidth: 220,
    halfDepth: 260,
    region: [SALT_STRIP_HALF_WIDTH, 12000, -1800, 1800],
  },
];
