import * as THREE from "three";
import type { TrackSample } from "./track";

/** A cross-section swept along authoritative track samples, shared by render and collision. */
export function trackRibbon(
  samples: TrackSample[], indexes: number[], profile: Array<[number, number]>,
): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const point = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const rows = [...indexes, (indexes[indexes.length - 1] + 1) % samples.length];
  for (const index of rows) {
    const sample = samples[index];
    right.set(1, 0, 0).applyQuaternion(sample.rotation);
    up.set(0, 1, 0).applyQuaternion(sample.rotation);
    for (const [offset, height] of profile) {
      // Offset is measured from the road edge; sign selects the side.
      const lateral = Math.sign(offset) * sample.width / 2 + offset;
      point.copy(sample.position).addScaledVector(right, lateral).addScaledVector(up, height);
      positions.push(point.x, point.y, point.z);
    }
  }
  const width = profile.length;
  for (let row = 0; row < indexes.length; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col, b = a + width;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export const roadProfile: Array<[number, number]> = [[-0.001, 0], [0.001, 0]];
export const shoulderProfile: Array<[number, number]> = [[-1.7, -0.17], [1.7, -0.17]];
export function barrierProfile(side: number, height: number): Array<[number, number]> {
  const outer = side * 1.36, inner = side * 1.14;
  // Continuous top and both walls; winding faces the playable road on either side.
  return side < 0
    ? [[outer, 0], [outer, height], [inner, height], [inner, 0]]
    : [[inner, 0], [inner, height], [outer, height], [outer, 0]];
}
