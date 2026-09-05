import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d";
import "./style.css";
import { TRACKS, VEHICLES, vehicleForTrack, type VehicleId, WORLD_BOUNDARIES, WORLD_PHYSICS, type TrackId } from "./config";
import { TrackRuntime, type TrackRenderOptions, type TrackSample } from "./track";
import { GarageVehicle, type DriveInput } from "./vehicle";
import { BonnevilleRuntime, SALT_PLAYABLE_HALF_SIZE } from "./bonneville";
import { EngineAudio } from "./engine-audio";
import { DriveControls } from "./drive-controls";
import { DrivePad } from "./drive-pad";
import { DroneCamera, DroneGestures } from "./drone-camera";
import { BONNEVILLE_SUN_DIRECTION } from "./bonneville-light";

type Runtime = {
  world: RAPIER.World;
  track: TrackRuntime | BonnevilleRuntime;
  vehicle: GarageVehicle;
  expectedCheckpoint: number;
  lastSafeSample: TrackSample;
  lap: number;
  outsideSeconds: number;
  wrongWaySeconds: number;
};

const requiredElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const canvas = requiredElement<HTMLCanvasElement>("#game");
const speedElement = requiredElement<HTMLElement>("#speed");
const fpsElement = requiredElement<HTMLElement>("#fps");
const surfaceElement = requiredElement<HTMLElement>("#surface");
const streamElement = requiredElement<HTMLElement>("#stream");
const lapElement = requiredElement<HTMLElement>("#lap");
const checkpointElement = requiredElement<HTMLElement>("#checkpoint");
const trackCodeElement = requiredElement<HTMLElement>("#track-code");
const noticeElement = requiredElement<HTMLElement>("#notice");
const loadingElement = requiredElement<HTMLElement>("#loading");
const devParams = new URLSearchParams(window.location.search);
const devSmoke = import.meta.env.DEV && devParams.get("smoke") === "1";
type NetworkConnection = { effectiveType?: string; saveData?: boolean; downlink?: number };
const connection = (navigator as Navigator & { connection?: NetworkConnection }).connection;
const lightSpeed = devSmoke
  || connection?.saveData === true
  || connection?.effectiveType === "slow-2g"
  || connection?.effectiveType === "2g"
  || connection?.effectiveType === "3g";
const trackRenderOptions: TrackRenderOptions = lightSpeed
  ? { chunkSamples: 10, initialChunks: 1, streamIntervalMs: 150, showProps: false, castShadows: false }
  : { chunkSamples: 8, initialChunks: 1, streamIntervalMs: 90, showProps: true, castShadows: true };

const touchDevice = navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches;
const pixelRatioLimit = touchDevice ? 1.25 : 1.5;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lightSpeed, powerPreference: "high-performance" });
renderer.setPixelRatio(lightSpeed ? 1 : Math.min(window.devicePixelRatio, pixelRatioLimit));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !lightSpeed;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07101c);
scene.fog = new THREE.FogExp2(0x07101c, lightSpeed ? 0.009 : 0.0065);

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.08, 620);
camera.position.set(0, 5, -9);

const hemisphere = new THREE.HemisphereLight(0x9cc8ff, 0x151c14, 1.65);
const keyLight = new THREE.DirectionalLight(0xffe0bb, 3.2);
keyLight.position.set(-34, 58, -24);
keyLight.castShadow = !lightSpeed;
keyLight.shadow.mapSize.set(lightSpeed ? 512 : 1024, lightSpeed ? 512 : 1024);
keyLight.shadow.camera.left = -16;
keyLight.shadow.camera.right = 16;
keyLight.shadow.camera.top = 16;
keyLight.shadow.camera.bottom = -16;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 170;
keyLight.shadow.normalBias = 0.035;
keyLight.shadow.bias = -0.00015;
scene.add(hemisphere, keyLight, keyLight.target);

function buildHorizon(count: number): THREE.Object3D {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x0b1f36, roughness: 0.95 });
  const buildings = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius = 160 + (index % 7) * 4;
    const width = 5 + (index % 4) * 2.2;
    const height = 8 + (index * 13) % 34;
    const depth = 4 + (index % 5) * 1.7;
    const position = new THREE.Vector3(Math.cos(angle) * radius, height / 2 - 1, Math.sin(angle) * radius);
    matrix.compose(position, rotation, new THREE.Vector3(width, height, depth));
    buildings.setMatrixAt(index, matrix);
  }
  buildings.instanceMatrix.needsUpdate = true;
  group.add(buildings);
  return group;
}

let cityHorizon: THREE.Object3D | null = null;
function streamHorizonAfterFirstPaint(): void {
  window.setTimeout(() => {
    cityHorizon = buildHorizon(lightSpeed ? 24 : 56);
    cityHorizon.visible = activeTrack !== "bonneville";
    scene.add(cityHorizon);
  }, lightSpeed ? 900 : 420);
}

const engineAudio = new EngineAudio();
const soundButton = requiredElement<HTMLButtonElement>("#sound-toggle");
const volumeControl = requiredElement<HTMLInputElement>("#sound-volume");
const boostStatus = requiredElement<HTMLElement>("#boost-status");
const vehicleRestriction = requiredElement<HTMLElement>("#vehicle-restriction");

const driveControls = new DriveControls();
const drivePad = new DrivePad(requiredElement<HTMLElement>("#drive-pad"), driveControls, () => {
  devInput = null;
  unlockAudio();
});
function cancelDriving(): void { driveControls.cancel(); drivePad.clear(); }
const driveModeControl = requiredElement<HTMLSelectElement>("#drive-mode");
const cruisePanel = requiredElement<HTMLElement>("#cruise-settings");
const cruiseSpeedControl = requiredElement<HTMLInputElement>("#cruise-speed");
const cruiseSpeedValue = requiredElement<HTMLOutputElement>("#cruise-speed-value");
const cruiseButton = requiredElement<HTMLButtonElement>("#cruise-toggle");
const driveStatus = requiredElement<HTMLElement>("#drive-status");
const throttleHelp = requiredElement<HTMLElement>("#throttle-help");
const brakeHelp = requiredElement<HTMLElement>("#brake-help");
const turboW = requiredElement<HTMLElement>("#turbo-w");
function unlockAudio(): void { void engineAudio.unlock().catch(() => {
  soundButton.textContent = "Sound unavailable";
}); }
window.addEventListener("pointerdown", unlockAudio);
soundButton.addEventListener("click", () => {
  const muted = engineAudio.toggleMute();
  soundButton.textContent = muted ? "Sound off" : "Sound on";
  soundButton.setAttribute("aria-pressed", String(!muted));
});
volumeControl.addEventListener("input", () => engineAudio.setVolume(Number(volumeControl.value) / 100));


let devInput: DriveInput | null = null;
let resetRequested = false;
let runtime: Runtime | null = null;
let activeTrack: TrackId = "yard";
let activeVehicle: VehicleId = devParams.get("vehicle") === "buggy" ? "buggy" : "quadro";
let noticeTimer: number | null = null;

function showNotice(message: string): void {
  noticeElement.textContent = message;
  noticeElement.classList.add("is-visible");
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => noticeElement.classList.remove("is-visible"), 1800);
}

function currentInput(): DriveInput {
  if (import.meta.env.DEV && devInput) return devInput;
  return driveControls.input();
}

function updateDriveUI(): void {
  driveModeControl.value = driveControls.mode;
  const forwardLabel = touchDevice ? "▲" : "W";
  const brakeLabel = touchDevice ? "▼" : "S";
  const boostLabel = touchDevice ? "TURBO" : "Shift";
  driveModeControl.querySelector<HTMLOptionElement>('option[value="manual"]')!.textContent = `Manual · hold ${forwardLabel}`;
  driveModeControl.querySelector<HTMLOptionElement>('option[value="cruise"]')!.textContent = `Cruise · tap ${forwardLabel}`;
  throttleHelp.textContent = driveControls.mode === "cruise" ? "start cruise" : "drive";
  brakeHelp.textContent = driveControls.mode === "cruise" ? "stop cruise" : "brake / reverse";
  turboW.hidden = driveControls.mode === "cruise";
  driveModeControl.querySelector<HTMLOptionElement>('option[value="cruise"]')!.disabled = !driveControls.available;
  cruisePanel.hidden = driveControls.mode !== "cruise";
  cruiseSpeedValue.value = String(driveControls.speedKph) + " km/h";
  cruiseButton.textContent = driveControls.active ? `Stop cruise · ${brakeLabel}` : `Start cruise · ${forwardLabel}`;
  driveStatus.textContent = driveControls.mode === "cruise"
    ? driveControls.active ? `Cruise active · ${boostLabel} boosts · ${brakeLabel} stops` : `Cruise stopped · tap ${forwardLabel} to start`
    : `Hold ${forwardLabel} to drive · ${brakeLabel} brakes / reverses`;
}

driveModeControl.addEventListener("change", () => {
  drivePad.clear();
  driveControls.setMode(driveModeControl.value === "cruise" ? "cruise" : "manual");
  devInput = null;
  if (runtime) runtime.vehicle.boost = 0;
  updateDriveUI();
  driveModeControl.blur();
  canvas.focus({ preventScroll: true });
});
cruiseSpeedControl.addEventListener("input", () => {
  driveControls.setSpeed(Number(cruiseSpeedControl.value));
  updateDriveUI();
});
cruiseSpeedControl.addEventListener("pointerup", () => canvas.focus({ preventScroll: true }));
volumeControl.addEventListener("pointerup", () => canvas.focus({ preventScroll: true }));
cruiseButton.addEventListener("click", () => {
  if (driveControls.active) cancelDriving();
  else driveControls.start();
  devInput = null;
  updateDriveUI();
  cruiseButton.blur();
});
function disposeRuntime(current: Runtime): void {
  current.vehicle.dispose(scene);
  current.track.dispose(scene);
  current.world.removeVehicleController(current.vehicle.controller);
  current.world.free();
}

function createRuntime(trackId: TrackId): Runtime {
  const spec = TRACKS[trackId];
  activeVehicle = vehicleForTrack(trackId, activeVehicle);
  const world = new RAPIER.World(WORLD_PHYSICS.gravity);
  world.timestep = WORLD_PHYSICS.fixedStep;
  const track = trackId === "bonneville"
    ? new BonnevilleRuntime(spec, world, scene, !lightSpeed)
    : new TrackRuntime(spec, world, scene, trackRenderOptions);
  const vehicle = new GarageVehicle(world, spec, track.spawn, scene, VEHICLES[activeVehicle]);
  drivePad.setTurboAvailable(!!vehicle.spec.turbo);

  requiredElement<HTMLElement>("#vehicle-name").textContent = VEHICLES[activeVehicle].name;
  requiredElement<HTMLElement>("#vehicle-spec").textContent = `${VEHICLES[activeVehicle].massKg} kg · ${VEHICLES[activeVehicle].targetTopSpeedKph} km/h target`;
  document.querySelectorAll<HTMLButtonElement>("[data-vehicle]").forEach(button => {
    const selected = button.dataset.vehicle === activeVehicle;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = !!spec.vehicleOnly && button.dataset.vehicle !== spec.vehicleOnly;
  });
  vehicleRestriction.textContent = spec.vehicleOnly ? "Bonneville · BuggY only" : "Switching starts a new session";
  boostStatus.textContent = VEHICLES[activeVehicle].turbo ? (touchDevice ? "▲ + TURBO · boost" : "Shift + W · TURBO") : "Turbo unavailable";
  surfaceElement.textContent = spec.surface;
  trackCodeElement.textContent = spec.code;
  speedElement.textContent = "0";
  lapElement.textContent = "0";
  checkpointElement.textContent = `2 / ${track.checkpoints.length}`;

  return {
    world,
    track,
    vehicle,
    expectedCheckpoint: 1,
    lastSafeSample: track.spawn,
    lap: 0,
    outsideSeconds: 0,
    wrongWaySeconds: 0,
  };
}

function switchTrack(trackId: TrackId): void {
  if (runtime) disposeRuntime(runtime);
  cancelDriving();
  devInput = null;
  resetRequested = false;
  activeTrack = trackId;
  driveControls.setAvailable(trackId === "bonneville");
  updateDriveUI();
  accumulator = 0;
  drone.recenter();
  droneGestures.clear();
  engineAudio.update(0, 0, 0, false);
  const salt = trackId === "bonneville";
  document.body.classList.toggle("salt-world", salt);
  if (cityHorizon) cityHorizon.visible = !salt;
  scene.background = new THREE.Color(salt ? 0xd1c7bd : 0x07101c);
  scene.fog = new THREE.FogExp2(salt ? 0xd1c7bd : 0x07101c, salt ? 0.000018 : lightSpeed ? 0.009 : 0.0065);
  hemisphere.color.setHex(salt ? 0xa5c1e0 : 0x9cc8ff);
  hemisphere.groundColor.setHex(salt ? 0x9e9690 : 0x151c14);
  hemisphere.intensity = salt ? 1.5 : 1.65;
  keyLight.color.setHex(salt ? 0xffd2a0 : 0xffe0bb);
  keyLight.intensity = salt ? 3.0 : 3.2;
  if (salt) shadowOffset.copy(BONNEVILLE_SUN_DIRECTION).multiplyScalar(60);
  else shadowOffset.set(-24, 38, -18);
  renderer.toneMappingExposure = salt ? 0.90 : 1.05;
  camera.near = salt ? 0.2 : 0.08;
  camera.far = salt ? 80000 : 620;
  camera.updateProjectionMatrix();
  runtime = createRuntime(trackId);
  updateCamera(runtime, 0);
  document.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.track === trackId);
    button.setAttribute("aria-pressed", String(button.dataset.track === trackId));
  });
  showNotice(`${TRACKS[trackId].code} · ${TRACKS[trackId].name}`);
}

function resetVehicle(message = "Vehicle returned to the last safe checkpoint"): void {
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

function updateProgress(current: Runtime, dt: number): void {
  const position = current.vehicle.position();
  const nearest = current.track.nearestSample(position);
  const allowedDistance = nearest.sample.width / 2 + WORLD_BOUNDARIES.safetyMarginM;

  const outside = current.track.spec.id === "bonneville"
    ? Math.max(Math.abs(position.x), Math.abs(position.z)) > SALT_PLAYABLE_HALF_SIZE
    : nearest.distance > allowedDistance;
  if (outside || position.y < WORLD_PHYSICS.killY) {
    current.outsideSeconds += dt;
    if (current.outsideSeconds >= WORLD_BOUNDARIES.outsideResetSeconds || position.y < WORLD_PHYSICS.killY) resetVehicle();
  } else {
    current.outsideSeconds = 0;
  }

  const expected = current.track.checkpoints[current.expectedCheckpoint];
  const distanceToCheckpoint = position.distanceTo(expected.position);
  if (distanceToCheckpoint < expected.width * 0.62) {
    current.lastSafeSample = current.track.samples[expected.sampleIndex];
    if (current.expectedCheckpoint === 0) {
      current.lap += 1;
      lapElement.textContent = String(current.lap);
      showNotice(`Lap ${current.lap} complete`);
    }
    current.expectedCheckpoint = (current.expectedCheckpoint + 1) % current.track.checkpoints.length;
    checkpointElement.textContent = `${current.expectedCheckpoint + 1} / ${current.track.checkpoints.length}`;
  }

  const forward = current.vehicle.forward();
  const trackDirection = nearest.sample.tangent;
  const drivingWrongWay = forward.dot(trackDirection) < -0.35 && current.vehicle.speedKph() > 8
    && (current.track.spec.id !== "bonneville" || nearest.distance < nearest.sample.width);
  current.wrongWaySeconds = drivingWrongWay ? current.wrongWaySeconds + dt : Math.max(0, current.wrongWaySeconds - dt * 2);
  if (current.wrongWaySeconds > WORLD_BOUNDARIES.wrongWayNoticeSeconds) {
    current.wrongWaySeconds = 0;
    showNotice("Wrong way — follow the orange lane marks");
  }
}

const shadowOffset = new THREE.Vector3(-24, 38, -18);
const drone = new DroneCamera();
const droneGestures = new DroneGestures(canvas, drone);
const cameraForward = new THREE.Vector3();
const cameraViewDirection = new THREE.Vector3();
const vehiclePosition = new THREE.Vector3();

function updateCamera(current: Runtime, frameDt: number): void {
  drone.update(camera, current.vehicle.position(vehiclePosition), current.vehicle.forward(cameraForward),
    frameDt, current.vehicle.speedKph(), droneGestures.active);
}
requiredElement<HTMLButtonElement>("#camera-reset").addEventListener("click", () => {
  drone.recenter(); droneGestures.clear(); canvas.focus({ preventScroll: true });
});
requiredElement<HTMLButtonElement>("#vehicle-reset").addEventListener("click", () => {
  resetRequested = true; canvas.focus({ preventScroll: true });
});
window.addEventListener("keydown", (event) => {
  const target = event.target;
  // Preserve actual text entry and native arrow/space editing, but let WASD/R/F/Shift
  // drive even when a select/range retains focus after a click (including Safari).
  if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement)) return;
  if (target instanceof HTMLInputElement && !["range", "checkbox", "radio", "button"].includes(target.type)) return;
  if ((target instanceof HTMLSelectElement || target instanceof HTMLInputElement)
    && (event.code.startsWith("Arrow") || ["Space", "Enter", "Home", "End"].includes(event.code))) return;
  if (target instanceof HTMLButtonElement && ["Space", "Enter"].includes(event.code)) return;
  unlockAudio();
  if (event.code === "KeyR" && !event.repeat) resetRequested = true;
  if (event.code === "KeyF" && !event.repeat) {
    drone.recenter(); droneGestures.clear();
    showNotice("Drone centred behind the vehicle");
  }
  if (driveControls.keyDown(event.code, event.repeat)) {
    event.preventDefault();
    devInput = null;
  }
});
window.addEventListener("keyup", (event) => driveControls.keyUp(event.code));
document.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) {
    driveControls.releaseKeys();
    devInput = null;
  }
});
function pauseControls(): void {
  cancelDriving(); devInput = null;
  if (runtime) runtime.vehicle.boost = 0;
  droneGestures.clear();
  engineAudio.suspend();
}
window.addEventListener("blur", pauseControls);
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseControls(); });
window.addEventListener("pagehide", () => engineAudio.dispose());
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(lightSpeed ? 1 : Math.min(window.devicePixelRatio, pixelRatioLimit));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

document.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((button) => {
  button.addEventListener("click", () => {
    const trackId = button.dataset.track as TrackId | undefined;
    if (trackId && trackId !== activeTrack) switchTrack(trackId);
    canvas.focus({ preventScroll: true });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-vehicle]").forEach(button => {
  button.addEventListener("click", () => {
    const id = button.dataset.vehicle as VehicleId;
    if (id === activeVehicle || !Object.hasOwn(VEHICLES, id) || vehicleForTrack(activeTrack, id) !== id) return;
    activeVehicle = id;
    cancelDriving();
    devInput = null;
    resetRequested = false;
    accumulator = 0;
    drone.recenter();
  droneGestures.clear();
    switchTrack(activeTrack);
    canvas.focus({ preventScroll: true });
    showNotice(`${VEHICLES[id].name} ready — new session`);
  });
});

let previousTime = performance.now();
let accumulator = 0;
let fpsFrames = 0;
let fpsStartedAt = previousTime;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!runtime) return;
  if (document.hidden) { previousTime = now; accumulator = 0; return; }

  const frameDt = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  accumulator += frameDt;

  if (resetRequested) {
    resetRequested = false;
    resetVehicle("Manual reset");
  }

  let steps = 0;
  while (accumulator >= WORLD_PHYSICS.fixedStep && steps < WORLD_PHYSICS.maxCatchUpSteps) {
    runtime.vehicle.update(currentInput(), WORLD_PHYSICS.fixedStep);
    runtime.world.step();
    updateProgress(runtime, WORLD_PHYSICS.fixedStep);
    accumulator -= WORLD_PHYSICS.fixedStep;
    steps += 1;
  }
  if (steps === WORLD_PHYSICS.maxCatchUpSteps) accumulator = 0;

  runtime.vehicle.syncVisual();
  runtime.vehicle.updateEffects(frameDt, window.innerHeight * renderer.getPixelRatio());
  engineAudio.update(runtime.vehicle.speedKph(), runtime.vehicle.engineLoad, runtime.vehicle.boost, activeVehicle === "buggy");
  updateDriveUI();
  boostStatus.textContent = runtime.vehicle.boost > 0.05 ? "TURBO ACTIVE" : activeVehicle === "buggy" ? driveControls.mode === "cruise" ? "Shift · TURBO while cruising" : (touchDevice ? "▲ + TURBO · boost" : "Shift + W · TURBO") : "Turbo unavailable";
  boostStatus.classList.toggle("is-boosting", runtime.vehicle.boost > 0.05);
  updateCamera(runtime, frameDt);
  runtime.track.stream(now, runtime.vehicle.position(vehiclePosition), camera.getWorldDirection(cameraViewDirection));
  const streamState = runtime.track.streamState;
  streamElement.textContent = `${streamState.ready} / ${streamState.total}`;
  speedElement.textContent = String(Math.round(runtime.vehicle.speedKph()));
  keyLight.target.position.copy(vehiclePosition);
  keyLight.position.copy(vehiclePosition).add(shadowOffset);
  renderer.render(scene, camera);

  fpsFrames += 1;
  const fpsWindow = now - fpsStartedAt;
  if (fpsWindow >= 650) {
    fpsElement.textContent = `${Math.round((fpsFrames * 1000) / fpsWindow)} fps`;
    fpsFrames = 0;
    fpsStartedAt = now;
  }
}

async function start(): Promise<void> {
  const requestedTrack = devParams.get("track");
  const initialTrack = requestedTrack && Object.hasOwn(TRACKS, requestedTrack) ? requestedTrack as TrackId : "yard";
  switchTrack(initialTrack);
  streamHorizonAfterFirstPaint();
  if (import.meta.env.DEV) {
    window.__hinddy = {
      setInput(input) {
        devInput = input;
      },
      snapshot() {
        if (!runtime) return null;
        const position = runtime.vehicle.position();
        return {
          speedKph: runtime.vehicle.speedKph(),
          position: { x: position.x, y: position.y, z: position.z },
          wheelContacts: Array.from(
            { length: runtime.vehicle.controller.numWheels() },
            (_, index) => runtime!.vehicle.controller.wheelIsInContact(index),
          ),
          track: runtime.track.spec.id,
          vehicle: runtime.vehicle.spec.id,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          boost: runtime.vehicle.boost,
          exhaustParticles: runtime.vehicle.exhaustParticles,
          audioState: engineAudio.state,
          audioVolume: engineAudio.level,
          driveMode: driveControls.mode,
          cruiseActive: driveControls.active,
          cruiseSpeedKph: driveControls.speedKph,
          driveInput: currentInput(),
          cameraMode: "follow", orbitYaw: drone.yaw, cameraRadius: drone.radius,
          cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          cameraTarget: { x: drone.target.x, y: drone.target.y, z: drone.target.z },
          sunElevationDeg: THREE.MathUtils.radToDeg(Math.atan2(shadowOffset.y, Math.hypot(shadowOffset.x, shadowOffset.z))),
        };
      },
    };
  }
  loadingElement.classList.add("is-hidden");
  requestAnimationFrame((now) => {
    previousTime = now;
    fpsStartedAt = now;
    requestAnimationFrame(frame);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  loadingElement.replaceChildren();
  const title = document.createElement("p");
  title.textContent = "Garage failed to open.";
  const details = document.createElement("pre");
  details.style.maxWidth = "min(720px, 90vw)";
  details.style.whiteSpace = "pre-wrap";
  details.style.color = "#ffb06b";
  details.textContent = message;
  loadingElement.append(title, details);
});









