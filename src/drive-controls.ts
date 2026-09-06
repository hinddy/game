import type { DriveInput } from "./vehicle";

export type DriveAction = "forward" | "brake" | "left" | "right" | "turbo";
export type DriveMode = "manual" | "cruise";
const throttleKeys = ["KeyW", "ArrowUp"];
const brakeKeys = ["KeyS", "ArrowDown"];
const drivingKeys = new Set([...throttleKeys, ...brakeKeys, "KeyA", "KeyD", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

/** Explicit input state: only a fresh throttle press can arm a cancelled cruise. */
export class DriveControls {
  private readonly pressed = new Set<string>();
  private readonly actions = new Map<string, DriveAction>();
  private stickX = 0;
  private stickY = 0;
  setStick(x: number, y: number): void {
    const wasForward = this.stickY < 0;
    this.stickX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.stickY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
    if (this.stickY > 0) this.active = false;
    if (this.stickY < 0 && !wasForward) this.start();
  }
  actionHeld(action: DriveAction): boolean {
    for (const held of this.actions.values()) if (held === action) return true;
    return false;
  }
  pressAction(source: string, action: DriveAction): void {
    if (this.actions.get(source) === action) return;
    this.actions.set(source, action);
    if (action === "brake") this.active = false;
    if (action === "forward") this.start();
  }
  releaseAction(source: string): void { this.actions.delete(source); }
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
    if (this.available && this.mode === "cruise" && this.stickY <= 0 && !brakeKeys.some(key => this.pressed.has(key)) && !this.actionHeld("brake")) this.active = true;
  }
  releaseKeys(): void { this.pressed.clear(); }
  cancel(): void { this.active = false; this.releaseKeys(); this.actions.clear(); this.stickX = 0; this.stickY = 0; }
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
    const throttle = Math.max(Number(throttleKeys.some(key => this.pressed.has(key)) || this.actionHeld("forward")), -this.stickY, 0);
    const brake = Math.max(Number(brakeKeys.some(key => this.pressed.has(key)) || this.actionHeld("brake")), this.stickY, 0);
    const shift = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight") || this.actionHeld("turbo");
    const left = this.pressed.has("KeyA") || this.pressed.has("ArrowLeft") || this.actionHeld("left");
    const right = this.pressed.has("KeyD") || this.pressed.has("ArrowRight") || this.actionHeld("right");
    const steer = left || right ? Number(left) - Number(right) : -this.stickX || 0;
    if (this.mode === "cruise") {
      const running = this.active && !brake;
      return {
        throttle: running ? 1 : 0, brake: running ? 0 : 1, steer,
        turbo: running && shift, holdBrake: !running,
        cruiseSpeedKph: running ? this.speedKph : undefined,
      };
    }
    return { throttle: brake > 0 ? 0 : throttle, brake, steer,
      turbo: throttle > 0 && shift && brake <= 0 };
  }
}


