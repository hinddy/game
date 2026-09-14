export type EnvironmentProfile = {
  background: number;
  fogDensity: number;
  lowFogDensity: number;
  skyColor: number;
  groundColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunOffset: readonly [number, number, number];
  exposure: number;
  near: number;
  far: number;
  cameraRadius: number;
  adaptiveNear: boolean;
  cityHorizon: boolean;
  bodyClass: string;
  cruise: boolean;
};
