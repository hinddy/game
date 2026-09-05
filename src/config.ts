import worldSpec from "./specs/world.v1.json";
import quadroSpec from "./specs/vehicle.quadro.m0.json";
import buggySpec from "./specs/vehicle.buggy.m0.json";

export type TrackId = "yard" | "gravel" | "oval" | "bonneville";

export type TrackPoint = {
  x: number;
  y: number;
  z: number;
  width?: number;
  bankDeg?: number;
};

export type TrackSpec = {
  id: TrackId;
  code: string;
  name: string;
  surface: "asphalt" | "gravel" | "salt";
  surfaceGrip: number;
  color: number;
  shoulderColor: number;
  sampleCount: number;
  defaultWidth: number;
  barrierHeight: number;
  points: TrackPoint[];
  vehicleOnly?: VehicleId;
};

export const WORLD_PHYSICS = worldSpec.physics;
export const WORLD_BOUNDARIES = worldSpec.boundaries;
export const QUADRO_SPEC = quadroSpec.vehicle;
export const BUGGY_SPEC = buggySpec.vehicle;
export type VehicleSpec = typeof QUADRO_SPEC & { turbo?: typeof BUGGY_SPEC.turbo };
export type VehicleId = "quadro" | "buggy";
export const VEHICLES: Record<VehicleId, VehicleSpec> = { quadro: QUADRO_SPEC, buggy: BUGGY_SPEC };

const roundedYard: TrackPoint[] = [
  { x: -34, y: 0, z: -20, width: 7 },
  { x: 0, y: 0, z: -30, width: 8 },
  { x: 34, y: 0, z: -20, width: 7 },
  { x: 38, y: 0, z: 12, width: 7 },
  { x: 18, y: 0, z: 28, width: 8 },
  { x: -24, y: 0, z: 26, width: 7 },
  { x: -38, y: 0, z: 8, width: 7 },
];

const gravelLoop: TrackPoint[] = [
  { x: -62, y: 0, z: -16, width: 8 },
  { x: -28, y: 0.4, z: -46, width: 8 },
  { x: 18, y: 1.2, z: -50, width: 7 },
  { x: 64, y: 0.2, z: -24, width: 9 },
  { x: 70, y: 0, z: 22, width: 8 },
  { x: 30, y: 0.9, z: 48, width: 7 },
  { x: -22, y: 0.3, z: 44, width: 8 },
  { x: -68, y: 0, z: 18, width: 9 },
];

const oval: TrackPoint[] = [
  { x: -88, y: 0, z: 0, width: 9, bankDeg: 4 },
  { x: -64, y: 0, z: -42, width: 9, bankDeg: 8 },
  { x: 0, y: 0, z: -50, width: 10, bankDeg: 2 },
  { x: 64, y: 0, z: -42, width: 9, bankDeg: 8 },
  { x: 88, y: 0, z: 0, width: 9, bankDeg: 4 },
  { x: 64, y: 0, z: 42, width: 9, bankDeg: 8 },
  { x: 0, y: 0, z: 50, width: 10, bankDeg: 2 },
  { x: -64, y: 0, z: 42, width: 9, bankDeg: 8 },
];

export const TRACKS: Record<TrackId, TrackSpec> = {
  bonneville: {
    id: "bonneville", code: "P04", name: "Bonneville Salt Flats", surface: "salt",
    surfaceGrip: 0.86, color: 0xf2eee2, shoulderColor: 0xf2eee2,
    sampleCount: 192, defaultWidth: 60, barrierHeight: 0, vehicleOnly: "buggy",
    points: [
      { x: -600, y: 0, z: -350 }, { x: -600, y: 0, z: 350 },
      { x: -400, y: 0, z: 700 }, { x: 400, y: 0, z: 700 },
      { x: 600, y: 0, z: 350 }, { x: 600, y: 0, z: -350 },
      { x: 400, y: 0, z: -700 }, { x: -400, y: 0, z: -700 },
    ],
  },
  yard: {
    id: "yard",
    code: "P01",
    name: "Calibration Yard",
    surface: "asphalt",
    surfaceGrip: 1.05,
    color: 0x343b45,
    shoulderColor: 0x9a652d,
    sampleCount: 72,
    defaultWidth: 7,
    barrierHeight: 0.8,
    points: roundedYard,
  },
  gravel: {
    id: "gravel",
    code: "P02",
    name: "Gravel Loop",
    surface: "gravel",
    surfaceGrip: 0.72,
    color: 0x755237,
    shoulderColor: 0x4b5a35,
    sampleCount: 88,
    defaultWidth: 8,
    barrierHeight: 0.7,
    points: gravelLoop,
  },
  oval: {
    id: "oval",
    code: "P03",
    name: "Banked Oval",
    surface: "asphalt",
    surfaceGrip: 0.98,
    color: 0x2e3540,
    shoulderColor: 0x516044,
    sampleCount: 104,
    defaultWidth: 9,
    barrierHeight: 0.9,
    points: oval,
  },
};


export function vehicleForTrack(trackId: TrackId, requested: VehicleId): VehicleId {
  return TRACKS[trackId].vehicleOnly ?? requested;
}

