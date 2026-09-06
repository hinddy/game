import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import type { TrackSpec } from "./config";
import { BONNEVILLE_SUN_DIRECTION } from "./bonneville-light";
import type { TrackRuntime, TrackSample, Checkpoint } from "./track";
import type { ThemeBridge } from "./design/theme";
import type { WorldStreamer } from "./worlds/streamer";

// Gameplay stays near the origin; distant scenery is visual only.
export const SALT_PLAYABLE_HALF_SIZE = 12000;
const SALT_VISUAL_SIZE = 120000;
const SALT_TILE_SIZE = 9;
const SALT_DETAIL_SIZE = 288;

/** Four coplanar quads around the detail patch: no overlapping ground/depth fight. */
function saltHorizonGeometry(): THREE.BufferGeometry {
  const inner = SALT_DETAIL_SIZE / 2, outer = SALT_VISUAL_SIZE / 2;
  const positions: number[] = [], indices: number[] = [];
  for (const [x0, y0, x1, y1] of [
    [-outer, inner, outer, outer], [-outer, -outer, outer, -inner],
    [-outer, -inner, -inner, inner], [inner, -inner, outer, inner],
  ]) {
    const base = positions.length / 3;
    positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Band-limited salt detail: no independent one-texel noise to sparkle in motion. */
function saltTexture(): { texture: THREE.CanvasTexture; average: THREE.Color } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(512, 512);
  const cells = 7;
  const sum = [0, 0, 0];
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
    const crack = 1 - THREE.MathUtils.smoothstep(second - first, 0.012, 0.085);
    // Smooth, periodic grain survives minification without random bright pixels.
    const grain = Math.sin(x * Math.PI / 16) * Math.sin(y * Math.PI / 16);
    const value = 236 - crack * 16 + grain * 0.8;
    const index = (y * 512 + x) * 4;
    data.data[index] = value;
    data.data[index + 1] = value - 2;
    data.data[index + 2] = value - 7;
    data.data[index + 3] = 255;
    for (let channel = 0; channel < 3; channel++) sum[channel] += data.data[index + channel];
  }
  context.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(SALT_DETAIL_SIZE / SALT_TILE_SIZE, SALT_DETAIL_SIZE / SALT_TILE_SIZE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const average = new THREE.Color().setRGB(
    sum[0] / (512 * 512 * 255), sum[1] / (512 * 512 * 255), sum[2] / (512 * 512 * 255), THREE.SRGBColorSpace);
  return { texture, average };
}

export class BonnevilleRuntime implements Pick<TrackRuntime,
  "spec" | "group" | "samples" | "spawn" | "checkpoints" | "streamState" | "stream" | "nearestSample" | "dispose"> {
  readonly group = new THREE.Group();
  readonly samples: TrackSample[];
  readonly spawn: TrackSample;
  readonly checkpoints: Checkpoint[];
  get streamState() { return this.streamer?.state ?? { ready: 0, total: 1 }; }
  private readonly texture: THREE.CanvasTexture;
  private readonly saltSurface = new THREE.Group();
  streamer: WorldStreamer | null = null;
  private disposed = false;
  private viewRadius = 8;

  constructor(readonly spec: TrackSpec, world: RAPIER.World, scene: THREE.Scene, shadows: boolean, zone?: "material" | "shadcn", maxAnisotropy = 1) {
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
    // Start inside the 1 km central strip; preserve the original course geometry.
    this.spawn = { ...this.samples[0], position: new THREE.Vector3(0, 0, -650), tangent: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0), rotation: new THREE.Quaternion() };
    if (zone) {
      const side = zone === "material" ? -1 : 1;
      this.spawn.position.set(side * 680, 0, 150);
      this.spawn.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * Math.PI / 2);
      this.spawn.tangent.set(side, 0, 0); this.spawn.right.set(0, 0, -side);
    }
    this.checkpoints = [0, 0.25, 0.5, 0.75].map(ratio => {
      const sampleIndex = Math.floor(ratio * this.samples.length);
      const sample = this.samples[sampleIndex];
      return { sampleIndex, position: sample.position.clone(), forward: sample.tangent.clone(), width: sample.width };
    });
    world.createCollider(RAPIER.ColliderDesc.cuboid(SALT_PLAYABLE_HALF_SIZE + 100, 0.5, SALT_PLAYABLE_HALF_SIZE + 100)
      .setTranslation(0, -0.5, 0).setFriction(spec.surfaceGrip).setRestitution(0.01));
    const salt = saltTexture();
    this.texture = salt.texture;
    // Bound the sample cost and respect devices without anisotropic filtering.
    this.texture.anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
    const material = new THREE.MeshStandardMaterial({
      color: 0xeeebe3, map: this.texture,
      roughness: 0.97, metalness: 0,
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.uSaltAverage = { value: salt.average };
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec2 vSaltLocal;').replace('#include <uv_vertex>',
        '#include <uv_vertex>\nvSaltLocal = position.xy;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform vec3 uSaltAverage;\nvarying vec2 vSaltLocal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        // Fade unresolved detail by its actual pixel footprint, not camera distance.
        // Keep UVs unwrapped: fract() would introduce false derivatives at tile seams.
        vec2 saltDx = dFdx(vMapUv) * 512.0;
        vec2 saltDy = dFdy(vMapUv) * 512.0;
        float saltFootprint = max(length(saltDx), length(saltDy));
        float saltEdge = max(abs(vSaltLocal.x), abs(vSaltLocal.y));
        float saltDetail = (1.0 - smoothstep(4.0, 24.0, saltFootprint))
          * (1.0 - smoothstep(72.0, 126.0, saltEdge));
        vec4 saltSample = texture2D(map, vMapUv);
        diffuseColor *= vec4(mix(uSaltAverage, saltSample.rgb, saltDetail), saltSample.a);
      `);
    };
    material.customProgramCacheKey = () => 'salt-local-detail-v2';
    // Large triangles + UVs around 6,666 lost sub-texel precision near the car.
    // Keep detailed vertices/UVs local; the distant ring needs no texture at all.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SALT_DETAIL_SIZE, SALT_DETAIL_SIZE), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ground.name = "dry-salt";
    const horizon = new THREE.Mesh(saltHorizonGeometry(), new THREE.MeshStandardMaterial({
      color: material.color.clone().multiply(salt.average), roughness: material.roughness, metalness: 0,
    }));
    horizon.rotation.x = ground.rotation.x;
    horizon.receiveShadow = shadows;
    horizon.name = 'dry-salt-horizon';
    this.saltSurface.add(ground, horizon);
    this.group.add(this.saltSurface);
    this.positionSalt(this.spawn.position);
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
    scene.add(this.group);
  }

  async attachWorlds(world: RAPIER.World, scene: THREE.Scene, theme: ThemeBridge, renderer: THREE.WebGLRenderer, camera: THREE.Camera, shadows: boolean): Promise<void> {
    const { WorldStreamer } = await import("./worlds/streamer");
    if (this.disposed) return;
    this.streamer = new WorldStreamer({ world, scene, theme, shadows, course: () => this.buildCourse(),
      prepare: group => renderer.compileAsync(group, camera, scene) });
  }
  setViewRadius(radius: number): void { this.viewRadius = radius; }

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

  private buildCourse(): THREE.Group {
    const group = new THREE.Group(); group.name = "world:salt-course";
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
    group.add(cones);
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
    group.add(poles, flags);
    return group;
  }

  private positionSalt(focus: THREE.Vector3): void {
    // Whole texture periods preserve the world-anchored pattern across recentering.
    this.saltSurface.position.set(Math.round(focus.x / SALT_TILE_SIZE) * SALT_TILE_SIZE,
      0, Math.round(focus.z / SALT_TILE_SIZE) * SALT_TILE_SIZE);
  }
  stream(now: number, focus: THREE.Vector3, _direction: THREE.Vector3): void {
    this.positionSalt(focus);
    this.streamer?.tick(now, focus, this.viewRadius);
  }
  nearestSample(position: THREE.Vector3): { index: number; sample: TrackSample; distance: number } {
    let nearest = 0, distanceSq = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].position.distanceToSquared(position);
      if (d < distanceSq) { distanceSq = d; nearest = i; }
    }
    return { index: nearest, sample: this.samples[nearest], distance: Math.sqrt(distanceSq) };
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.streamer?.dispose(); this.streamer = null;
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



