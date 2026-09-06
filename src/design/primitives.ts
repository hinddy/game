import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import { ThemeBridge, type MaterialRole } from "./theme";
import type { UIElement, UIState, WorldBundle } from "../worlds/types";

export function roundedPanelGeometry(radius: number): THREE.BufferGeometry {
  const r = THREE.MathUtils.clamp(radius, .001, .24), s = new THREE.Shape();
  s.moveTo(-.5 + r, -.5); s.lineTo(.5 - r, -.5); s.quadraticCurveTo(.5, -.5, .5, -.5 + r);
  s.lineTo(.5, .5 - r); s.quadraticCurveTo(.5, .5, .5 - r, .5);
  s.lineTo(-.5 + r, .5); s.quadraticCurveTo(-.5, .5, -.5, .5 - r);
  s.lineTo(-.5, -.5 + r); s.quadraticCurveTo(-.5, -.5, -.5 + r, -.5);
  const geometry = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 4, steps: 1 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -.5, 0);
  return geometry;
}

function wedgeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    -.5,0,-.5, .5,0,-.5, -.5,1,-.5, .5,1,-.5, -.5,0,.5, .5,0,.5,
  ], 3));
  g.setIndex([0,2,1,1,2,3, 2,4,3,3,4,5, 0,4,2, 1,3,5, 0,1,4,1,5,4]);
  g.computeVertexNormals(); return g.toNonIndexed();
}
type Piece = { owner: number; x: number; y: number; z: number; w: number; h: number; d: number };
type Batch = { mesh: THREE.InstancedMesh; pieces: Piece[]; states: THREE.InstancedBufferAttribute; reveals: THREE.InstancedBufferAttribute; rounded: boolean };
type Component = { spec: UIElement; colliders: { collider: RAPIER.Collider; y: number; size?: [number, number, number] }[]; selected: boolean; state: UIState; depression: number; maxDepression: number; occupied: boolean; pulse: number };
const states: Record<UIState, number> = { idle: 0, hover: 1, pressed: 2, selected: 3, disabled: 4 };

/** Reusable Button/Card/Panel/Terminal/Portal factory with batched draws and matching collision. */
export class UIWorld {
  readonly group = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly components: Component[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private readonly labelRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly labels: THREE.InstancedMesh;
  private readonly labelMaterial: THREE.ShaderMaterial;
  private readonly atlas: THREE.CanvasTexture;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly atlasContext: CanvasRenderingContext2D;
  private readonly stopTheme: () => void;
  private built = 0;
  private radius: number;
  private hullPoints: number[] = [];
  private reveal = 0;
  private enabled = false;
  private disposed = false;
  private pointer: number | null = null;
  private pointerDown = false;
  constructor(private readonly bundle: WorldBundle, private readonly world: RAPIER.World,
    private readonly theme: ThemeBridge, shadows: boolean) {
    this.group.name = "world:" + bundle.id;
    this.radius = theme.tokens.radius;
    const capacity = Math.max(1, bundle.elements.length * 8);
    const rounded = roundedPanelGeometry(this.radius), wedge = wedgeGeometry();
    this.readHull(rounded);
    for (const role of ["surface", "accent", "border", "text", "ramp"] as const) {
      const geometry = (role === "ramp" ? wedge : rounded).clone();
      const state = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      const reveal = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      state.setUsage(THREE.DynamicDrawUsage); reveal.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("uiState", state); geometry.setAttribute("uiReveal", reveal);
      const mesh = new THREE.InstancedMesh(geometry, theme.materials[role === "ramp" ? "border" : role], capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.batches.push({ mesh, pieces: [], states: state, reveals: reveal, rounded: role !== "ramp" });
      this.group.add(mesh);
    }
    rounded.dispose(); wedge.dispose();
    this.atlasCanvas = document.createElement("canvas"); this.atlasCanvas.width = this.atlasCanvas.height = 512;
    const ctx = this.atlasContext = this.atlasCanvas.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas); this.atlas.generateMipmaps = true;
    const labelGeometry = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(capacity * 2);
    for (let i = 0; i < capacity; i++) { cells[i * 2] = (i % 2) / 2; cells[i * 2 + 1] = 1 - (Math.floor(i / 2) + 1) / 16; }
    labelGeometry.setAttribute("atlasCell", new THREE.InstancedBufferAttribute(cells, 2));
    labelGeometry.setAttribute("labelAccent", new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: capacity }, (_, i) => Number(bundle.elements[i]?.role === "accent"))), 1));
    this.labelMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { ...theme.uniforms, uAtlas: { value: this.atlas }, uReveal: { value: 0 } },
      vertexShader: `attribute vec2 atlasCell; attribute float labelAccent; varying float vAccent; varying vec2 vUv; void main() {
        vAccent = labelAccent;
        vUv = atlasCell + uv * vec2(.5,.0625);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uAtlas; uniform vec3 uText; uniform vec3 uSurface; uniform float uReveal; varying vec2 vUv; varying float vAccent;
        void main() { float a = texture2D(uAtlas,vUv).a * uReveal; if(a < .02) discard;
        gl_FragColor = vec4(mix(uText,uSurface,vAccent),a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.labels = new THREE.InstancedMesh(labelGeometry, this.labelMaterial, capacity);
    this.labels.count = 0; this.labels.frustumCulled = false; this.labels.raycast = () => {};
    this.group.add(this.labels);
    this.stopTheme = theme.subscribe(() => this.refreshRadius());
  }
  private refreshRadius(): void {
    if (this.radius === this.theme.tokens.radius) return;
    this.radius = this.theme.tokens.radius;
    const template = roundedPanelGeometry(this.radius);
    this.readHull(template);
    for (const batch of this.batches) if (batch.rounded) {
      const geometry = template.clone(); geometry.setAttribute("uiState", batch.states); geometry.setAttribute("uiReveal", batch.reveals);
      batch.mesh.geometry.dispose(); batch.mesh.geometry = geometry;
    }
    template.dispose();
    for (const component of this.components) for (const entry of component.colliders) if (entry.size) {
      entry.collider.setShape(new RAPIER.ConvexPolyhedron(this.scaledHull(...entry.size)));
    }
  }
  private readHull(geometry: THREE.BufferGeometry): void {
    const positions = geometry.getAttribute("position"), seen = new Set<string>();
    this.hullPoints = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), key = `${x},${y},${z}`;
      if (!seen.has(key)) { seen.add(key); this.hullPoints.push(x, y, z); }
    }
  }
  private scaledHull(w: number, h: number, d: number): Float32Array {
    return new Float32Array(this.hullPoints.map((v, i) => v * (i % 3 === 0 ? w : i % 3 === 1 ? h : d)));
  }
  /** At most two components (and 2 ms) per frame. No timers survive disposal. */
  buildStep(): boolean {
    const started = performance.now();
    for (let count = 0; count < 2 && this.built < this.bundle.elements.length; count++) {
      this.add(this.bundle.elements[this.built++]);
      if (performance.now() - started > 2) break;
    }
    return this.built === this.bundle.elements.length;
  }
  private add(spec: UIElement): void {
    const owner = this.components.length;
    if (owner < 32) {
      const label = spec.label ?? "", ctx = this.atlasContext;
      let size = 26; ctx.font = `700 ${size}px system-ui`;
      while (size > 8 && ctx.measureText(label).width > 244) ctx.font = `700 ${--size}px system-ui`;
      ctx.fillText(label, (owner % 2) * 256 + 128, Math.floor(owner / 2) * 32 + 16);
    }
    const support = this.bundle.elements.reduce((h, below) => below !== spec && below.h < spec.h && below.w >= spec.w && below.d >= spec.d
      && Math.abs(spec.x - below.x) < below.w / 2 && Math.abs(spec.z - below.z) < below.d / 2 ? Math.max(h, below.h) : h, 0);
    const component: Component = { spec, colliders: [], selected: spec.state === "selected", state: spec.state ?? "idle", depression: 0,
      maxDepression: Math.min(.16, spec.h * .18, (spec.h - support) * .45), occupied: false, pulse: 0 };
    this.components.push(component);
    const piece = (role: MaterialRole | "ramp", x: number, y: number, z: number, w: number, h: number, d: number, collider = false) => {
      const batch = this.batches[({ surface: 0, accent: 1, border: 2, text: 3, ramp: 4 })[role]];
      const p = { owner, x, y, z, w, h, d };
      const i = batch.pieces.push(p) - 1; batch.mesh.count = batch.pieces.length;
      this.writePiece(batch, i, p, 0);
      if (collider) {
        const desc = RAPIER.ColliderDesc.convexHull(this.scaledHull(w, h, d))!.setTranslation(x, y, z).setFriction(.95);
        const c = this.world.createCollider(desc); c.setEnabled(false); component.colliders.push({ collider: c, y, size: [w, h, d] });
      }
    };
    piece("border", spec.x, spec.h / 2, spec.z, spec.w, spec.h, spec.d, true);
    piece(spec.role ?? "surface", spec.x, spec.h / 2 + .035, spec.z, Math.max(1, spec.w - .5), spec.h, Math.max(1, spec.d - .5));
    if (spec.ramp) {
      const w = Math.min(12, spec.w * .55), d = Math.max(7, spec.h * 9), z = spec.z + spec.d / 2 + d / 2 - .12;
      piece("ramp", spec.x, 0, z, w, spec.h + .04, d);
      const vertices = new Float32Array([-w/2,0,-d/2, w/2,0,-d/2, -w/2,spec.h+.04,-d/2, w/2,spec.h+.04,-d/2, -w/2,0,d/2, w/2,0,d/2]);
      const desc = RAPIER.ColliderDesc.convexHull(vertices)!;
      desc.setTranslation(spec.x, 0, z).setFriction(.95);
      const c = this.world.createCollider(desc); c.setEnabled(false); component.colliders.push({ collider: c, y: 0 });
    }
    if (spec.kind === "Portal") {
      for (const side of [-1, 1]) piece("accent", spec.x + side * (spec.w / 2 - 1), 4, spec.z, 1.5, 8, 2, true);
      piece("accent", spec.x, 8, spec.z, spec.w, 1, 2, true);
    }
    if (spec.kind === "Terminal") for (let i = 0; i < 3; i++) {
      piece(i === 0 ? "accent" : "border", spec.x - spec.w * .15, spec.h + .07, spec.z + spec.d * (.08 + i * .15), spec.w * (.6 - i * .12), .05, 1.2);
    }
    this.labels.count = Math.min(32, this.components.length); this.writeLabel(owner);
  }
  private writePiece(batch: Batch, index: number, p: Piece, depression: number): void {
    this.matrix.compose(this.point.set(p.x, p.y - depression, p.z), this.identity, this.scale.set(p.w, p.h, p.d));
    batch.mesh.setMatrixAt(index, this.matrix); batch.mesh.instanceMatrix.needsUpdate = true;
  }
  private writeLabel(index: number): void {
    if (index >= 32) return;
    const c = this.components[index], e = c.spec;
    const z = e.kind === "Button" || e.kind === "Portal" || e.d <= 30 ? e.z : e.z - e.d / 2 + Math.min(12, e.d * .3);
    this.matrix.compose(this.point.set(e.x, e.h + .09 - c.depression, z), this.labelRotation,
      this.scale.set(e.w * .88, Math.min(e.d * .65, e.w * .88 / 8), 1));
    this.labels.setMatrixAt(index, this.matrix); this.labels.instanceMatrix.needsUpdate = true;
  }
  activate(): void { this.enabled = true; for (const c of this.components) for (const entry of c.colliders) entry.collider.setEnabled(true); }
  safeToActivate(car: THREE.Vector3): boolean {
    // A late 3G response must never materialise a collider around the moving car.
    return this.components.every(c => Math.abs(car.x - c.spec.x) > c.spec.w / 2 + 15 || Math.abs(car.z - c.spec.z) > c.spec.d / 2 + c.spec.h * 9 + 15);
  }
  update(dt: number, car: THREE.Vector3): void {
    if (!this.enabled || this.disposed) return;
    this.reveal = Math.min(1, this.reveal + dt * 2);
    this.labelMaterial.uniforms.uReveal.value = this.reveal;
    for (let i = 0; i < this.components.length; i++) {
      const c = this.components[i], e = c.spec;
      const near = Math.abs(car.x - e.x) < e.w / 2 + 3 && Math.abs(car.z - e.z) < e.d / 2 + 3;
      const occupied = Math.abs(car.x - e.x) < e.w / 2 && Math.abs(car.z - e.z) < e.d / 2 && car.y > e.h - .6 && car.y < e.h + 2;
      c.pulse = Math.max(0, c.pulse - dt);
      const interactive = e.kind === "Button" || e.kind === "Portal" || e.kind === "Terminal";
      if (interactive && occupied && !c.occupied && e.state !== "disabled") c.selected = !c.selected;
      c.occupied = occupied;
      const pressed = interactive && (occupied || c.pulse > 0 || (this.pointer === i && this.pointerDown));
      c.state = e.state === "disabled" ? "disabled" : pressed ? "pressed" : this.pointer === i || near ? "hover" : c.selected ? "selected" : "idle";
      const depression = THREE.MathUtils.damp(c.depression, c.state === "pressed" ? c.maxDepression : 0, 16, dt);
      if (Math.abs(depression - c.depression) > .0001) {
        c.depression = depression;
        for (const batch of this.batches) batch.pieces.forEach((p, index) => { if (p.owner === i) this.writePiece(batch, index, p, depression); });
        for (const entry of c.colliders) { const p = entry.collider.translation(); entry.collider.setTranslation({ x: p.x, y: entry.y - depression, z: p.z }); }
        this.writeLabel(i);
      }
    }
    for (const batch of this.batches) {
      for (let i = 0; i < batch.pieces.length; i++) { batch.states.setX(i, states[this.components[batch.pieces[i].owner].state]); batch.reveals.setX(i, this.reveal); }
      batch.states.needsUpdate = true; batch.reveals.needsUpdate = true;
    }
  }
  pick(ray: THREE.Raycaster): { distance: number; index: number } | null {
    if (!this.enabled) return null;
    this.group.updateMatrixWorld(true);
    const hits = ray.intersectObjects(this.batches.map(b => b.mesh), false);
    const hit = hits[0]; if (!hit || hit.instanceId === undefined) return null;
    const batch = this.batches.find(b => b.mesh === hit.object)!;
    return { distance: hit.distance, index: batch.pieces[hit.instanceId].owner };
  }
  setPointer(index: number | null, down: boolean, click = false): void {
    this.pointer = index; this.pointerDown = down;
    if (click && index !== null) { const c = this.components[index]; if (c.spec.state !== "disabled") { c.selected = !c.selected; c.pulse = .22; } }
  }
  snapshot() { return { id: this.bundle.id, built: this.built, enabled: this.enabled, colliders: this.components.reduce((sum, c) => sum + c.colliders.length, 0),
    states: this.components.map(c => ({ id: c.spec.id, state: c.state, depression: c.depression })) }; }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.stopTheme(); this.group.removeFromParent();
    for (const c of this.components) for (const entry of c.colliders) this.world.removeCollider(entry.collider, true);
    for (const batch of this.batches) { batch.mesh.dispose(); batch.mesh.geometry.dispose(); batch.pieces.length = 0; }
    this.labels.dispose(); this.labels.geometry.dispose(); this.labelMaterial.dispose(); this.atlas.dispose();
    this.atlasCanvas.width = this.atlasCanvas.height = 1;
    this.components.length = 0; this.batches.length = 0; this.hullPoints.length = 0; this.bundle.elements.length = 0; this.group.clear();
  }
}
