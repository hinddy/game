import { DriveControls } from "./drive-controls";
import { joystickAxes } from "./joystick";

/** One captured thumb owns the stick; the other hand independently holds nitro. */
export class DrivePad {
  private pointer: number | null = null;
  private readonly nitroPointers = new Set<number>();
  private readonly knob: HTMLElement;
  private x = 0;
  private y = 0;
  private visualX = 0;
  private visualY = 0;
  private velocityX = 0;
  private velocityY = 0;

  constructor(private readonly root: HTMLElement, private readonly nitro: HTMLButtonElement,
    private readonly controls: DriveControls, onInput: () => void) {
    this.knob = root.querySelector<HTMLElement>(".stick-knob")!;
    for (const element of [root, nitro]) element.addEventListener("contextmenu", event => event.preventDefault());
    root.addEventListener("pointerdown", event => {
      if (this.pointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      root.focus({ preventScroll: true });
      this.pointer = event.pointerId;
      root.setPointerCapture(event.pointerId);
      root.classList.add("is-held");
      this.move(event); onInput();
    });
    root.addEventListener("pointermove", event => {
      if (event.pointerId !== this.pointer) return;
      event.preventDefault(); this.move(event);
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      root.addEventListener(name, event => { if (event.pointerId === this.pointer) this.releaseStick(); });
      nitro.addEventListener(name, event => {
        if (!this.nitroPointers.delete(event.pointerId)) return;
        controls.releaseAction("nitro:" + event.pointerId);
        if (nitro.hasPointerCapture(event.pointerId)) nitro.releasePointerCapture(event.pointerId);
      });
    }
    nitro.addEventListener("pointerdown", event => {
      if (nitro.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      this.nitroPointers.add(event.pointerId);
      controls.pressAction("nitro:" + event.pointerId, "turbo");
      nitro.setPointerCapture(event.pointerId); onInput();
    });
    nitro.addEventListener("keydown", event => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault(); event.stopPropagation();
      if (!nitro.disabled && !event.repeat) { controls.pressAction("nitro-key", "turbo"); onInput(); }
    });
    nitro.addEventListener("keyup", event => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault(); event.stopPropagation(); controls.releaseAction("nitro-key");
    });
    nitro.addEventListener("focusout", () => controls.releaseAction("nitro-key"));
  }
  private move(event: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const travel = rect.width * 0.28;
    const x = (event.clientX - rect.left - rect.width / 2) / travel;
    const y = (event.clientY - rect.top - rect.height / 2) / travel;
    const radius = Math.max(1, Math.hypot(x, y));
    this.x = x / radius; this.y = y / radius;
    const axes = joystickAxes(this.x, this.y);
    this.controls.setStick(axes.x, axes.y);
  }
  private releaseStick(): void {
    const id = this.pointer;
    this.pointer = null;
    this.x = this.y = 0;
    // Physical input stops immediately; the spring only animates the released handle.
    this.controls.setStick(0, 0);
    this.root.classList.remove("is-held");
    if (id !== null && this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
  }
  update(dt: number, boosting: boolean): void {
    // Substeps keep this damped spring stable on slow tablet frames.
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120);
      this.velocityX += ((this.x - this.visualX) * 420 - this.velocityX * 32) * step;
      this.velocityY += ((this.y - this.visualY) * 420 - this.velocityY * 32) * step;
      this.visualX += this.velocityX * step; this.visualY += this.velocityY * step;
      remaining -= step;
    }
    this.knob.style.transform = `translate(${this.visualX * 77.78}%, ${this.visualY * 77.78}%)`;
    this.root.style.setProperty("--roll-x", `${-this.visualY * 90}deg`);
    this.root.style.setProperty("--roll-y", `${this.visualX * 90}deg`);
    this.nitro.classList.toggle("is-held", this.controls.actionHeld("turbo"));
    this.nitro.classList.toggle("is-boosting", boosting);
    this.nitro.setAttribute("aria-pressed", String(this.controls.actionHeld("turbo")));
  }
  setTurboAvailable(available: boolean): void {
    this.nitro.disabled = !available;
    this.nitro.title = available ? "Hold with forward throttle, or during cruise" : "Nitro is available on BuggY";
  }
  clear(): void {
    this.releaseStick();
    for (const id of this.nitroPointers) {
      this.controls.releaseAction("nitro:" + id);
      if (this.nitro.hasPointerCapture(id)) this.nitro.releasePointerCapture(id);
    }
    this.nitroPointers.clear();
    this.controls.releaseAction("nitro-key");
    this.nitro.classList.remove("is-held", "is-boosting");
    this.nitro.setAttribute("aria-pressed", "false");
  }
}
