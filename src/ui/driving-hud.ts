import { DriveControls } from "../drive-controls";
import { TRACKS, VEHICLES, type TrackId, type VehicleId } from "../config";
import type { DrivingSession } from "../experiences/driving-session";
export const requiredElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

export function createDrivingHUD(
  driveControls: DriveControls,
  touchDevice: boolean,
) {
  const speedElement = requiredElement<HTMLElement>("#speed");
  const fpsElement = requiredElement<HTMLElement>("#fps");
  const surfaceElement = requiredElement<HTMLElement>("#surface");
  const streamElement = requiredElement<HTMLElement>("#stream");
  const lapElement = requiredElement<HTMLElement>("#lap");
  const checkpointElement = requiredElement<HTMLElement>("#checkpoint");
  const trackCodeElement = requiredElement<HTMLElement>("#track-code");
  const noticeElement = requiredElement<HTMLElement>("#notice");
  const loadingElement = requiredElement<HTMLElement>("#loading");
  const soundButton = requiredElement<HTMLButtonElement>("#sound-toggle");
  const volumeControl = requiredElement<HTMLInputElement>("#sound-volume");
  const boostStatus = requiredElement<HTMLElement>("#boost-status");
  const vehicleRestriction = requiredElement<HTMLElement>(
    "#vehicle-restriction",
  );
  const worldStatus = requiredElement<HTMLElement>("#world-status");
  const driveModeControl = requiredElement<HTMLSelectElement>("#drive-mode");
  const cruisePanel = requiredElement<HTMLElement>("#cruise-settings");
  const cruiseSpeedControl = requiredElement<HTMLInputElement>("#cruise-speed");
  const cruiseSpeedValue = requiredElement<HTMLOutputElement>(
    "#cruise-speed-value",
  );
  const cruiseButton = requiredElement<HTMLButtonElement>("#cruise-toggle");
  const driveStatus = requiredElement<HTMLElement>("#drive-status");
  const throttleHelp = requiredElement<HTMLElement>("#throttle-help");
  const brakeHelp = requiredElement<HTMLElement>("#brake-help");
  const turboW = requiredElement<HTMLElement>("#turbo-w");
  let noticeTimer: number | null = null;
  function showNotice(message: string): void {
    noticeElement.textContent = message;
    noticeElement.classList.add("is-visible");
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(
      () => noticeElement.classList.remove("is-visible"),
      1800,
    );
  }

  let driveUISignature = "";
  function updateDriveUI(): void {
    const signature = `${driveControls.mode}|${driveControls.available}|${driveControls.active}|${driveControls.speedKph}`;
    if (signature === driveUISignature) return;
    driveUISignature = signature;
    driveModeControl.value = driveControls.mode;
    const forwardLabel = touchDevice ? "▲" : "W";
    const brakeLabel = touchDevice ? "▼" : "S";
    const boostLabel = touchDevice ? "NITRO" : "Shift";
    driveModeControl.querySelector<HTMLOptionElement>(
      'option[value="manual"]',
    )!.textContent = `Manual · hold ${forwardLabel}`;
    driveModeControl.querySelector<HTMLOptionElement>(
      'option[value="cruise"]',
    )!.textContent = `Cruise · tap ${forwardLabel}`;
    throttleHelp.textContent =
      driveControls.mode === "cruise" ? "start cruise" : "drive";
    brakeHelp.textContent =
      driveControls.mode === "cruise" ? "stop cruise" : "brake / reverse";
    turboW.hidden = driveControls.mode === "cruise";
    driveModeControl.querySelector<HTMLOptionElement>(
      'option[value="cruise"]',
    )!.disabled = !driveControls.available;
    cruisePanel.hidden = driveControls.mode !== "cruise";
    cruiseSpeedValue.value = String(driveControls.speedKph) + " km/h";
    cruiseButton.textContent = driveControls.active
      ? `Stop cruise · ${brakeLabel}`
      : `Start cruise · ${forwardLabel}`;
    driveStatus.textContent =
      driveControls.mode === "cruise"
        ? driveControls.active
          ? `Cruise active · ${boostLabel} boosts · ${brakeLabel} stops`
          : `Cruise stopped · tap ${forwardLabel} to start`
        : `Hold ${forwardLabel} to drive · ${brakeLabel} brakes / reverses`;
  }

  function session(current: DrivingSession) {
    const activeVehicle = current.vehicleId;
    const spec = current.track.spec;
    const track = current.track;
    requiredElement<HTMLElement>("#vehicle-name").textContent =
      VEHICLES[activeVehicle].name;
    requiredElement<HTMLElement>("#vehicle-spec").textContent =
      `${VEHICLES[activeVehicle].massKg} kg · ${VEHICLES[activeVehicle].targetTopSpeedKph} km/h target`;
    document
      .querySelectorAll<HTMLButtonElement>("[data-vehicle]")
      .forEach((button) => {
        const selected = button.dataset.vehicle === activeVehicle;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.disabled =
          !!spec.vehicleOnly && button.dataset.vehicle !== spec.vehicleOnly;
      });
    vehicleRestriction.textContent = spec.vehicleOnly
      ? spec.name + " · " + VEHICLES[spec.vehicleOnly!].name + " only"
      : "Switching starts a new session";
    boostStatus.textContent = VEHICLES[activeVehicle].turbo
      ? touchDevice
        ? "Tilt forward + NITRO"
        : "Shift + W · NITRO"
      : "Nitro unavailable";
    surfaceElement.textContent = spec.surface;
    trackCodeElement.textContent = spec.code;
    speedElement.textContent = "0";
    lapElement.textContent = "0";
    checkpointElement.textContent = `2 / ${track.checkpoints.length}`;
  }
  const text = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };
  function frame(runtime: DrivingSession) {
    const boostText =
      runtime.vehicle.boost > 0.05
        ? "NITRO ACTIVE"
        : !!runtime.vehicle.spec.turbo
          ? driveControls.mode === "cruise"
            ? touchDevice
              ? "Hold NITRO while cruising"
              : "Shift · NITRO while cruising"
            : touchDevice
              ? "Tilt forward + NITRO"
              : "Shift + W · NITRO"
          : "Nitro unavailable";
    text(boostStatus, boostText);
    boostStatus.classList.toggle("is-boosting", runtime.vehicle.boost > 0.05);

    worldStatus.hidden = !runtime.track.streamer;
    if (runtime.track.streamer) {
      const hint = runtime.track.streamer?.hint ?? runtime.definition.hint;
      if (worldStatus.textContent !== hint) worldStatus.textContent = hint;
    }
    const streamState = runtime.track.streamState;
    text(streamElement, `${streamState.ready} / ${streamState.total}`);
    text(speedElement, String(Math.round(runtime.vehicle.speedKph())));

    progress(runtime);
  }
  function progress(current: DrivingSession) {
    text(lapElement, String(current.lap));
    text(
      checkpointElement,
      current.track.checkpoints.length
        ? String(current.expectedCheckpoint + 1) +
            " / " +
            current.track.checkpoints.length
        : "—",
    );
  }
  function selectTrack(trackId: TrackId) {
    document
      .querySelectorAll<HTMLButtonElement>("[data-track]")
      .forEach((button) => {
        button.classList.toggle("is-active", button.dataset.track === trackId);
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.track === trackId),
        );
      });
  }
  return {
    speedElement,
    fpsElement,
    surfaceElement,
    streamElement,
    lapElement,
    checkpointElement,
    trackCodeElement,
    noticeElement,
    loadingElement,
    soundButton,
    volumeControl,
    boostStatus,
    vehicleRestriction,
    worldStatus,
    driveModeControl,
    cruisePanel,
    cruiseSpeedControl,
    cruiseSpeedValue,
    cruiseButton,
    driveStatus,
    throttleHelp,
    brakeHelp,
    turboW,
    showNotice,
    updateDriveUI,
    session,
    frame,
    selectTrack,
    fps(value: number) {
      fpsElement.textContent = value + " fps";
    },
    progress,
    dispose() {
      if (noticeTimer !== null) clearTimeout(noticeTimer);
    },
  };
}
