/** Circular travel with independent axis dead zones for clean coasting turns. */
export function joystickAxes(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const radius = Math.max(1, Math.hypot(x, y));
  const axis = (value: number) => Math.sign(value) * Math.pow(Math.max(0, (Math.abs(value) - 0.12) / 0.88), 1.25) || 0;
  return { x: axis(x / radius), y: axis(y / radius) };
}
