import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d";
import { ThemeBridge } from "../design/theme";
import { UIWorld } from "../design/primitives";
import { WORLD_ENTRIES } from "./registry";
import { planResidency, regionAt } from "./policy";
import type { ThemeName } from "../design/theme";
import { validateBundle, type WorldId, type WorldEntry } from "./types";

export function disposeWorldGroup(group: THREE.Group): void {
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => { if (object instanceof THREE.Mesh) {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  } });
  for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); group.clear();
}
type Resident = { ui?: UIWorld; course?: THREE.Group; ready: boolean; preparing: boolean; entry: WorldEntry; theme: ThemeName };
type Services = { world: RAPIER.World; scene: THREE.Scene; theme: ThemeBridge; shadows: boolean;
  course: () => THREE.Group; prepare: (group: THREE.Group) => Promise<unknown> };

/** Bounded neighbourhood residency. Vehicle, controls and the Rapier world never change here. */
export class WorldStreamer {
  private readonly residents = new Map<WorldId, Resident>();
  private readonly requests = new Map<WorldId, AbortController>();
  private readonly retryAfter = new Map<WorldId, number>();
  private readonly wanted = new Set<WorldId>();
  private disposed = false;
  private previous = 0;
  private current: WorldId = "salt";
  private desired: WorldId = "salt";
  private focus = new THREE.Vector3();
  private releaseCount = 0;
  private error: string | null = null;
  private entries: readonly WorldEntry[] = WORLD_ENTRIES;
  constructor(private readonly services: Services) {}
  /** A future paged manifest can replace the local neighbourhood without restarting physics. */
  setNeighbourhood(entries: readonly WorldEntry[]): void {
    if (!entries.length || entries.length > 64 || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error("Invalid neighbourhood manifest");
    this.entries = [...entries];
  }
  tick(now: number, position: THREE.Vector3, cameraRadius: number): void {
    if (this.disposed) return;
    const dt = this.previous ? Math.min(.1, (now - this.previous) / 1000) : 0;
    this.previous = now; this.focus.copy(position);
    this.desired = regionAt(this.entries, position.x, position.z);
    this.wanted.clear();
    // Bounded look-ahead and hysteresis, independent of the total catalogue size.
    for (const entry of planResidency(this.entries, position.x, position.z, cameraRadius, new Set(this.residents.keys()), this.desired)) this.wanted.add(entry.id);
    for (const [id, request] of this.requests) if (!this.wanted.has(id)) { request.abort(); this.requests.delete(id); }
    for (const [id, resident] of this.residents) if (!this.wanted.has(id)) { this.release(resident); this.residents.delete(id); }
    // At most three resident/pending bundles, one download started per frame.
    const next = this.entries.filter(e => this.wanted.has(e.id) && !this.residents.has(e.id) && !this.requests.has(e.id)
      && now >= (this.retryAfter.get(e.id) ?? 0)).sort((a, b) => Number(b.id === this.desired) - Number(a.id === this.desired))[0];
    if (next) void this.load(next);
    let builtThisFrame = false;
    for (const resident of this.residents.values()) {
      if (resident.ui && !resident.ready && !resident.preparing && !builtThisFrame) {
        builtThisFrame = true;
        if (resident.ui.buildStep()) {
          resident.preparing = true;
          void this.services.prepare(resident.ui.group).then(() => {
            if (this.disposed || this.residents.get(resident.entry.id) !== resident) return;
            resident.preparing = false; resident.ready = true;
          }).catch(() => {
            if (!this.disposed && this.residents.get(resident.entry.id) === resident) { this.release(resident); this.residents.delete(resident.entry.id); this.retryAfter.set(resident.entry.id, performance.now() + 10000); this.error = "World preparation delayed"; }
          });
        }
      }
      if (resident.ready && resident.ui && !resident.ui.group.parent && resident.ui.safeToActivate(position)) {
        resident.ui.activate(); this.services.scene.add(resident.ui.group);
      }
      resident.ui?.update(dt, position);
    }
    const active = this.residents.get(this.desired);
    if (active?.ready && this.current !== this.desired) {
      this.current = this.desired; this.services.theme.setTheme(active.theme);
    }
  }
  private async load(entry: WorldEntry): Promise<void> {
    const controller = new AbortController(); this.requests.set(entry.id, controller);
    try {
      const response = await fetch(entry.url, { signal: controller.signal, cache: "default" });
      if (!response.ok) throw new Error("World download unavailable");
      if (Number(response.headers.get("content-length")) > 65536) throw new Error("World exceeds transfer budget");
      const text = await response.text(); if (text.length > 65536) throw new Error("World exceeds transfer budget");
      const bundle = validateBundle(JSON.parse(text), entry.id);
      if (this.disposed || controller.signal.aborted || !this.wanted.has(entry.id)) return;
      const resident: Resident = { entry, ready: false, preparing: false, theme: bundle.theme };
      if (bundle.course) {
        resident.course = this.services.course(); resident.ready = true; this.services.scene.add(resident.course);
      } else resident.ui = new UIWorld(bundle, this.services.world, this.services.theme, this.services.shadows);
      this.residents.set(entry.id, resident); if (entry.id === this.desired) this.error = null; this.retryAfter.delete(entry.id);
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) { this.error = error instanceof Error ? error.message : "World unavailable"; this.retryAfter.set(entry.id, performance.now() + 10000); }
    } finally { if (this.requests.get(entry.id) === controller) this.requests.delete(entry.id); }
  }
  pick(ray: THREE.Raycaster, down = false, click = false): void {
    let best: { ui: UIWorld; index: number; distance: number } | null = null;
    for (const resident of this.residents.values()) if (resident.ui) {
      resident.ui.setPointer(null, false);
      const hit = resident.ui.pick(ray);
      if (hit && (!best || hit.distance < best.distance)) best = { ui: resident.ui, ...hit };
    }
    if (best) best.ui.setPointer(best.index, down, click);
  }
  clearPointer(): void { for (const r of this.residents.values()) r.ui?.setPointer(null, false); }
  private release(resident: Resident): void {
    resident.ui?.dispose(); if (resident.course) disposeWorldGroup(resident.course); this.releaseCount++;
  }
  snapshot() { return { active: this.current, desired: this.desired, resident: [...this.residents.keys()], pending: [...this.requests.keys()],
    released: this.releaseCount, error: this.error, worlds: [...this.residents.values()].map(r => r.ui?.snapshot() ?? { id: r.entry.id, ready: r.ready }) }; }
  get state() { return { ready: [...this.residents.values()].filter(r => r.ready).length, total: this.wanted.size }; }
  get hint(): string {
    if (this.error) return "UI world delayed · salt remains drivable";
    return this.current === "salt" ? "← Material · 1 km salt strip · shadcn →" : this.current === "material" ? "Material · drive onto the controls" : "shadcn · build from a garage";
  }
  dispose(): void {
    this.disposed = true;
    for (const request of this.requests.values()) request.abort(); this.requests.clear();
    for (const resident of this.residents.values()) this.release(resident); this.residents.clear(); this.wanted.clear(); this.retryAfter.clear();
  }
}
