import { FixedClock } from "./fixed-clock";
export type FrameHooks = {
  before(dt: number): void;
  fixed(dt: number): void;
  render(dt: number, alpha: number, now: number): void;
};
export class GameLoop {
  private request = 0;
  private previous = 0;
  private running = false;
  readonly clock: FixedClock;
  constructor(
    step: number,
    maxSteps: number,
    private readonly hooks: FrameHooks,
  ) {
    this.clock = new FixedClock(step, maxSteps);
  }
  reset(): void {
    this.clock.reset();
    this.previous = performance.now();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.reset();
    this.request = requestAnimationFrame(this.frame);
  }
  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min((now - this.previous) / 1000, 0.1);
    this.previous = now;
    if (document.hidden) this.clock.reset();
    else {
      this.hooks.before(dt);
      const alpha = this.clock.advance(dt, this.hooks.fixed);
      this.hooks.render(dt, alpha, now);
    }
    if (this.running) this.request = requestAnimationFrame(this.frame);
  };
  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.request);
    this.clock.reset();
  }
}
