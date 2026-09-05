import * as THREE from "three";
export const metersPerSecondToKph = (speed: number): number => speed * 3.6;
export function driveForces(speedMps: number, throttle: number, brakeInput: number,
  spec: { targetTopSpeedKph: number; engineForce: number; reverseForce: number; brakeForce: number;
    turbo?: { forceMultiplier: number; topSpeedKph: number } }, boost = 0) {
  const speed = metersPerSecondToKph(speedMps);
  const reverse = brakeInput > 0 && speed < 1;
  const turbo = spec.turbo && throttle > 0 && brakeInput <= 0 ? THREE.MathUtils.clamp(boost, 0, 1) : 0;
  const topSpeed = THREE.MathUtils.lerp(spec.targetTopSpeedKph, spec.turbo?.topSpeedKph ?? spec.targetTopSpeedKph, turbo);
  const force = spec.engineForce * THREE.MathUtils.lerp(1, spec.turbo?.forceMultiplier ?? 1, turbo);
  const taper = THREE.MathUtils.clamp((topSpeed - speed) / 5, 0, 1);
  return {
    engine: throttle > 0 ? (speed < -1 ? 0 : force * throttle * taper)
      : reverse && speed > -10 ? -spec.reverseForce * brakeInput : 0,
    brake: (brakeInput > 0 && !reverse) || (throttle > 0 && speed < -1)
      ? spec.brakeForce * Math.max(throttle, brakeInput) : 0.25,
  };
}


/** Cruise uses continuous force control, with gentle service braking on overspeed. */
export function cruiseForces(speedMps: number, targetKph: number,
  spec: { massKg: number; engineForce: number; brakeForce: number; turbo?: { forceMultiplier: number } },
  boost = 0) {
  if (speedMps < -0.28) return { engine: 0, brake: spec.brakeForce };
  const speed = Math.max(0, speedMps);
  const error = targetKph / 3.6 - speed;
  // Compensate the chassis' 0.18/s damping and the 0.25 impulse per wheel at 60 Hz.
  const force = spec.massKg * (0.18 * speed + 0.9 * error) + 60;
  const maxForce = spec.engineForce * THREE.MathUtils.lerp(1, spec.turbo?.forceMultiplier ?? 1, boost);
  return {
    engine: force > 0 ? Math.min(maxForce, force / 2) : 0,
    brake: force >= 0 ? 0.25 : THREE.MathUtils.clamp(-force / 240, 0.25, 1.5),
  };
}
