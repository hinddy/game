import * as THREE from "three";
import { metersPerSecondToKph } from "../vehicle-drive";
import type { DrivingSession } from "../experiences/driving-session";
import type { DriveInput } from "../vehicle";
import type { ThemeBridge } from "../design/theme";
import type { DroneCamera } from "../drone-camera";
import type { DriveControls } from "../drive-controls";
import type { EngineAudio } from "../engine-audio";
export function installDebugAdapter(context: {
  runtime: DrivingSession | null;
  devInput: DriveInput | null;
  themeBridge: ThemeBridge;
  drone: DroneCamera;
  driveControls: DriveControls;
  engineAudio: EngineAudio;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  shadowOffset: THREE.Vector3;
  currentInput(): DriveInput;
}) {
  const {
    themeBridge,
    drone,
    driveControls,
    engineAudio,
    renderer,
    camera,
    shadowOffset,
    currentInput,
  } = context;
  window.__hinddy = {
    setTheme(theme) {
      themeBridge.setTheme(theme);
    },
    teleport(x, z, y = 0.85, heading = 0) {
      if (!context.runtime) return;
      context.runtime.vehicle.body.setTranslation({ x, y, z }, true);
      context.runtime.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      context.runtime.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      context.runtime.vehicle.body.setRotation(
        { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
        true,
      );
      context.runtime.vehicle.snapInterpolation();
    },
    overview(radius = 420) {
      drone.radius = Math.min(drone.maxRadius, radius);
      drone.elevation = Math.PI / 2 - 0.01;
      drone.yaw = Math.PI;
      drone.orbit(0, 0);
    },
    setInput(input) {
      context.devInput = input;
    },
    snapshot() {
      if (!context.runtime) return null;
      const position = context.runtime.vehicle.position();
      return {
        speedKph: context.runtime.vehicle.speedKph(),
        signedSpeedKph: metersPerSecondToKph(
          context.runtime.vehicle.controller.currentVehicleSpeed(),
        ),
        steeringAngle: context.runtime.vehicle.steeringAngle,
        steeringControlAngle: context.runtime.vehicle.steeringControlAngle,
        position: { x: position.x, y: position.y, z: position.z },
        wheelContacts: Array.from(
          { length: context.runtime.vehicle.controller.numWheels() },
          (_, index) =>
            context.runtime!.vehicle.controller.wheelIsInContact(index),
        ),
        track: context.runtime.track.spec.id,
        worlds: context.runtime.track.streamer
          ? (context.runtime.track.streamer?.snapshot() ?? null)
          : null,
        physicsColliders: context.runtime.world.colliders.len(),
        theme: {
          name: document.documentElement.dataset.theme,
          revision: themeBridge.revision,
          ...themeBridge.tokens,
          materialAccent: themeBridge.materials.accent.color.getHexString(),
          shaderAccent: themeBridge.uniforms.uAccent.value.getHexString(),
        },
        vehicle: context.runtime.vehicle.spec.id,
        vehicleInstance: context.runtime.vehicle.visual.uuid,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        boost: context.runtime.vehicle.boost,
        exhaustParticles: context.runtime.vehicle.exhaustParticles,
        audioState: engineAudio.state,
        audioVolume: engineAudio.level,
        driveMode: driveControls.mode,
        cruiseActive: driveControls.active,
        cruiseSpeedKph: driveControls.speedKph,
        driveInput: currentInput(),
        cameraMode: "follow",
        orbitYaw: drone.yaw,
        cameraRadius: drone.radius,
        cameraPosition: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        cameraTarget: {
          x: drone.target.x,
          y: drone.target.y,
          z: drone.target.z,
        },
        sunElevationDeg: THREE.MathUtils.radToDeg(
          Math.atan2(
            shadowOffset.y,
            Math.hypot(shadowOffset.x, shadowOffset.z),
          ),
        ),
      };
    },
  };
}
