import type { WorldEntry, WorldId } from "./types";
export const MAX_RESIDENT_WORLDS = 3;
export function distanceToWorld(entry: WorldEntry, x: number, z: number): number {
  return Math.hypot(Math.max(0, Math.abs(x - entry.x) - entry.halfWidth), Math.max(0, Math.abs(z - entry.z) - entry.halfDepth));
}
export function regionAt(entries: readonly WorldEntry[], x: number, z: number): WorldId {
  return entries.find(e => e.region && x > e.region[0] && x < e.region[1] && z > e.region[2] && z < e.region[3])?.id ?? entries[0].id;
}
export function planResidency(entries: readonly WorldEntry[], x: number, z: number, cameraRadius: number,
  resident: ReadonlySet<WorldId>, desired: WorldId): WorldEntry[] {
  return entries.filter(entry => {
    const distance = distanceToWorld(entry, x, z);
    const interested = entry.id === entries[0].id || resident.has(entry.id) || cameraRadius > 180 || distance < 600;
    return entry.id === desired || (interested && distance < (resident.has(entry.id) ? 1150 : 900) + Math.min(cameraRadius, 600));
  }).sort((a, b) => Number(b.id === desired) - Number(a.id === desired)
    || distanceToWorld(a, x, z) - distanceToWorld(b, x, z)).slice(0, MAX_RESIDENT_WORLDS);
}
