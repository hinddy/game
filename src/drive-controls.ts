import type { DriveInput } from "./vehicle";

export type DriveMode = "manual" | "cruise";
const throttleKeys = ["KeyW", "ArrowUp"];
const brakeKeys = ["KeyS", "ArrowDown"];
const drivingKeys = new Set([...throttleKeys, ...brakeKeys, "KeyA", "KeyD", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

/** Explicit input state: only a fresh throttle press can arm a cancelled cruise. */
export class DriveControls {
  private readonly pressed = new Set<string>();
  mode: DriveMode = "manual";
  active = false;
  available = false;
  speedKph = 40;

  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.mode = "manual";
    this.cancel();
  }
  setMode(mode: DriveMode): void {
    this.mode = mode === "cruise" && this.available ? "cruise" : "manual";
    this.cancel();
  }
  setSpeed(value: number): void {
    if (Number.isFinite(value)) this.speedKph = Math.max(20, Math.min(55, Math.round(value / 5) * 5));
  }
  start(): void {
    if (this.available && this.mode === "cruise" && !brakeKeys.some(key => this.pressed.has(key))) this.active = true;
  }
  releaseKeys(): void { this.pressed.clear(); }
  cancel(): void { this.active = false; this.releaseKeys(); }
  keyDown(code: string, repeat = false): boolean {
    if (!drivingKeys.has(code)) return false;
    // A held key repeating after blur/reset/UI focus must not count as a new press.
    if (repeat && !this.pressed.has(code)) return true;
    const fresh = !repeat && !this.pressed.has(code);
    this.pressed.add(code);
    if (brakeKeys.includes(code)) {
      this.active = false;
      if (this.mode === "cruise") for (const key of throttleKeys) this.pressed.delete(key);
    }
    if (fresh && throttleKeys.includes(code)) this.start();
    return true;
  }
  keyUp(code: string): void { this.pressed.delete(code); }

  input(): DriveInput {
    const throttle = throttleKeys.some(key => this.pressed.has(key));
    const brake = brakeKeys.some(key => this.pressed.has(key));
    const shift = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight");
    const left = this.pressed.has("KeyA") || this.pressed.has("ArrowLeft");
    const right = this.pressed.has("KeyD") || this.pressed.has("ArrowRight");
    const steer = Number(left) - Number(right);
    if (this.mode === "cruise") {
      const running = this.active && !brake;
      return {
        throttle: running ? 1 : 0, brake: running ? 0 : 1, steer,
        turbo: running && shift, holdBrake: !running,
        cruiseSpeedKph: running ? this.speedKph : undefined,
      };
    }
    return { throttle: throttle && !brake ? 1 : 0, brake: brake ? 1 : 0, steer,
      turbo: throttle && shift && !brake };
  }
}

