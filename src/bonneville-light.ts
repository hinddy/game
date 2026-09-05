import * as THREE from "three";

// One shared direction keeps the sky's sun and the physical shadows aligned.
export const BONNEVILLE_SUN_ELEVATION_DEG = 18;
const elevation = THREE.MathUtils.degToRad(BONNEVILLE_SUN_ELEVATION_DEG);
const azimuth = THREE.MathUtils.degToRad(-38);
export const BONNEVILLE_SUN_DIRECTION = new THREE.Vector3(
  Math.sin(azimuth) * Math.cos(elevation),
  Math.sin(elevation),
  Math.cos(azimuth) * Math.cos(elevation),
);
