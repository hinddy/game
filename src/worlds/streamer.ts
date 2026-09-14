import * as THREE from "three";
import { planResidency, regionAt } from "./policy";
import {
  validateBundle,
  type WorldEntry,
  type WorldId,
  type WorldBundle,
} from "./types";
import { loadJSON } from "../content/json-loader";
import {
  DEFAULT_STREAMING_BUDGET,
  type StreamingBudget,
  type WorldContent,
} from "../content/world-content";
type Resident = {
  content: WorldContent;
  ready: boolean;
  preparing: boolean;
  entry: WorldEntry;
  theme: string;
  estimatedBytes: number;
};
export type StreamingServices = {
  scene: THREE.Scene;
  entries: readonly WorldEntry[];
  create(bundle: WorldBundle): WorldContent;
  prepare(group: THREE.Group): Promise<unknown>;
  onActivate(theme: string): void;
  hint(id: string): string;
  errorHint: string;
  load?: typeof loadJSON;
  budget?: Partial<StreamingBudget>;
};
/** Coordinates lifecycle only; content construction, presentation and theme are injected. */
export class WorldStreamer {
  private readonly residents = new Map<WorldId, Resident>();
  private readonly requests = new Map<WorldId, AbortController>();
  private readonly retryAfter = new Map<WorldId, number>();
  private readonly wanted = new Set<WorldId>();
  private disposed = false;
  private previous = 0;
  private current: WorldId;
  private desired: WorldId;
  private activeTheme: string | null = null;
  private releaseCount = 0;
  private error: string | null = null;
  private entries: readonly WorldEntry[];
  private readonly budget: StreamingBudget;
  constructor(private readonly services: StreamingServices) {
    this.entries = services.entries;
    if (!this.entries.length) throw Error("Empty neighbourhood");
    this.current = this.desired = this.entries[0].id;
    this.budget = { ...DEFAULT_STREAMING_BUDGET, ...services.budget };
    if (
      !Number.isInteger(this.budget.maxWorlds) ||
      this.budget.maxWorlds < 1 ||
      ![
        this.budget.maxEstimatedBytes,
        this.budget.maxTransferBytes,
        this.budget.buildMilliseconds,
      ].every((v) => Number.isFinite(v) && v > 0)
    )
      throw Error("Invalid streaming budget");
  }
  setNeighbourhood(entries: readonly WorldEntry[]): void {
    if (
      !entries.length ||
      entries.length > 64 ||
      new Set(entries.map((e) => e.id)).size !== entries.length
    )
      throw Error("Invalid neighbourhood manifest");
    this.entries = [...entries];
    // A new manifest invalidates pending generations even if IDs were reused for new URLs.
    for (const request of this.requests.values()) request.abort();
    this.requests.clear();
    for (const [id, r] of this.residents)
      if (!entries.some((e) => e.id === id && e.url === r.entry.url)) {
        this.release(r);
        this.residents.delete(id);
      }
  }
  tick(now: number, position: THREE.Vector3, cameraRadius: number): void {
    if (this.disposed) return;
    const dt = this.previous ? Math.min(0.1, (now - this.previous) / 1000) : 0;
    this.previous = now;
    this.desired = regionAt(this.entries, position.x, position.z);
    this.wanted.clear();
    let estimate = 0;
    for (const entry of planResidency(
      this.entries,
      position.x,
      position.z,
      cameraRadius,
      new Set(this.residents.keys()),
      this.desired,
      this.budget.maxWorlds,
    )) {
      const bytes = entry.estimatedBytes ?? 2 * 1024 * 1024;
      if (
        this.wanted.size >= this.budget.maxWorlds ||
        estimate + bytes > this.budget.maxEstimatedBytes
      )
        continue;
      this.wanted.add(entry.id);
      estimate += bytes;
    }
    if (!this.wanted.has(this.desired))
      this.error = "World exceeds resident budget";
    for (const [id, request] of this.requests)
      if (!this.wanted.has(id)) {
        request.abort();
        this.requests.delete(id);
      }
    for (const [id, resident] of this.residents)
      if (!this.wanted.has(id)) {
        this.release(resident);
        this.residents.delete(id);
      }
    const next = this.entries
      .filter(
        (e) =>
          this.wanted.has(e.id) &&
          !this.residents.has(e.id) &&
          !this.requests.has(e.id) &&
          now >= (this.retryAfter.get(e.id) ?? 0),
      )
      .sort(
        (a, b) => Number(b.id === this.desired) - Number(a.id === this.desired),
      )[0];
    if (next) void this.load(next);
    const started = performance.now();
    let built = false;
    for (const resident of this.residents.values()) {
      if (
        !resident.ready &&
        !resident.preparing &&
        !built &&
        performance.now() - started < this.budget.buildMilliseconds
      ) {
        built = true;
        if (resident.content.buildStep()) {
          resident.preparing = true;
          void this.services
            .prepare(resident.content.group)
            .then(() => {
              if (
                this.disposed ||
                this.residents.get(resident.entry.id) !== resident
              )
                return;
              resident.preparing = false;
              resident.ready = true;
            })
            .catch(() => {
              if (
                !this.disposed &&
                this.residents.get(resident.entry.id) === resident
              ) {
                this.release(resident);
                this.residents.delete(resident.entry.id);
                this.retryAfter.set(
                  resident.entry.id,
                  performance.now() + 10000,
                );
                this.error = "World preparation delayed";
              }
            });
        }
      }
      if (
        resident.ready &&
        !resident.content.group.parent &&
        resident.content.safeToActivate(position)
      ) {
        resident.content.activate();
        this.services.scene.add(resident.content.group);
      }
      resident.content.update(dt, position);
    }
    const active = this.residents.get(this.desired);
    if (active?.ready && active.content.group.parent) {
      this.error = null;
      if (this.current !== this.desired || this.activeTheme !== active.theme) {
        this.current = this.desired;
        this.activeTheme = active.theme;
        this.services.onActivate(active.theme);
      }
    }
  }
  private async load(entry: WorldEntry): Promise<void> {
    const controller = new AbortController();
    this.requests.set(entry.id, controller);
    try {
      const bundle = validateBundle(
        await (this.services.load ?? loadJSON)(
          entry.url,
          controller.signal,
          this.budget.maxTransferBytes,
        ),
        entry.id,
      );
      if (
        this.disposed ||
        controller.signal.aborted ||
        this.requests.get(entry.id) !== controller ||
        !this.wanted.has(entry.id)
      )
        return;
      const content = this.services.create(bundle);
      this.residents.set(entry.id, {
        content,
        ready: false,
        preparing: false,
        entry,
        theme: bundle.theme,
        estimatedBytes: entry.estimatedBytes ?? 2 * 1024 * 1024,
      });
      if (entry.id === this.desired) this.error = null;
      this.retryAfter.delete(entry.id);
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) {
        this.error =
          error instanceof Error ? error.message : "World unavailable";
        this.retryAfter.set(entry.id, performance.now() + 10000);
      }
    } finally {
      if (this.requests.get(entry.id) === controller)
        this.requests.delete(entry.id);
    }
  }
  pick(ray: THREE.Raycaster, down = false, click = false): void {
    let best: {
      content: WorldContent;
      index: number;
      distance: number;
    } | null = null;
    for (const r of this.residents.values()) {
      r.content.setPointer(null, false);
      const hit = r.content.pick(ray);
      if (hit && (!best || hit.distance < best.distance))
        best = { content: r.content, ...hit };
    }
    best?.content.setPointer(best.index, down, click);
  }
  clearPointer(): void {
    for (const r of this.residents.values()) r.content.setPointer(null, false);
  }
  private release(resident: Resident): void {
    resident.content.dispose();
    this.releaseCount++;
  }
  snapshot() {
    return {
      active: this.current,
      desired: this.desired,
      resident: [...this.residents.keys()],
      pending: [...this.requests.keys()],
      released: this.releaseCount,
      error: this.error,
      estimatedBytes: [...this.residents.values()].reduce(
        (n, r) => n + r.estimatedBytes,
        0,
      ),
      worlds: [...this.residents.values()].map((r) => r.content.snapshot()),
    };
  }
  get state() {
    return {
      ready: [...this.residents.values()].filter((r) => r.ready).length,
      total: this.wanted.size,
    };
  }
  get hint(): string {
    return this.error
      ? this.services.errorHint
      : this.services.hint(this.current);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const r of this.requests.values()) r.abort();
    this.requests.clear();
    for (const r of this.residents.values()) this.release(r);
    this.residents.clear();
    this.wanted.clear();
    this.retryAfter.clear();
  }
}
