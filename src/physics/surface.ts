export type SurfacePoint = { x: number; y: number; z: number };
export type SurfaceProperties = { grip: number };
export interface SurfaceProvider {
  sample(point: SurfacePoint): SurfaceProperties;
}
export function uniformSurface(grip: number): SurfaceProvider {
  if (!Number.isFinite(grip) || grip < 0) throw Error("Invalid surface grip");
  const properties = { grip };
  return { sample: () => properties };
}
