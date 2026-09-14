import { WORLD_BOUNDARIES, WORLD_PHYSICS } from "../config";
import type { DrivingSession } from "./driving-session";
export type ProgressEvents = { reset(): void; notice(message: string): void };
export function updateProgress(
  current: DrivingSession,
  dt: number,
  events: ProgressEvents,
): void {
  const position = current.vehicle.position();
  const nearest = current.track.nearestSample(position);
  const allowedDistance =
    nearest.sample.width / 2 + WORLD_BOUNDARIES.safetyMarginM;

  const outside =
    current.definition.boundsHalfSize !== undefined
      ? Math.max(Math.abs(position.x), Math.abs(position.z)) >
        current.definition.boundsHalfSize!
      : nearest.distance > allowedDistance;
  if (outside || position.y < WORLD_PHYSICS.killY) {
    current.outsideSeconds += dt;
    if (
      current.outsideSeconds >= WORLD_BOUNDARIES.outsideResetSeconds ||
      position.y < WORLD_PHYSICS.killY
    )
      events.reset();
  } else {
    current.outsideSeconds = 0;
  }

  const expected = current.track.checkpoints[current.expectedCheckpoint];
  const distanceToCheckpoint = position.distanceTo(expected.position);
  if (distanceToCheckpoint < expected.width * 0.62) {
    current.lastSafeSample = current.track.samples[expected.sampleIndex];
    if (current.expectedCheckpoint === 0) {
      current.lap += 1;
      events.notice(`Lap ${current.lap} complete`);
    }
    current.expectedCheckpoint =
      (current.expectedCheckpoint + 1) % current.track.checkpoints.length;
  }

  const forward = current.vehicle.forward();
  const trackDirection = nearest.sample.tangent;
  const drivingWrongWay =
    forward.dot(trackDirection) < -0.35 &&
    current.vehicle.speedKph() > 8 &&
    (current.definition.boundsHalfSize === undefined ||
      nearest.distance < nearest.sample.width);
  current.wrongWaySeconds = drivingWrongWay
    ? current.wrongWaySeconds + dt
    : Math.max(0, current.wrongWaySeconds - dt * 2);
  if (current.wrongWaySeconds > WORLD_BOUNDARIES.wrongWayNoticeSeconds) {
    current.wrongWaySeconds = 0;
    events.notice("Wrong way — follow the orange lane marks");
  }
}
