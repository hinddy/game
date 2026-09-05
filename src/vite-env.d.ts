/// <reference types="vite/client" />

interface Window {
  __hinddy?: {
    setInput(input: { throttle: number; brake: number; steer: number; turbo?: boolean }): void;
    snapshot(): {
      speedKph: number;
      position: { x: number; y: number; z: number };
      wheelContacts: boolean[];
      track: string;
      vehicle: string;
      drawCalls: number;
      triangles: number;
      geometries: number;
      textures: number;
      boost: number;
      exhaustParticles: number;
      audioState: string;
      audioVolume: number;
      driveMode: "manual" | "cruise";
      cruiseActive: boolean;
      cruiseSpeedKph: number;
      driveInput: { throttle: number; brake: number; steer: number; turbo?: boolean; holdBrake?: boolean; cruiseSpeedKph?: number };
      cameraMode: "follow" | "inspect";
      cameraPosition: { x: number; y: number; z: number };
      cameraTarget: { x: number; y: number; z: number };
      sunElevationDeg: number;
    } | null;
  };
}




