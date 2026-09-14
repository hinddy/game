import { Scope } from "../core/scope";
import { browserQuality } from "./quality";
import { bindBrowserInput } from "../input/browser-input";
import { installDebugAdapter } from "./debug-adapter";
import * as THREE from "three";
import { ThemeBridge } from "../design/theme";
import {
  TRACKS,
  VEHICLES,
  type VehicleId,
  WORLD_PHYSICS,
  type TrackId,
} from "../config";
import type { DriveInput } from "../vehicle";
import { EngineAudio } from "../engine-audio";
import { DriveControls } from "../drive-controls";
import { DrivePad } from "../drive-pad";
import { DroneCamera, DroneGestures } from "../drone-camera";

import { createDrivingHUD, requiredElement } from "../ui/driving-hud";
import { createEnvironment } from "../rendering/environment";
import { DrivingSession } from "../experiences/driving-session";
import { grounds, garageProject, type GarageProject } from "../projects/garage";
import { GameLoop } from "../core/game-loop";
export function createApp(project: GarageProject = garageProject) {
  const canvas = requiredElement<HTMLCanvasElement>("#game");
  const devParams = new URLSearchParams(window.location.search);
  const quality = browserQuality(devParams);
  const touchDevice = quality.touch,
    lightSpeed = quality.lowRender,
    pixelRatioLimit = quality.pixelRatioLimit,
    trackRenderOptions = quality.options;
  const environment = createEnvironment(canvas, lightSpeed, pixelRatioLimit);
  const { renderer, scene, camera, shadowOffset, keyLight } = environment;
  const themeBridge = new ThemeBridge();
  const engineAudio = new EngineAudio();

  const driveControls = new DriveControls();
  const hud = createDrivingHUD(driveControls, touchDevice);
  const { loadingElement, soundButton, showNotice, updateDriveUI } = hud;
  const drivePad = new DrivePad(
    requiredElement<HTMLElement>("#drive-pad"),
    requiredElement<HTMLButtonElement>("#nitro-button"),
    driveControls,
    () => {
      devInput = null;
      unlockAudio();
    },
  );
  function cancelDriving(): void {
    driveControls.cancel();
    drivePad.clear();
  }
  function unlockAudio(): void {
    void engineAudio.unlock().catch(() => {
      soundButton.textContent = "Sound unavailable";
    });
  }
  let devInput: DriveInput | null = null;
  let resetRequested = false;
  let runtime: DrivingSession | null = null;
  let activeTrack: TrackId = project.initialTrack;
  let bodyClass = "";
  const requestedVehicle = devParams.get("vehicle");
  let activeVehicle: VehicleId =
    requestedVehicle && Object.hasOwn(VEHICLES, requestedVehicle)
      ? requestedVehicle
      : project.initialVehicle;

  function currentInput(): DriveInput {
    if (import.meta.env.DEV && devInput) return devInput;
    return driveControls.input();
  }

  let generation = 0;
  function createRuntime(trackId: TrackId): DrivingSession {
    const ownGeneration = ++generation;
    const current = new DrivingSession(trackId, activeVehicle, {
      scene,
      renderer,
      camera,
      theme: themeBridge,
      options: trackRenderOptions,
      shadows: !lightSpeed,
      zone:
        devParams.get("zone") === "material"
          ? "material"
          : devParams.get("zone") === "shadcn"
            ? "shadcn"
            : undefined,
      onError: () => {
        if (
          !disposed &&
          ownGeneration === generation &&
          runtime?.track.spec.id === trackId
        )
          showNotice("Garage worlds unavailable · salt remains drivable");
      },
    });
    activeVehicle = current.vehicleId;
    drivePad.setTurboAvailable(!!current.vehicle.spec.turbo);
    hud.session(current);
    return current;
  }

  function switchTrack(trackId: TrackId): void {
    if (runtime) {
      runtime.dispose(scene);
      runtime = null;
    }
    cancelDriving();
    devInput = null;
    resetRequested = false;
    activeTrack = trackId;
    driveControls.setAvailable(grounds.get(trackId).environment.cruise);
    updateDriveUI();
    loop.reset();
    drone.recenter();
    droneGestures.clear();
    engineAudio.update(0, 0, 0, false);
    const profile = grounds.get(trackId).environment;
    themeBridge.setTheme(project.theme);
    drone.maxRadius = profile.cameraRadius;
    if (bodyClass) document.body.classList.remove(bodyClass);
    bodyClass = profile.bodyClass;
    if (bodyClass) document.body.classList.add(bodyClass);
    environment.apply(profile);
    runtime = createRuntime(trackId);
    updateCamera(runtime, 0);
    hud.selectTrack(trackId);
    showNotice(`${TRACKS[trackId].code} · ${TRACKS[trackId].name}`);
  }

  function resetVehicle(
    message = "Vehicle returned to the last safe checkpoint",
  ): void {
    if (!runtime) return;
    runtime.vehicle.reset(runtime.lastSafeSample);
    drone.recenter();
    droneGestures.clear();
    updateCamera(runtime, 0);
    runtime.outsideSeconds = 0;
    runtime.wrongWaySeconds = 0;
    cancelDriving();
    devInput = null;
    engineAudio.update(0, 0, 0, false);
    showNotice(message);
  }

  const drone = new DroneCamera();
  const droneGestures = new DroneGestures(canvas, drone);
  const cameraForward = new THREE.Vector3();
  const cameraViewDirection = new THREE.Vector3();
  const vehiclePosition = new THREE.Vector3();

  function updateCamera(current: DrivingSession, frameDt: number): void {
    drone.update(
      camera,
      vehiclePosition.copy(current.vehicle.visual.position),
      cameraForward
        .set(0, 0, 1)
        .applyQuaternion(current.vehicle.visual.quaternion),
      frameDt,
      current.vehicle.speedKph(),
      droneGestures.active,
    );
  }
  function pauseControls(): void {
    cancelDriving();
    devInput = null;
    if (runtime) runtime.vehicle.boost = 0;
    droneGestures.clear();
    if (runtime?.track.streamer) runtime.track.streamer?.clearPointer();
    engineAudio.suspend();
  }

  const progressEvents = { reset: () => resetVehicle(), notice: showNotice };
  let fpsFrames = 0,
    fpsStartedAt = performance.now();
  const loop = new GameLoop(
    WORLD_PHYSICS.fixedStep,
    WORLD_PHYSICS.maxCatchUpSteps,
    {
      before(frameDt) {
        if (!runtime) return;
        themeBridge.sync();
        drivePad.update(frameDt, runtime.vehicle.boost > 0.05);
        if (resetRequested) {
          resetRequested = false;
          resetVehicle("Manual reset");
        }
      },
      fixed(dt) {
        if (!runtime) return;
        runtime.vehicle.capturePose();
        runtime.vehicle.update(currentInput(), dt);
        runtime.world.step();
        runtime.definition.rules(runtime, dt, progressEvents);
      },
      render(frameDt, alpha, now) {
        if (!runtime) return;
        runtime.vehicle.syncVisual(alpha);
        runtime.vehicle.updateEffects(
          frameDt,
          window.innerHeight * renderer.getPixelRatio(),
        );
        engineAudio.update(
          runtime.vehicle.speedKph(),
          runtime.vehicle.engineLoad,
          runtime.vehicle.boost,
          !!runtime.vehicle.spec.turbo,
        );
        updateDriveUI();
        updateCamera(runtime, frameDt);
        const desiredNear = runtime.definition.environment.adaptiveNear
          ? Math.max(runtime.definition.environment.near, drone.radius / 60)
          : runtime.definition.environment.near;
        if (Math.abs(camera.near - desiredNear) > 0.0001) {
          camera.near = desiredNear;
          camera.updateProjectionMatrix();
        }
        runtime.track.setViewRadius?.(drone.radius);
        runtime.track.stream(
          now,
          runtime.vehicle.position(vehiclePosition),
          camera.getWorldDirection(cameraViewDirection),
        );
        hud.frame(runtime);
        keyLight.target.position.copy(runtime.vehicle.visual.position);
        keyLight.position
          .copy(runtime.vehicle.visual.position)
          .add(shadowOffset);
        renderer.render(scene, camera);

        fpsFrames++;
        if (now - fpsStartedAt >= 650) {
          hud.fps(Math.round((fpsFrames * 1000) / (now - fpsStartedAt)));
          fpsFrames = 0;
          fpsStartedAt = now;
        }
      },
    },
  );

  const unbindInput = bindBrowserInput(
    {
      get runtime() {
        return runtime;
      },
      set runtime(v) {
        runtime = v;
      },
      get activeTrack() {
        return activeTrack;
      },
      set activeTrack(v) {
        activeTrack = v;
      },
      get activeVehicle() {
        return activeVehicle;
      },
      set activeVehicle(v) {
        activeVehicle = v;
      },
      get devInput() {
        return devInput;
      },
      set devInput(v) {
        devInput = v;
      },
      get resetRequested() {
        return resetRequested;
      },
      set resetRequested(v) {
        resetRequested = v;
      },
    },
    {
      canvas,
      camera,
      environment,
      hud,
      driveControls,
      drivePad,
      drone,
      droneGestures,
      engineAudio,
      loop,
      cancelDriving,
      unlockAudio,
      pauseControls,
      switchTrack,
    },
  );
  let disposed = false;
  let started = false;
  async function start(): Promise<void> {
    if (disposed) throw Error("App is disposed");
    if (started) return;
    started = true;
    const requestedTrack = devParams.get("track");
    const initialTrack =
      requestedTrack && Object.hasOwn(TRACKS, requestedTrack)
        ? (requestedTrack as TrackId)
        : project.initialTrack;
    switchTrack(initialTrack);
    environment.streamHorizonAfterFirstPaint();
    if (import.meta.env.DEV)
      installDebugAdapter({
        get runtime() {
          return runtime;
        },
        set devInput(value: DriveInput | null) {
          devInput = value;
        },
        themeBridge,
        drone,
        driveControls,
        engineAudio,
        renderer,
        camera,
        shadowOffset,
        currentInput,
      });
    loadingElement.classList.add("is-hidden");
    loop.start();
  }

  const scope = new Scope();
  scope.defer(() => {
    if (bodyClass) document.body.classList.remove(bodyClass);
  });
  scope.defer(() => environment.dispose());
  scope.defer(() => themeBridge.dispose());
  scope.defer(() => hud.dispose());
  scope.defer(() => engineAudio.dispose());
  scope.defer(() => {
    try {
      runtime?.dispose(scene);
    } finally {
      runtime = null;
    }
  });
  scope.defer(pauseControls);
  scope.defer(() => loop.dispose());
  scope.defer(() => {
    delete window.__hinddy;
  });
  scope.defer(() => droneGestures.dispose());
  scope.defer(() => drivePad.dispose());
  scope.defer(unbindInput);
  return {
    start,
    dispose() {
      if (disposed) return;
      disposed = true;
      scope.dispose();
    },
  };
}
