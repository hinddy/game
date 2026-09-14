import { test, expect } from "bun:test";
import { FixedClock } from "./fixed-clock";
import { Scope } from "./scope";
import { Registry } from "./registry";
test("fixed simulation advances equally at 30, 60 and 144 Hz", () => {
  for (const hz of [30, 60, 144]) {
    const clock = new FixedClock(1 / 60, 6);
    let ticks = 0;
    for (let i = 0; i < hz * 2; i++) clock.advance(1 / hz, () => ticks++);
    expect(ticks).toBe(120);
  }
});
test("a stalled tab cannot accumulate an unbounded physics backlog", () => {
  const clock = new FixedClock(1 / 60, 3);
  let ticks = 0;
  clock.advance(12, () => ticks++);
  expect(ticks).toBe(3);
  expect(clock.advance(0, () => ticks++)).toBe(0);
  expect(ticks).toBe(3);
});
test("scope cancels work, releases backwards, once, even after cleanup failure", () => {
  const scope = new Scope(),
    calls: number[] = [];
  scope.defer(() => calls.push(1));
  scope.defer(() => {
    calls.push(2);
    throw Error("failure");
  });
  expect(() => scope.dispose()).toThrow();
  expect(scope.signal.aborted).toBe(true);
  expect(calls).toEqual([2, 1]);
  scope.dispose();
  scope.defer(() => calls.push(3));
  expect(calls).toEqual([2, 1, 3]);
});
test("registry refuses accidental replacement and unknown content", () => {
  const registry = new Registry<() => string>();
  registry.register("forest", () => "trees");
  expect(registry.get("forest")()).toBe("trees");
  expect(() => registry.get("missing")).toThrow();
  expect(() => registry.register("forest", () => "other")).toThrow();
});
