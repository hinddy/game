/// <reference types="vite/client" />

interface Window {
  __hinddy?: {
    setTheme(theme: "salt" | "material" | "shadcn"): void;
    teleport(x: number, z: number, y?: number, heading?: number): void;
    overview(radius?: number): void;
    setInput(input: { throttle: number; brake: number; steer: number; turbo?: boolean }): void;
    snapshot(): {
      speedKph: number;
      signedSpeedKph: number;
      steeringAngle: number;
      steeringControlAngle: number;
      position: { x: number; y: number; z: number };
      wheelContacts: boolean[];
      track: string;
      worlds: ReturnType<import("./worlds/streamer").WorldStreamer["snapshot"]> | null;
      physicsColliders: number;
      theme: import("./design/theme").ThemeTokens & { name?: string; revision: number; materialAccent: string; shaderAccent: string };
      vehicle: string;
      vehicleInstance: string;
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
      cameraMode: "follow";
      orbitYaw: number;
      cameraRadius: number;
      cameraPosition: { x: number; y: number; z: number };
      cameraTarget: { x: number; y: number; z: number };
      sunElevationDeg: number;
    } | null;
  };
}





