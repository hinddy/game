import * as THREE from "three";
import { Scope } from "../core/scope";
import {
  VEHICLES,
  vehicleForTrack,
  type TrackId,
  type VehicleId,
} from "../config";
import type { DrivingSession } from "../experiences/driving-session";
import type { DriveInput } from "../vehicle";
import type { DriveControls } from "../drive-controls";
import type { DrivePad } from "../drive-pad";
import type { DroneCamera, DroneGestures } from "../drone-camera";
import type { EngineAudio } from "../engine-audio";
import { requiredElement, type createDrivingHUD } from "../ui/driving-hud";
import type { createEnvironment } from "../rendering/environment";
import type { GameLoop } from "../core/game-loop";
export type InputContext = {
  runtime: DrivingSession | null;
  activeTrack: TrackId;
  activeVehicle: VehicleId;
  resetRequested: boolean;
  devInput: DriveInput | null;
};
export function bindBrowserInput(
  context: InputContext,
  services: {
    canvas: HTMLCanvasElement;
    camera: THREE.PerspectiveCamera;
    environment: ReturnType<typeof createEnvironment>;
    hud: ReturnType<typeof createDrivingHUD>;
    driveControls: DriveControls;
    drivePad: DrivePad;
    drone: DroneCamera;
    droneGestures: DroneGestures;
    engineAudio: EngineAudio;
    loop: GameLoop;
    cancelDriving(): void;
    unlockAudio(): void;
    pauseControls(): void;
    switchTrack(id: TrackId): void;
  },
) {
  const scope = new Scope();
  type Events = WindowEventMap & DocumentEventMap & HTMLElementEventMap;
  function on<K extends keyof Events>(
    target: EventTarget,
    type: K,
    fn: (event: Events[K]) => void,
  ) {
    scope.listen(target, type, fn as EventListener);
  }
  const {
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
  } = services;
  const {
    soundButton,
    volumeControl,
    driveModeControl,
    cruiseSpeedControl,
    cruiseButton,
    showNotice,
    updateDriveUI,
  } = hud;
  on(window, "pointerdown", unlockAudio);
  on(soundButton, "click", () => {
    const muted = engineAudio.toggleMute();
    soundButton.textContent = muted ? "Sound off" : "Sound on";
    soundButton.setAttribute("aria-pressed", String(!muted));
  });
  on(volumeControl, "input", () =>
    engineAudio.setVolume(Number(volumeControl.value) / 100),
  );

  on(driveModeControl, "change", () => {
    drivePad.clear();
    driveControls.setMode(
      driveModeControl.value === "cruise" ? "cruise" : "manual",
    );
    context.devInput = null;
    if (context.runtime) context.runtime.vehicle.boost = 0;
    updateDriveUI();
    driveModeControl.blur();
    canvas.focus({ preventScroll: true });
  });
  on(cruiseSpeedControl, "input", () => {
    driveControls.setSpeed(Number(cruiseSpeedControl.value));
    updateDriveUI();
  });
  on(cruiseSpeedControl, "pointerup", () =>
    canvas.focus({ preventScroll: true }),
  );
  on(volumeControl, "pointerup", () => canvas.focus({ preventScroll: true }));
  on(cruiseButton, "click", () => {
    if (driveControls.active) cancelDriving();
    else driveControls.start();
    context.devInput = null;
    updateDriveUI();
    cruiseButton.blur();
  });
  on(requiredElement<HTMLButtonElement>("#camera-reset"), "click", () => {
    drone.recenter();
    droneGestures.clear();
    canvas.focus({ preventScroll: true });
  });
  on(requiredElement<HTMLButtonElement>("#vehicle-reset"), "click", () => {
    context.resetRequested = true;
    canvas.focus({ preventScroll: true });
  });
  const uiRay = new THREE.Raycaster();
  const uiPointer = new THREE.Vector2();
  let uiPress: { id: number; x: number; y: number } | null = null;
  function pickWorldUI(event: PointerEvent, down = false, click = false): void {
    if (!context.runtime?.track.streamer) return;
    const rect = canvas.getBoundingClientRect();
    uiPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    uiRay.setFromCamera(uiPointer, camera);
    context.runtime.track.streamer?.pick(uiRay, down, click);
  }
  on(canvas, "pointermove", (event) => {
    if (event.pointerType === "mouse" && event.buttons === 0)
      pickWorldUI(event);
    if (
      uiPress &&
      Math.hypot(event.clientX - uiPress.x, event.clientY - uiPress.y) > 8
    ) {
      uiPress = null;
      if (context.runtime?.track.streamer)
        context.runtime.track.streamer?.clearPointer();
    }
  });
  on(canvas, "pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    uiPress = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pickWorldUI(event, event.pointerType === "mouse");
  });
  on(canvas, "pointerup", (event) => {
    if (uiPress?.id === event.pointerId) pickWorldUI(event, false, true);
    uiPress = null;
  });
  for (const name of ["pointercancel", "pointerleave"] as const)
    on(canvas, name, () => {
      uiPress = null;
      if (context.runtime?.track.streamer)
        context.runtime.track.streamer?.clearPointer();
    });
  on(window, "keydown", (event) => {
    const target = event.target;
    // Preserve actual text entry and native arrow/space editing, but let WASD/R/F/Shift
    // drive even when a select/range retains focus after a click (including Safari).
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target instanceof HTMLTextAreaElement)
    )
      return;
    if (
      target instanceof HTMLInputElement &&
      !["range", "checkbox", "radio", "button"].includes(target.type)
    )
      return;
    if (
      (target instanceof HTMLSelectElement ||
        target instanceof HTMLInputElement) &&
      (event.code.startsWith("Arrow") ||
        ["Space", "Enter", "Home", "End"].includes(event.code))
    )
      return;
    if (
      target instanceof HTMLButtonElement &&
      ["Space", "Enter"].includes(event.code)
    )
      return;
    unlockAudio();
    if (event.code === "KeyR" && !event.repeat) context.resetRequested = true;
    if (event.code === "KeyF" && !event.repeat) {
      drone.recenter();
      droneGestures.clear();
      showNotice("Drone centred behind the vehicle");
    }
    if (driveControls.keyDown(event.code, event.repeat)) {
      event.preventDefault();
      context.devInput = null;
    }
  });
  on(window, "keyup", (event) => driveControls.keyUp(event.code));
  on(document, "focusin", (event) => {
    if (
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement
    ) {
      driveControls.releaseKeys();
      context.devInput = null;
    }
  });
  on(window, "blur", pauseControls);
  on(document, "visibilitychange", () => {
    if (document.hidden) pauseControls();
  });
  on(window, "pagehide", pauseControls);
  on(window, "pageshow", () => loop.reset());
  on(window, "resize", environment.resize);

  document
    .querySelectorAll<HTMLButtonElement>("[data-track]")
    .forEach((button) => {
      on(button, "click", () => {
        const trackId = button.dataset.track as TrackId | undefined;
        if (trackId && trackId !== context.activeTrack) switchTrack(trackId);
        canvas.focus({ preventScroll: true });
      });
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-vehicle]")
    .forEach((button) => {
      on(button, "click", () => {
        const id = button.dataset.vehicle as VehicleId;
        if (
          id === context.activeVehicle ||
          !Object.hasOwn(VEHICLES, id) ||
          vehicleForTrack(context.activeTrack, id) !== id
        )
          return;
        context.activeVehicle = id;
        cancelDriving();
        context.devInput = null;
        context.resetRequested = false;
        loop.reset();
        drone.recenter();
        droneGestures.clear();
        switchTrack(context.activeTrack);
        canvas.focus({ preventScroll: true });
        showNotice(`${VEHICLES[id].name} ready — new session`);
      });
    });

  return () => scope.dispose();
}
