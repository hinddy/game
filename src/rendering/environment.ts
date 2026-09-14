import * as THREE from "three";
import type { EnvironmentProfile } from "./profile";
export type { EnvironmentProfile } from "./profile";
export function createEnvironment(
  canvas: HTMLCanvasElement,
  lightSpeed: boolean,
  pixelRatioLimit: number,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lightSpeed,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(
    lightSpeed ? 1 : Math.min(window.devicePixelRatio, pixelRatioLimit),
  );
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !lightSpeed;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  scene.background = new THREE.Color(0x07101c);
  scene.fog = new THREE.FogExp2(0x07101c, lightSpeed ? 0.009 : 0.0065);

  const camera = new THREE.PerspectiveCamera(
    56,
    window.innerWidth / window.innerHeight,
    0.08,
    620,
  );
  camera.position.set(0, 5, -9);

  const hemisphere = new THREE.HemisphereLight(0x9cc8ff, 0x151c14, 1.65);
  const keyLight = new THREE.DirectionalLight(0xffe0bb, 3.2);
  keyLight.position.set(-34, 58, -24);
  keyLight.castShadow = !lightSpeed;
  keyLight.shadow.mapSize.set(lightSpeed ? 512 : 1024, lightSpeed ? 512 : 1024);
  keyLight.shadow.camera.left = -16;
  keyLight.shadow.camera.right = 16;
  keyLight.shadow.camera.top = 16;
  keyLight.shadow.camera.bottom = -16;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 170;
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.bias = -0.00015;
  scene.add(hemisphere, keyLight, keyLight.target);

  function buildHorizon(count: number): THREE.Object3D {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0b1f36,
      roughness: 0.95,
    });
    const buildings = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const radius = 160 + (index % 7) * 4;
      const width = 5 + (index % 4) * 2.2;
      const height = 8 + ((index * 13) % 34);
      const depth = 4 + (index % 5) * 1.7;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        height / 2 - 1,
        Math.sin(angle) * radius,
      );
      matrix.compose(
        position,
        rotation,
        new THREE.Vector3(width, height, depth),
      );
      buildings.setMatrixAt(index, matrix);
    }
    buildings.instanceMatrix.needsUpdate = true;
    group.add(buildings);
    return group;
  }

  let cityHorizon: THREE.Object3D | null = null;
  let horizonVisible = true;
  let horizonTimer = 0;
  function streamHorizonAfterFirstPaint(): void {
    horizonTimer = window.setTimeout(
      () => {
        cityHorizon = buildHorizon(lightSpeed ? 24 : 56);
        cityHorizon.visible = horizonVisible;
        scene.add(cityHorizon);
      },
      lightSpeed ? 900 : 420,
    );
  }

  const shadowOffset = new THREE.Vector3(-24, 38, -18);
  function apply(profile: EnvironmentProfile): void {
    horizonVisible = profile.cityHorizon;
    if (cityHorizon) cityHorizon.visible = horizonVisible;
    scene.background = new THREE.Color(profile.background);
    scene.fog = new THREE.FogExp2(
      profile.background,
      lightSpeed ? profile.lowFogDensity : profile.fogDensity,
    );
    hemisphere.color.setHex(profile.skyColor);
    hemisphere.groundColor.setHex(profile.groundColor);
    hemisphere.intensity = profile.ambientIntensity;
    keyLight.color.setHex(profile.sunColor);
    keyLight.intensity = profile.sunIntensity;
    shadowOffset.set(...profile.sunOffset);
    renderer.toneMappingExposure = profile.exposure;
    camera.near = profile.near;
    camera.far = profile.far;
    camera.updateProjectionMatrix();
  }
  return {
    renderer,
    scene,
    camera,
    shadowOffset,
    keyLight,
    apply,
    streamHorizonAfterFirstPaint,
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(
        lightSpeed ? 1 : Math.min(window.devicePixelRatio, pixelRatioLimit),
      );
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    },
    dispose() {
      clearTimeout(horizonTimer);
      if (cityHorizon) {
        cityHorizon.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              m.dispose();
          }
        });
        scene.remove(cityHorizon);
      }
      keyLight.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
