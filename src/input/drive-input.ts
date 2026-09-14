export type DriveInput = {
  throttle: number;
  brake: number;
  steer: number;
  turbo?: boolean;
  cruiseSpeedKph?: number;
  holdBrake?: boolean;
};
