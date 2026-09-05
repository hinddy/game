import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import type { TrackSpec } from "./config";
import { trackRibbon, roadProfile, shoulderProfile, barrierProfile } from "./track-geometry";

export type TrackSample = {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  rotation: THREE.Quaternion;
  width: number;
};

export type Checkpoint = {
  sampleIndex: number;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  width: number;
};

export type TrackRenderOptions = {
  chunkSamples: number;
  initialChunks: number;
  streamIntervalMs: number;
  showProps: boolean;
  castShadows: boolean;
};

export type StreamState = { ready: number; total: number };

const up = new THREE.Vector3(0, 1, 0);

function rotationFor(tangent: THREE.Vector3, bankDeg: number): THREE.Quaternion {
  const forward = tangent.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, correctedUp, forward);
  const base = new THREE.Quaternion().setFromRotationMatrix(basis);
  if (bankDeg === 0) return base;
  return new THREE.Quaternion().setFromAxisAngle(forward, THREE.MathUtils.degToRad(bankDeg)).multiply(base);
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

/**
 * Collision is complete immediately; only the visual cells stream. This is the
 * procedural-world analogue of panorama tiles: first a cell around Quadro,
 * then cells in the direction the camera is looking.
 */
export class TrackRuntime {
  readonly group = new THREE.Group();
  readonly samples: TrackSample[];
  readonly checkpoints: Checkpoint[];
  readonly spawn: TrackSample;

  private readonly visualLayer = new THREE.Group();
  private readonly builtChunks = new Set<number>();
  private readonly chunkCount: number;
  private nextStreamAt = 0;

  private readonly markerGeometry = new THREE.BoxGeometry(0.16, 0.025, 1.45);
  private readonly poleGeometry = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8);
  private readonly lampGeometry = new THREE.SphereGeometry(0.18, 10, 8);
  private readonly roadMaterial: THREE.MeshStandardMaterial;
  private readonly shoulderMaterial: THREE.MeshStandardMaterial;
  private readonly barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: 0.7, metalness: 0.25 });
  private readonly markerMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a1d, roughness: 0.75 });
  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: 0x142944, roughness: 0.65, metalness: 0.4 });
  private readonly lampMaterial = new THREE.MeshStandardMaterial({ color: 0xff9a32, emissive: 0xff5f00, emissiveIntensity: 1.6 });

  constructor(
    readonly spec: TrackSpec,
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    private readonly renderOptions: TrackRenderOptions,
  ) {
    this.group.name = `track:${spec.id}`;
    this.visualLayer.name = "streamed-cells";
    this.samples = this.buildSamples();
    this.spawn = this.samples[2];
    this.chunkCount = Math.ceil(this.samples.length / renderOptions.chunkSamples);
    this.roadMaterial = new THREE.MeshStandardMaterial({ color: this.spec.color, roughness: 0.92, metalness: 0.02 });
    this.shoulderMaterial = new THREE.MeshStandardMaterial({ color: this.spec.shoulderColor, roughness: 1 });
    this.checkpoints = [0, 0.25, 0.5, 0.75].map((ratio) => {
      const sampleIndex = Math.floor(this.samples.length * ratio) % this.samples.length;
      const sample = this.samples[sampleIndex];
      return { sampleIndex, position: sample.position.clone(), forward: sample.tangent.clone(), width: sample.width };
    });

    this.buildPhysicsShell();
    this.buildCheckpoints();
    this.group.add(this.visualLayer);
    this.buildInitialChunks();
    this.nextStreamAt = performance.now() + renderOptions.streamIntervalMs;
    scene.add(this.group);
  }

  get streamState(): StreamState {
    return { ready: this.builtChunks.size, total: this.chunkCount };
  }

  private buildSamples(): TrackSample[] {
    const points = this.spec.points.map((point) => new THREE.Vector3(point.x, point.y, point.z));
    const curve = new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
    const samples: TrackSample[] = [];
    for (let index = 0; index < this.spec.sampleCount; index += 1) {
      const u = index / this.spec.sampleCount;
      const curveT = curve.getUtoTmapping(u, 0) * this.spec.points.length;
      const pointSlot = Math.floor(curveT) % this.spec.points.length;
      const source = this.spec.points[pointSlot];
      const nextSource = this.spec.points[(pointSlot + 1) % this.spec.points.length];
      const blend = THREE.MathUtils.smoothstep(curveT % 1, 0, 1);
      const bank = THREE.MathUtils.lerp(source.bankDeg ?? 0, nextSource.bankDeg ?? 0, blend);
      const tangent = curve.getTangentAt(u).normalize();
      const right = new THREE.Vector3().crossVectors(up, tangent).normalize();
      samples.push({
        position: curve.getPointAt(u),
        tangent,
        right,
        rotation: rotationFor(tangent, bank),
        width: THREE.MathUtils.lerp(source.width ?? this.spec.defaultWidth, nextSource.width ?? this.spec.defaultWidth, blend),
      });
    }
    return samples;
  }

  private buildPhysicsShell(): void {
    const indexes = this.samples.map((_, index) => index);
    for (const [profile, friction] of [
      [roadProfile, this.spec.surfaceGrip],
      [shoulderProfile, Math.max(0.45, this.spec.surfaceGrip * 0.72)],
      [barrierProfile(-1, this.spec.barrierHeight), 0.55],
      [barrierProfile(1, this.spec.barrierHeight), 0.55],
    ] as const) {
      const geometry = trackRibbon(this.samples, indexes, profile);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(
        new Float32Array(geometry.getAttribute("position").array),
        new Uint32Array(geometry.index!.array),
      ).setFriction(friction).setRestitution(0.01));
      geometry.dispose();
    }
  }
  private buildCheckpoints(): void {
    const gates = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff7300, transparent: true, opacity: 0.16 }),
      this.checkpoints.length,
    );
    const matrix = new THREE.Matrix4();
    this.checkpoints.forEach((checkpoint, index) => {
      const sample = this.samples[checkpoint.sampleIndex];
      matrix.compose(checkpoint.position.clone().addScaledVector(up, 1.2), sample.rotation, new THREE.Vector3(checkpoint.width, 2.4, 0.12));
      gates.setMatrixAt(index, matrix);
    });
    gates.instanceMatrix.needsUpdate = true;
    this.group.add(gates);
  }

  private buildInitialChunks(): void {
    const startChunk = Math.floor(2 / this.renderOptions.chunkSamples);
    for (const offset of [0, 1, -1, 2, -2].slice(0, this.renderOptions.initialChunks)) {
      this.buildChunk((startChunk + offset + this.chunkCount) % this.chunkCount);
    }
  }

  private buildChunk(chunkIndex: number): void {
    if (this.builtChunks.has(chunkIndex)) return;
    const first = chunkIndex * this.renderOptions.chunkSamples;
    const indexes = Array.from({ length: Math.min(this.renderOptions.chunkSamples, this.samples.length - first) }, (_, offset) => first + offset);
    if (indexes.length === 0) return;

    const chunk = new THREE.Group();
    chunk.name = `cell:${chunkIndex}`;
    const road = new THREE.Mesh(trackRibbon(this.samples, indexes, roadProfile), this.roadMaterial);
    const shoulders = new THREE.Mesh(trackRibbon(this.samples, indexes, shoulderProfile), this.shoulderMaterial);
    const barriers = new THREE.Group();
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(trackRibbon(this.samples, indexes,
        barrierProfile(side, this.spec.barrierHeight)), this.barrierMaterial);
      wall.castShadow = this.renderOptions.castShadows;
      wall.receiveShadow = this.renderOptions.castShadows;
      barriers.add(wall);
    }
    road.receiveShadow = this.renderOptions.castShadows;
    shoulders.receiveShadow = this.renderOptions.castShadows;
    const markerIndexes: number[] = [];
    const propIndexes: number[] = [];

    indexes.forEach((index) => {
      if (index % 5 === 0) markerIndexes.push(index);
      if (this.renderOptions.showProps && index % 12 === 0) propIndexes.push(index);
    });

    chunk.add(shoulders, road, barriers);
    this.buildChunkMarkers(chunk, markerIndexes);
    this.buildChunkProps(chunk, propIndexes);
    this.visualLayer.add(chunk);
    this.builtChunks.add(chunkIndex);
  }

  private buildChunkMarkers(chunk: THREE.Group, indexes: number[]): void {
    if (indexes.length === 0) return;
    const markers = new THREE.InstancedMesh(this.markerGeometry, this.markerMaterial, indexes.length);
    const matrix = new THREE.Matrix4();
    indexes.forEach((index, localIndex) => {
      const sample = this.samples[index];
      matrix.compose(sample.position.clone().addScaledVector(up, 0.025), sample.rotation, new THREE.Vector3(1, 1, 1));
      markers.setMatrixAt(localIndex, matrix);
    });
    markers.instanceMatrix.needsUpdate = true;
    chunk.add(markers);
  }

  private buildChunkProps(chunk: THREE.Group, indexes: number[]): void {
    if (indexes.length === 0) return;
    const poles = new THREE.InstancedMesh(this.poleGeometry, this.poleMaterial, indexes.length);
    const lamps = new THREE.InstancedMesh(this.lampGeometry, this.lampMaterial, indexes.length);
    const matrix = new THREE.Matrix4();
    indexes.forEach((index, localIndex) => {
      const sample = this.samples[index];
      const side = index % 24 === 0 ? -1 : 1;
      const base = sample.position.clone().addScaledVector(sample.right, side * (sample.width / 2 + 2.5));
      matrix.compose(base.clone().addScaledVector(up, 1.7), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(localIndex, matrix);
      matrix.compose(base.clone().addScaledVector(up, 3.35), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(localIndex, matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    chunk.add(poles, lamps);
  }

  stream(now: number, focus: THREE.Vector3, viewDirection: THREE.Vector3): void {
    if (this.builtChunks.size === this.chunkCount || now < this.nextStreamAt) return;
    const focusIndex = this.nearestSample(focus).index;
    const next = Array.from({ length: this.chunkCount }, (_, chunkIndex) => chunkIndex)
      .filter((chunkIndex) => !this.builtChunks.has(chunkIndex))
      .sort((left, right) => this.chunkPriority(left, focusIndex, focus, viewDirection) - this.chunkPriority(right, focusIndex, focus, viewDirection))[0];
    if (next === undefined) return;
    this.buildChunk(next);
    this.nextStreamAt = now + this.renderOptions.streamIntervalMs;
  }

  private chunkPriority(chunkIndex: number, focusIndex: number, focus: THREE.Vector3, viewDirection: THREE.Vector3): number {
    const center = Math.min(this.samples.length - 1, chunkIndex * this.renderOptions.chunkSamples + Math.floor(this.renderOptions.chunkSamples / 2));
    const sampleDistance = Math.abs(center - focusIndex);
    const circularDistance = Math.min(sampleDistance, this.samples.length - sampleDistance);
    const toChunk = this.samples[center].position.clone().sub(focus);
    const visibleBias = toChunk.lengthSq() > 0.01 ? toChunk.normalize().dot(viewDirection) : 0;
    return circularDistance - visibleBias * this.renderOptions.chunkSamples * 0.7;
  }

  nearestSample(position: THREE.Vector3): { index: number; sample: TrackSample; distance: number } {
    let nearestIndex = 0;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.samples.length; index += 1) {
      const distanceSq = this.samples[index].position.distanceToSquared(position);
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestIndex = index;
      }
    }
    return { index: nearestIndex, sample: this.samples[nearestIndex], distance: Math.sqrt(nearestDistanceSq) };
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    disposeObject(this.group);
    // Templates may not have reached a streamed cell when switching early.
    for (const geometry of [this.markerGeometry, this.poleGeometry, this.lampGeometry]) geometry.dispose();
    for (const material of [this.roadMaterial, this.shoulderMaterial, this.barrierMaterial,
      this.markerMaterial, this.poleMaterial, this.lampMaterial]) material.dispose();
  }
}


