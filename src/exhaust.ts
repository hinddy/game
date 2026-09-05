import * as THREE from "three";

export const EXHAUST_OUTLET = new THREE.Vector3(0.43, 0.3, -1.055);

/** Fixed particle pool: one draw, no textures, allocations or lights per puff. */
export class ExhaustEffect {
  private readonly count = 64;
  private readonly positions = new Float32Array(this.count * 3);
  private readonly alpha = new Float32Array(this.count);
  private readonly sizes = new Float32Array(this.count);
  private readonly life = new Float32Array(this.count);
  private readonly velocity = new Float32Array(this.count * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private readonly flame: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private elapsed = 0;
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private cursor = 0;
  private spawnAccumulator = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uBoost: { value: 0 } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vAlpha = aAlpha;
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(0.2, -p.z), 1.0, 90.0);
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: `
        varying float vAlpha;
        uniform float uBoost;
        void main() {
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          float soft = 1.0 - smoothstep(0.2, 1.0, radius);
          if (soft * vAlpha < 0.008) discard;
          vec3 color = mix(vec3(0.35, 0.38, 0.41), vec3(0.52, 0.57, 0.62), uBoost);
          gl_FragColor = vec4(color, soft * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "buggy-exhaust";
    this.points.frustumCulled = false;
    const flameGeometry = new THREE.ConeGeometry(0.065, 0.32, 8);
    const colors: number[] = [];
    const vertices = flameGeometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const color = new THREE.Color(0x86ceff).lerp(new THREE.Color(0xff943d), (vertices.getY(i) + 0.16) / 0.32);
      colors.push(color.r, color.g, color.b);
    }
    flameGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.flame = new THREE.Mesh(flameGeometry, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false,
    }));
    this.flame.name = "turbo-exhaust-flame";
    this.flame.visible = false;
    scene.add(this.points, this.flame);
  }

  update(dt: number, vehicle: THREE.Object3D, throttle: number, boost: number, viewportHeight: number): void {
    vehicle.updateWorldMatrix(true, false);
    this.origin.copy(EXHAUST_OUTLET).applyMatrix4(vehicle.matrixWorld);
    this.direction.set(0, 0.12, -1).transformDirection(vehicle.matrixWorld);
    this.elapsed += dt;
    this.flame.visible = boost > 0.15;
    this.flame.position.copy(this.origin).addScaledVector(this.direction, 0.14);
    this.flame.quaternion.setFromUnitVectors(this.axis, this.direction);
    this.flame.scale.set(0.8 + boost * 0.2, 0.65 + boost * 0.4 + Math.sin(this.elapsed * 47) * 0.12, 1);
    this.material.uniforms.uScale.value = viewportHeight;
    this.material.uniforms.uBoost.value = boost;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.alpha[i] = Math.max(0, this.life[i]) * 0.38;
      this.sizes[i] += dt * 0.48;
      for (let axis = 0; axis < 3; axis++) this.positions[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
    }
    this.spawnAccumulator += dt * (5 + throttle * 11 + boost * 24);
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator--;
      const i = this.cursor++ % this.count;
      this.life[i] = 0.7 + Math.random() * 0.35;
      this.alpha[i] = this.life[i] * 0.38;
      this.sizes[i] = 0.12 + boost * 0.08;
      this.origin.toArray(this.positions, i * 3);
      this.velocity[i * 3] = this.direction.x * (0.8 + boost * 2) + (Math.random() - 0.5) * 0.14;
      this.velocity[i * 3 + 1] = 0.32 + Math.random() * 0.18;
      this.velocity[i * 3 + 2] = this.direction.z * (0.8 + boost * 2) + (Math.random() - 0.5) * 0.14;
    }
    for (const name of ["position", "aAlpha", "aSize"]) this.geometry.getAttribute(name).needsUpdate = true;
  }

  get activeParticles(): number { return this.life.reduce((n, v) => n + (v > 0 ? 1 : 0), 0); }
  clear(): void {
    this.flame.visible = false;
    this.life.fill(0); this.alpha.fill(0); this.spawnAccumulator = 0;
    this.geometry.getAttribute("aAlpha").needsUpdate = true;
  }
  dispose(): void {
    this.scene.remove(this.points, this.flame);
    this.flame.geometry.dispose(); this.flame.material.dispose();
    this.geometry.dispose(); this.material.dispose();
  }
}

