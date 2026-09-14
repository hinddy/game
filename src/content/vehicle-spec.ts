export type Vector3Data = { x: number; y: number; z: number };
export type VehicleSpec = {
  id: string;
  name: string;
  model: string;
  massKg: number;
  chassis: { width: number; height: number; length: number };
  centerOfMass: Vector3Data;
  inertia: Vector3Data;
  wheelbaseM: number;
  trackWidthM: number;
  wheelRadiusM: number;
  suspensionRestM: number;
  suspensionTravelM: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  maxSteerRad: number;
  engineForce: number;
  brakeForce: number;
  reverseForce: number;
  targetTopSpeedKph: number;
  turbo?: {
    forceMultiplier: number;
    responseSeconds: number;
    topSpeedKph: number;
  };
};
export function validateVehicleSpec(spec: VehicleSpec): VehicleSpec {
  if (!spec.id || !spec.name || !spec.model)
    throw Error("Invalid vehicle identity");
  for (const key of [
    "massKg",
    "wheelbaseM",
    "trackWidthM",
    "wheelRadiusM",
    "suspensionRestM",
    "suspensionTravelM",
    "suspensionStiffness",
    "suspensionCompression",
    "suspensionRelaxation",
    "maxSteerRad",
    "engineForce",
    "brakeForce",
    "reverseForce",
    "targetTopSpeedKph",
  ] as const)
    if (!Number.isFinite(spec[key]) || spec[key] <= 0)
      throw Error("Invalid vehicle " + key);
  for (const key of ["width", "height", "length"] as const)
    if (!Number.isFinite(spec.chassis[key]) || spec.chassis[key] <= 0)
      throw Error("Invalid chassis");
  for (const key of ["x", "y", "z"] as const)
    if (
      !Number.isFinite(spec.centerOfMass[key]) ||
      !Number.isFinite(spec.inertia[key]) ||
      spec.inertia[key] <= 0
    )
      throw Error("Invalid mass properties");
  if (
    spec.turbo &&
    (!Number.isFinite(spec.turbo.forceMultiplier) ||
      spec.turbo.forceMultiplier < 1 ||
      !Number.isFinite(spec.turbo.responseSeconds) ||
      spec.turbo.responseSeconds <= 0 ||
      !Number.isFinite(spec.turbo.topSpeedKph) ||
      spec.turbo.topSpeedKph <= 0)
  )
    throw Error("Invalid turbo");
  return spec;
}
