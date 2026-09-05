import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { VehicleSpec } from "./config";

type Point = [number, number, number];

/** Bake rigid parts by material; wheels remain independent for steering/suspension. */
function bake(group: THREE.Group): void {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.updateMatrixWorld(true);
  for (const object of [...group.children]) {
    if (!(object instanceof THREE.Mesh)) continue;
    object.updateMatrix();
    const geometry = object.geometry.clone().applyMatrix4(object.matrix);
    const list = buckets.get(object.material) ?? [];
    list.push(geometry);
    buckets.set(object.material, list);
    object.geometry.dispose();
    group.remove(object);
  }
  for (const [material, parts] of buckets) {
    const geometry = mergeGeometries(parts, false);
    if (!geometry) throw new Error("Incompatible vehicle geometry");
    for (const part of parts) part.dispose();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export function buildVehicleModel(spec: VehicleSpec): {
  body: THREE.Group; wheels: THREE.Group[];
} {
  const buggy = spec.id.startsWith("buggy");
  const body = new THREE.Group();
  body.name = buggy ? "BuggY" : "Quadro";
  const surface = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const navy = surface(0x12345a, 0.4, 0.45);
  const steel = surface(0xb7c8d7, 0.32, 0.65);
  const dark = surface(0x202936, 0.65, 0.22);
  const orange = surface(0xff790c, 0.37, 0.12);
  const leather = surface(buggy ? 0x12315c : 0xff790c, 0.68);
  const rubber = surface(0x171b22, 0.94);
  const lens = surface(0xffb446, 0.23, 0.1);
  lens.emissive.setHex(0xff7300);
  lens.emissiveIntensity = 0.65;
  const frame = buggy ? steel : navy;
  function mesh(g: THREE.BufferGeometry, m: THREE.Material, p: Point, parent = body): THREE.Mesh {
    const item = new THREE.Mesh(g, m);
    item.position.set(...p);
    parent.add(item);
    return item;
  }
  function box(size: Point, p: Point, m: THREE.Material, bevel = 0): THREE.Mesh {
    if (!bevel) return mesh(new THREE.BoxGeometry(...size), m, p);
    // Small chamfers catch light; broad faces keep their hard, clean normals.
    const [w, h, d] = size;
    const r = Math.min(bevel, w / 4, h / 4, d / 4);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2 + r);
    shape.lineTo(w / 2 - r, -h / 2 + r);
    shape.lineTo(w / 2 - r, h / 2 - r);
    shape.lineTo(-w / 2 + r, h / 2 - r);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: d - 2 * r, bevelEnabled: true, bevelThickness: r,
      bevelSize: r, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate(0, 0, -d / 2 + r);
    // All primitives use indexed position/normal/uv attributes for batching.
    const indexed = g.index ? g : indexGeometry(g);
    return mesh(indexed, m, p);
  }
  function rod(a: Point, b: Point, radius: number, m = frame, parent = body): void {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const delta = to.sub(from);
    const item = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), m,
      from.addScaledVector(delta, 0.5).toArray() as Point, parent);
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  }
  function tube(points: Point[], radius: number, m = frame): void {
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))),
      points.length * 4, radius, 8, false), m, [0, 0, 0]);
  }
  function cylinder(radius: number, depth: number, p: Point, m: THREE.Material, axis: "x" | "z" = "x"): void {
    const item = mesh(new THREE.CylinderGeometry(radius, radius, depth, 24), m, p);
    item.rotation[axis === "x" ? "z" : "x"] = Math.PI / 2;
  }
  function lamp(x: number, y: number, z: number, radius: number): void {
    cylinder(radius, 0.12, [x, y, z], steel, "z");
    cylinder(radius * 0.82, 0.018, [x, y, z + 0.067], lens, "z");
    rod([x, y - radius, z], [x, y - radius - 0.16, z - 0.05], 0.022);
  }
  const halfBase = spec.wheelbaseM / 2;
  const rail = buggy ? 0.49 : 0.44;
  for (const side of [-1, 1]) {
    const x = side * rail;
    rod([x, 0.12, -halfBase], [x, 0.12, halfBase], 0.035);
    rod([x, 0.12, -halfBase], [x, 0.59, -0.38], 0.028);
    rod([x, 0.12, 0.25], [x, 0.59, -0.38], 0.028);
    rod([-spec.trackWidthM / 2, -0.03, side * halfBase],
      [spec.trackWidthM / 2, -0.03, side * halfBase], 0.032, dark);
  }
  rod([-rail, 0.12, halfBase], [rail, 0.12, halfBase], 0.035);
  rod([-rail, 0.12, -halfBase], [rail, 0.12, -halfBase], 0.035);
  box([rail * 2, 0.06, 0.65], [0, 0.3, -0.08], dark, 0.012);
  if (!buggy) {
    box([1.01, 0.12, 0.53], [0, 0.62, -0.22], navy, 0.02);
    box([0.99, 0.15, 0.51], [0, 0.73, -0.22], leather, 0.035);
    const back = box([0.99, 0.55, 0.14], [0, 1.04, -0.47], leather, 0.04);
    back.rotation.x = -0.1;
    for (const side of [-1, 1]) {
      tube([[side * 0.51, 0.64, 0.02], [side * 0.52, 0.91, 0.04],
        [side * 0.52, 0.99, -0.46], [side * 0.49, 0.64, -0.51]], 0.025);
    }
    box([0.91, 0.49, 0.08], [0, 0.41, halfBase + 0.08], navy, 0.018);
    for (const side of [-1, 1]) {
      box([0.415, 0.415, 0.025], [side * 0.222, 0.41, halfBase + 0.131], dark, 0.008);
      for (const y of [0.245, 0.575]) cylinder(0.013, 0.012,
        [side * 0.4, y, halfBase + 0.15], steel, "z");
    }
    lamp(0, 0.35, halfBase + 0.23, 0.105);
    cylinder(0.055, 0.06, [0, 0.49, halfBase + 0.23], steel, "z");
    rod([0, 0.12, 0.31], [0, 0.83, 0.31], 0.022, navy);
    tube([[-0.43, 1.08, 0.32], [-0.22, 1.07, 0.32], [0.03, 0.84, 0.32],
      [0.35, 0.83, 0.32]], 0.025, steel);
  } else {
    for (const side of [-1, 1]) {
      const x = side * 0.49;
      tube([[x, 0.17, 0.66], [x, 1.29, 0.03], [x, 1.38, -0.1],
        [x, 1.38, -0.71], [x, 0.2, -0.92]], 0.033, steel);
      rod([x, 0.2, 0.58], [x, 0.64, -0.7], 0.027);
      rod([x, 0.2, -0.84], [x, 0.64, 0.15], 0.027);
      rod([x, 1.33, -0.7], [-x, 0.38, -0.73], 0.025);
      box([0.16, 0.055, 0.48], [side * spec.trackWidthM / 2, 0.47, -halfBase], dark, 0.015);
    }
    rod([-0.49, 1.38, -0.12], [0.49, 1.38, -0.12], 0.033);
    rod([-0.49, 1.38, -0.7], [0.49, 1.38, -0.7], 0.033);
    box([0.62, 0.42, 0.57], [0, 0.55, 0.58], orange, 0.055);
    box([0.51, 0.34, 0.035], [0, 0.51, 0.88], steel, 0.025);
    box([0.44, 0.28, 0.022], [0, 0.51, 0.907], dark, 0.012);
    for (let i = -5; i <= 5; i++) rod([i * 0.036, 0.39, 0.925], [i * 0.036, 0.63, 0.925], 0.008, navy);
    for (const x of [-0.46, 0.46]) lamp(x, 0.65, 0.76, 0.135);
    box([0.58, 0.14, 0.52], [0, 0.48, -0.26], leather, 0.04);
    const back = box([0.57, 0.63, 0.16], [0, 0.82, -0.49], leather, 0.045);
    back.rotation.x = -0.15;
    for (const x of [-0.24, 0.24]) box([0.08, 0.47, 0.1], [x, 0.82, -0.38], navy, 0.02);
    rod([0, 0.31, 0.37], [0, 0.85, 0.16], 0.024, steel);
    const wheel = mesh(new THREE.TorusGeometry(0.19, 0.016, 8, 32), rubber, [0, 0.85, 0.16]);
    wheel.rotation.x = -0.4;
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      rod([0, 0.85, 0.16], [Math.cos(angle) * 0.18, 0.85 + Math.sin(angle) * 0.166,
        0.16 - Math.sin(angle) * 0.07], 0.009, steel);
    }
  }
  // Exposed engine, cooling fins and a two-run belt suggest mechanics without tiny links.
  box([0.31, 0.2, 0.27], [0.23, 0.27, -0.49], dark, 0.025);
  cylinder(0.13, 0.25, [0.32, 0.4, -0.52], dark);
  for (let i = 0; i < 5; i++) cylinder(0.14, 0.012, [0.23 + i * 0.042, 0.4, -0.52], steel);
  cylinder(0.078, 0.035, [0.48, 0.4, -0.52], navy);
  for (const y of [0.07, 0.19]) rod([0.4, y, -halfBase], [0.4, y + 0.16, -0.48], 0.012, dark);
  if (buggy) {
    tube([[0.25, 0.27, -0.5], [0.43, 0.24, -0.72], [0.43, 0.3, -1.02]], 0.035, steel);
    cylinder(0.042, 0.045, [0.43, 0.3, -1.025], dark, "z");
  }
  bake(body);

  const wheelTemplate = new THREE.Group();
  const radius = spec.wheelRadiusM;
  const tireWidth = buggy ? 0.072 : 0.042;
  const tire = mesh(new THREE.TorusGeometry(radius - tireWidth, tireWidth, 10, 40), rubber, [0, 0, 0], wheelTemplate);
  tire.rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(radius - tireWidth * 1.65, 0.014, 6, 40),
      steel, [side * tireWidth * 0.48, 0, 0], wheelTemplate);
    rim.rotation.y = Math.PI / 2;
  }
  const hub = mesh(new THREE.CylinderGeometry(0.062, 0.062, tireWidth * 2.9, 16), navy, [0, 0, 0], wheelTemplate);
  hub.rotation.z = Math.PI / 2;
  const count = buggy ? 12 : 24;
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI * 2 / count;
    const offset = buggy ? 0 : (i % 2 ? 0.3 : -0.3);
    rod([i % 2 ? 0.025 : -0.025, Math.cos(a + offset) * 0.058, Math.sin(a + offset) * 0.058],
      [0, Math.cos(a) * (radius - tireWidth * 1.65), Math.sin(a) * (radius - tireWidth * 1.65)],
      buggy ? 0.012 : 0.005, buggy ? orange : steel, wheelTemplate);
  }
  bake(wheelTemplate);
  return { body, wheels: Array.from({ length: 4 }, () => wheelTemplate.clone(true)) };
}

function indexGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i));
  return geometry;
}

