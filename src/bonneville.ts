import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import type { TrackSpec } from "./config";
import { BONNEVILLE_SUN_DIRECTION } from "./bonneville-light";
import type { TrackRuntime, TrackSample, Checkpoint } from "./track";

// Gameplay stays near the origin; distant scenery is visual only.
export const SALT_PLAYABLE_HALF_SIZE = 12000;
const SALT_VISUAL_SIZE = 120000;

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Small tileable cellular texture generated once; hardware mipmaps remove distant noise. */
function saltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(512, 512);
  const cells = 7;
  const wrap = (n: number) => (n % cells + cells) % cells;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const u = x / 512 * cells, v = y / 512 * cells;
    const cx = Math.floor(u), cy = Math.floor(v);
    let first = 100, second = 100;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const px = gx + 0.2 + hash(wrap(gx), wrap(gy)) * 0.6;
      const py = gy + 0.2 + hash(wrap(gx) + 19, wrap(gy) + 31) * 0.6;
      const d = (px - u) ** 2 + (py - v) ** 2;
      if (d < first) { second = first; first = d; } else if (d < second) second = d;
    }
    const crack = 1 - THREE.MathUtils.smoothstep(second - first, 0.005, 0.045);
    const value = 239 - crack * 23 - hash(x, y) * 6;
    const index = (y * 512 + x) * 4;
    data.data[index] = value;
    data.data[index + 1] = value - 2;
    data.data[index + 2] = value - 7;
    data.data[index + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(SALT_VISUAL_SIZE / 9, SALT_VISUAL_SIZE / 9);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class BonnevilleRuntime implements Pick<TrackRuntime,
  "spec" | "group" | "samples" | "spawn" | "checkpoints" | "streamState" | "stream" | "nearestSample" | "dispose"> {
  readonly group = new THREE.Group();
  readonly samples: TrackSample[];
  readonly spawn: TrackSample;
  readonly checkpoints: Checkpoint[];
  readonly streamState = { ready: 1, total: 1 };
  private readonly texture: THREE.CanvasTexture;

  constructor(readonly spec: TrackSpec, world: RAPIER.World, scene: THREE.Scene, shadows: boolean) {
    this.group.name = "track:bonneville";
    const curve = new THREE.CatmullRomCurve3(
      spec.points.map(p => new THREE.Vector3(p.x, p.y, p.z)), true, "centripetal");
    this.samples = Array.from({ length: spec.sampleCount }, (_, i) => {
      const u = i / spec.sampleCount;
      const tangent = curve.getTangentAt(u).normalize();
      const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
      return { position: curve.getPointAt(u), tangent, right, width: spec.defaultWidth,
        rotation: new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), tangent)) };
    });
    this.spawn = this.samples[2];
    this.checkpoints = [0, 0.25, 0.5, 0.75].map(ratio => {
      const sampleIndex = Math.floor(ratio * this.samples.length);
      const sample = this.samples[sampleIndex];
      return { sampleIndex, position: sample.position.clone(), forward: sample.tangent.clone(), width: sample.width };
    });
    world.createCollider(RAPIER.ColliderDesc.cuboid(SALT_PLAYABLE_HALF_SIZE + 100, 0.5, SALT_PLAYABLE_HALF_SIZE + 100)
      .setTranslation(0, -0.5, 0).setFriction(spec.surfaceGrip).setRestitution(0.01));
    this.texture = saltTexture();
    const material = new THREE.MeshStandardMaterial({
      color: 0xeeebe3, map: this.texture,
      roughness: 0.97, metalness: 0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SALT_VISUAL_SIZE, SALT_VISUAL_SIZE), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ground.name = "dry-salt";
    this.group.add(ground);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { uSunDirection: { value: BONNEVILLE_SUN_DIRECTION } },
        vertexShader: `varying vec3 vDirection;
          void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vDirection;
          uniform vec3 uSunDirection;
          void main() {
            vec3 direction = normalize(vDirection);
            float height = max(direction.y, 0.0);
            float towardSun = max(dot(direction, uSunDirection), 0.0);
            vec3 horizon = mix(vec3(0.46, 0.51, 0.59), vec3(0.77, 0.57, 0.40), pow(towardSun, 5.0));
            vec3 color = mix(horizon, vec3(0.13, 0.29, 0.48), pow(height, 0.48));
            float glow = pow(towardSun, 100.0);
            // Derivative AA keeps the small solar disc stable without bloom.
            float edge = max(fwidth(towardSun), 0.000001);
            float disc = smoothstep(0.999989 - edge, 0.999989 + edge, towardSun);
            color += vec3(0.75, 0.36, 0.12) * glow * 0.22;
            color = mix(color, vec3(5.0, 3.5, 1.9), disc);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,      }));
    sky.name = "bonneville-sky";
    sky.renderOrder = -1000;
    sky.raycast = () => {};
    this.group.add(sky);
    this.buildMountains();
    this.buildCourse();
    scene.add(this.group);
  }

  private buildMountains(): void {
    // Two irregular, low silhouettes. No terrain streaming or distant collision.
    for (let layer = 0; layer < 2; layer++) {
      const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
      const count = 192, radius = 28000 + layer * 11000;
      for (let i = 0; i <= count; i++) {
        const a = i / count * Math.PI * 2;
        const envelope = 0.25 + 0.75 * Math.pow(Math.sin(a * 3 + layer) * 0.5 + 0.5, 2);
        const height = (550 + hash(i % count, layer + 51) * 1150) * envelope;
        const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
        vertices.push(x, -60, z, x, height, z);
        const shade = 0.76 + hash(i % count, layer + 4) * 0.12;
        const color = new THREE.Color(layer ? 0xb5a3a0 : 0x858492).multiplyScalar(shade);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        if (i < count) { const k = i * 2; indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mountains = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      mountains.name = "distant-mountains";
      this.group.add(mountains);
    }
  }

  private buildCourse(): void {
    const indexes = this.samples.filter((_, i) => i % 4 === 0);
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: 0xf46c17, roughness: 0.8 }), indexes.length * 2);
    const matrix = new THREE.Matrix4();
    indexes.forEach((sample, i) => {
      for (const [sideIndex, side] of [-1, 1].entries()) {
        const position = sample.position.clone().addScaledVector(sample.right, side * sample.width / 2);
        position.y = 0.55;
        matrix.compose(position, sample.rotation, new THREE.Vector3(1, 1, 1));
        cones.setMatrixAt(i * 2 + sideIndex, matrix);
      }
    });
    this.group.add(cones);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0x21344a, roughness: 0.8 }), 8);
    const flags = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.85, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xff790d, roughness: 0.8 }), 8);
    this.checkpoints.forEach((checkpoint, i) => {
      const sample = this.samples[checkpoint.sampleIndex];
      for (const [j, side] of [-1, 1].entries()) {
        const p = sample.position.clone().addScaledVector(sample.right, side * sample.width / 2);
        p.y = 2;
        matrix.compose(p, sample.rotation, new THREE.Vector3(1, 1, 1));
        poles.setMatrixAt(i * 2 + j, matrix);
        p.y = 3.4;
        p.addScaledVector(sample.right, -side * 0.8);
        matrix.compose(p, sample.rotation, new THREE.Vector3(1, 1, 1));
        flags.setMatrixAt(i * 2 + j, matrix);
      }
    });
    this.group.add(poles, flags);
  }

  stream(_now: number, _focus: THREE.Vector3, _direction: THREE.Vector3): void {}
  nearestSample(position: THREE.Vector3): { index: number; sample: TrackSample; distance: number } {
    let nearest = 0, distanceSq = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].position.distanceToSquared(position);
      if (d < distanceSq) { distanceSq = d; nearest = i; }
    }
    return { index: nearest, sample: this.samples[nearest], distance: Math.sqrt(distanceSq) };
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.texture.dispose();
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose();
      }
    });
  }
}



