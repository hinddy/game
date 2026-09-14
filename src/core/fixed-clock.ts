/** Simulation time is independent of browser refresh rate. No browser/engine imports. */
export class FixedClock {
  private accumulator = 0;
  constructor(
    readonly step: number,
    readonly maxSteps: number,
  ) {
    if (
      !(step > 0) ||
      !Number.isFinite(step) ||
      !Number.isInteger(maxSteps) ||
      maxSteps < 1
    )
      throw new Error("Invalid simulation clock");
  }
  reset(): void {
    this.accumulator = 0;
  }
  advance(dt: number, tick: (dt: number) => void): number {
    this.accumulator += Math.max(
      0,
      Math.min(Number.isFinite(dt) ? dt : 0, 0.1),
    );
    let steps = 0;
    while (this.accumulator + 1e-12 >= this.step && steps < this.maxSteps) {
      this.accumulator -= this.step;
      tick(this.step);
      steps++;
    }
    if (steps === this.maxSteps) this.reset();
    return Math.max(0, this.accumulator / this.step);
  }
}
