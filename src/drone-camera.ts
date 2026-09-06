import * as THREE from "three";

const defaultElevation = Math.atan2(3.9, 6.6);

/** A single camera rig: all orbit angles remain relative to the moving vehicle. */
export class DroneCamera {
  readonly target = new THREE.Vector3();
  private readonly heading = new THREE.Vector3(0, 0, 1);
  private readonly forward = new THREE.Vector3();
  private snap = true;
  private returnDelay = 0;
  yaw = 0;
  elevation = defaultElevation;
  radius = Math.hypot(6.6, 3.9);
  maxRadius = 20;

  orbit(dx: number, dy: number): void {
    this.yaw = THREE.MathUtils.euclideanModulo(this.yaw - dx * 0.007 + Math.PI, Math.PI * 2) - Math.PI;
    this.elevation = THREE.MathUtils.clamp(this.elevation - dy * 0.005, 0.12, Math.PI / 2 - .01);
    this.returnDelay = 2;
  }
  zoom(factor: number): void { this.radius = THREE.MathUtils.clamp(this.radius * factor, 4, this.maxRadius); }
  recenter(): void { this.yaw = 0; this.elevation = defaultElevation; this.radius = Math.hypot(6.6, 3.9); this.returnDelay = 0; this.snap = true; }

  update(camera: THREE.PerspectiveCamera, position: THREE.Vector3, forward: THREE.Vector3,
    dt: number, speedKph: number, interacting = false): void {
    const blend = 1 - Math.exp(-dt * 5.8);
    this.forward.copy(forward); this.forward.y = 0;
    if (this.forward.lengthSq() < 0.001) this.forward.copy(this.heading);
    this.forward.normalize();
    if (this.snap) this.heading.copy(this.forward);
    else this.heading.lerp(this.forward, blend).normalize();
    if (this.heading.lengthSq() < 0.001) this.heading.copy(this.forward);
    if (interacting) this.returnDelay = 2;
    else this.returnDelay = Math.max(0, this.returnDelay - dt);
    if (!interacting && this.returnDelay === 0 && speedKph > 2) {
      this.yaw = THREE.MathUtils.damp(this.yaw, 0, 2.8, dt);
      this.elevation = THREE.MathUtils.damp(this.elevation, defaultElevation, 2.8, dt);
    }
    const angle = Math.atan2(this.heading.x, this.heading.z) + Math.PI + this.yaw;
    const horizontal = this.radius * Math.cos(this.elevation);
    camera.position.set(
      position.x + Math.sin(angle) * horizontal,
      position.y + Math.sin(this.elevation) * this.radius,
      position.z + Math.cos(angle) * horizontal,
    );
    // Reduce look-ahead when orbiting to keep the vehicle centred from every side.
    this.target.copy(position).addScaledVector(this.heading, 1.5 * Math.max(0, Math.cos(this.yaw)));
    this.target.y += 0.85;
    camera.lookAt(this.target);
    this.snap = false;
  }
}

/** RMB on desktop; one finger orbits, two fingers additionally pinch to zoom. */
export class DroneGestures {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private previous: { x: number; y: number; distance: number } | null = null;
  get active(): boolean { return this.pointers.size > 0; }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly drone: DroneCamera) {
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      canvas.focus({ preventScroll: true });
      if (event.pointerType === "mouse" && event.button !== 2) return;
      event.preventDefault();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      this.previous = this.measure();
      canvas.classList.add("is-orbiting");
    });
    canvas.addEventListener("pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const next = this.measure();
      if (this.previous) {
        drone.orbit(next.x - this.previous.x, next.y - this.previous.y);
        if (next.distance > 8 && this.previous.distance > 8) drone.zoom(this.previous.distance / next.distance);
      }
      this.previous = next;
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      canvas.addEventListener(name, event => {
        if (!this.pointers.delete(event.pointerId)) return;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        this.previous = this.active ? this.measure() : null;
        canvas.classList.toggle("is-orbiting", this.active);
      });
    }
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      drone.zoom(Math.exp(event.deltaY * 0.001));
    }, { passive: false });
  }
  private measure(): { x: number; y: number; distance: number } {
    const points = [...this.pointers.values()];
    const a = points[0], b = points[1] ?? a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  clear(): void {
    const ids = [...this.pointers.keys()];
    this.pointers.clear(); this.previous = null;
    for (const id of ids) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.canvas.classList.remove("is-orbiting");
  }
}
